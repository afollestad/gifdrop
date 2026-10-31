// Runs a video of your own through a spread of settings and prints how it went, with
// the GIFs left in tests/e2e/out/. Nothing leaves this machine:
//   node tests/e2e/footage.mjs [chrome | firefox | safari | ios | ios=<udid>] <path>
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser } from './browsers.mjs';
import { startServer } from './server.mjs';

const REPORT_TIMEOUT_MS = 900000;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const KB = 1024;

const [spec = 'chrome', path] = process.argv.slice(2);
if (!path) throw new Error('Usage: footage.mjs <browser> <path to a video>');

function print(report) {
    console.log(report.userAgent);
    console.log(`Fetched in ${report.fetchSeconds}s, loaded in ${report.loadSeconds}s, ${report.size?.join('x')}, ${report.duration}s, HDR ${report.hdr}`);
    console.log(`Seeks to the end: ${report.seeksToEnd}, checked in ${report.seekCheckSeconds}s`);
    if (report.error) console.log(report.error);
    for (const r of report.results) {
        if (r.error) {
            console.log(`${r.name.padEnd(17)} ${r.error}`);
            continue;
        }
        const { low, high, exact } = r.estimate;
        const range = exact ? 'exact' : `${Math.round(low / KB)}-${Math.round(high / KB)} KB`;
        const inRange = r.bytes >= low * (exact ? 0.98 : 1) && r.bytes <= high * (exact ? 1.02 : 1) ? '' : ' OUTSIDE';
        const rate = Math.round(r.planned / r.seconds);
        console.log(`${r.name.padEnd(17)} ${r.size.width}x${r.size.height} ${String(r.frames).padStart(4)} frames ${String(Math.round(r.bytes / KB)).padStart(6)} KB in ${String(r.seconds).padStart(6)}s (${rate}/s), est ${range}${inRange} in ${r.estimateSeconds}s, ${r.stats.presentFallbacks} fallbacks`);
    }
}

const name = `footage-${spec.split('=')[0]}`;
const server = await startServer(0, { footagePath: resolve(path) });
const closeBrowser = openBrowser(spec, `http://localhost:${server.port}/tests/e2e/footage.html?report=${name}`);
try {
    print(JSON.parse(await server.waitForReport(name, REPORT_TIMEOUT_MS)));
} catch (error) {
    console.error(error.message);
    const progressPath = join(OUT, `${name}-progress.json`);
    if (existsSync(progressPath)) print(JSON.parse(readFileSync(progressPath, 'utf8')));
    process.exitCode = 1;
} finally {
    closeBrowser();
    server.close();
}
