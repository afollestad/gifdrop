// Runs the end-to-end suites in a browser, prints the outcome, and exits non-zero if
// anything failed:
//   node tests/e2e/run.mjs [chrome | firefox | safari | ios | ios=<udid>] [capture | convert | ui]
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser } from './browsers.mjs';
import { checkConvertReport } from './convert-check.mjs';
import { startServer } from './server.mjs';

const REPORT_TIMEOUT_MS = 480000;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const PASSING = new Set(['pass', 'unsupported', 'flagged']);

// Each suite has a page, and optionally checks what it produced from here.
const SUITES = {
    capture: { page: 'capture.html', check: (report) => report },
    convert: { page: 'convert.html', check: (report, name) => checkConvertReport(report, (index) => readFileSync(join(OUT, `${name}-${index}.gif`))) },
    ui: { page: 'ui.html', check: (report) => report },
};

function describe(result) {
    if (result.detail) return result.detail;
    if (result.error) return result.error;
    const { wrong, frames, capturedPerSecond, stats, size } = result;
    return `${wrong}/${frames} wrong, ${capturedPerSecond} fps, ${stats.presentFallbacks} fallbacks, ${size.join('x')}`;
}

function printResults({ userAgent, results }) {
    console.log(userAgent);
    for (const result of results) {
        console.log(`${result.status.padEnd(12)}${result.name.padEnd(42)}${describe(result)}`);
        if (result.wrong) console.log(`            ${JSON.stringify(result.wrongSample)}`);
        if (result.longMisses && !PASSING.has(result.status)) console.log(`            ${result.longMissCount} long misses: ${JSON.stringify(result.longMisses)}`);
    }
}

function clearReports(name) {
    if (!existsSync(OUT)) return;
    for (const file of readdirSync(OUT)) {
        if (file.startsWith(`${name}.`) || file.startsWith(`${name}-`)) rmSync(join(OUT, file), { force: true });
    }
}

async function runSuite(spec, suiteName) {
    const suite = SUITES[suiteName];
    const browserName = spec.split('=')[0];
    const name = `${suiteName}-${browserName}`;
    // Reports left by an earlier run must not pass for this one's.
    clearReports(name);

    console.log(`\n${suiteName} in ${browserName}`);
    const server = await startServer();
    const closeBrowser = openBrowser(spec, `http://localhost:${server.port}/tests/e2e/${suite.page}?report=${name}`);
    try {
        const report = suite.check(JSON.parse(await server.waitForReport(name, REPORT_TIMEOUT_MS)), name);
        printResults(report);
        return report.results.every((result) => PASSING.has(result.status));
    } catch (error) {
        console.error(error.message);
        const progressPath = join(OUT, `${name}-progress.json`);
        if (existsSync(progressPath)) {
            const partial = JSON.parse(readFileSync(progressPath, 'utf8'));
            console.error(`Stopped after ${partial.results.length} cases, hidden: ${partial.hidden}`);
            printResults(partial);
        }
        return false;
    } finally {
        closeBrowser();
        server.close();
    }
}

const spec = process.argv[2] ?? 'chrome';
const suiteNames = process.argv[3] ? [process.argv[3]] : Object.keys(SUITES);

let passed = true;
for (const suiteName of suiteNames) {
    if (!(await runSuite(spec, suiteName))) passed = false;
}
process.exitCode = passed ? 0 : 1;
