// Runs the capture checks in a browser, prints the outcome, and exits non-zero if
// anything failed:
//   node tests/e2e/capture.mjs [chrome | firefox | safari | ios | ios=<udid>]
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser } from './browsers.mjs';
import { startServer } from './server.mjs';

const REPORT_TIMEOUT_MS = 480000;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const PASSING = new Set(['pass', 'unsupported', 'flagged']);

function describe(result) {
    if (result.error) return result.error;
    const { wrong, frames, capturedPerSecond, stats, size } = result;
    return `${wrong}/${frames} wrong, ${capturedPerSecond} fps, ${stats.presentFallbacks} fallbacks, ${size.join('x')}`;
}

function printResults({ userAgent, results }) {
    console.log(userAgent);
    for (const result of results) {
        console.log(`${result.status.padEnd(12)}${result.name.padEnd(42)}${describe(result)}`);
        if (result.wrong) console.log(`            ${JSON.stringify(result.wrongSample)}`);
    }
}

const spec = process.argv[2] ?? 'chrome';
const reportName = `capture-${spec.split('=')[0]}`;
const progressPath = join(OUT, `${reportName}-progress.json`);

// A report left by an earlier run must not pass for this one's.
rmSync(join(OUT, `${reportName}.json`), { force: true });
rmSync(progressPath, { force: true });

const server = await startServer();
const closeBrowser = openBrowser(spec, `http://localhost:${server.port}/tests/e2e/capture.html?report=${reportName}`);

let passed = false;
try {
    const report = JSON.parse(await server.waitForReport(reportName, REPORT_TIMEOUT_MS));
    printResults(report);
    passed = report.results.every((result) => PASSING.has(result.status));
} catch (error) {
    console.error(error.message);
    if (existsSync(progressPath)) {
        const partial = JSON.parse(readFileSync(progressPath, 'utf8'));
        console.error(`Stopped after ${partial.results.length} cases, hidden: ${partial.hidden}`);
        printResults(partial);
    }
} finally {
    closeBrowser();
    server.close();
}

process.exitCode = passed ? 0 : 1;
