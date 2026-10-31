// Reads back the GIFs that convert-page.js made, with the parser in tests/gif-parse.js,
// and checks them against what the settings call for.
import { spawnSync } from 'node:child_process';
import { outputFrameCount, planFrames } from '../../scripts/app/plan.js';
import { readBarcode } from '../barcode.js';
import { compositeFrames, parseGif } from '../gif-parse.js';

const EXACT_TOLERANCE_LOW = 0.98;
const EXACT_TOLERANCE_HIGH = 1.02;
const FFMPEG_AVAILABLE = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

function toRgba(picture, palette) {
    const data = new Uint8ClampedArray(picture.length * 4);
    for (let p = 0; p < picture.length; p++) {
        const [r, g, b] = palette[picture[p]];
        data[p * 4] = r;
        data[p * 4 + 1] = g;
        data[p * 4 + 2] = b;
        data[p * 4 + 3] = 255;
    }
    return data;
}

// The frames and delays a viewer should see: repeats of a source frame merge into one
// longer frame, and a boomerang returns through the middle ones.
function expectedSequence({ trimStart, trimEnd, fps, speed, loop }) {
    const { times, delays } = planFrames({ trimStart, trimEnd, fps, speed });
    const forward = [];
    times.forEach((time, i) => {
        const frame = Math.floor((time + 0.001) * 30);
        if (forward.at(-1)?.frame === frame) forward.at(-1).delay += delays[i];
        else forward.push({ frame, delay: delays[i] });
    });
    if (loop !== 'boomerang') return forward;
    return [...forward, ...forward.slice(1, -1).reverse()];
}

function checkStructure(gif, result, problems) {
    if (gif.width !== result.size.width || gif.height !== result.size.height) {
        problems.push(`${gif.width}x${gif.height}, expected ${result.size.width}x${result.size.height}`);
    }
    const expectedLoop = result.settings.loop === 'once' ? null : 0;
    if (gif.loop !== expectedLoop) problems.push(`loop block ${gif.loop}, expected ${expectedLoop}`);

    gif.frames.forEach((frame, i) => {
        if (frame.disposal !== 1) problems.push(`frame ${i} disposal ${frame.disposal}`);
        if (frame.localPalette) problems.push(`frame ${i} has a local palette`);
        if (frame.delay < 2) problems.push(`frame ${i} delay ${frame.delay}`);
        if (i === 0 && frame.transparentIndex !== null) problems.push('first frame has transparency');
        if (i > 0 && frame.transparentIndex !== 0) problems.push(`frame ${i} transparency ${frame.transparentIndex}`);
    });
}

function checkBarcodes(gif, result, problems) {
    const expected = expectedSequence(result.settings);
    if (gif.frames.length !== expected.length) {
        problems.push(`${gif.frames.length} frames, expected ${expected.length}`);
        return;
    }
    compositeFrames(gif).forEach((picture, i) => {
        const image = { data: toRgba(picture, gif.palette), width: gif.width, height: gif.height };
        const got = readBarcode(image, result.axis);
        if (got !== expected[i].frame) problems.push(`position ${i} shows frame ${got}, expected ${expected[i].frame}`);
        if (gif.frames[i].delay !== expected[i].delay) problems.push(`position ${i} delay ${gif.frames[i].delay}, expected ${expected[i].delay}`);
    });
}

function checkEstimate(result, problems) {
    const { low, high, exact } = result.estimate;
    if (exact && low !== high) problems.push('an exact estimate gave a range');
    if (result.expectExact && !exact) problems.push('expected an exact estimate');
    // Safari can decode a frame slightly differently on another pass.
    const lowBound = exact ? low * EXACT_TOLERANCE_LOW : low;
    const highBound = exact ? high * EXACT_TOLERANCE_HIGH : high;
    if (result.bytes < lowBound || result.bytes > highBound) {
        problems.push(`estimated ${Math.round(low)} to ${Math.round(high)}, actually ${result.bytes}`);
    }
}

function checkWithFfmpeg(bytes) {
    if (!FFMPEG_AVAILABLE) return null;
    const run = spawnSync('ffmpeg', ['-v', 'error', '-f', 'gif', '-i', 'pipe:0', '-f', 'null', '-'], { input: bytes });
    return run.status === 0 && run.stderr.length === 0 ? null : `ffmpeg: ${run.stderr.toString().slice(0, 200)}`;
}

function describeSuccess(result, gif) {
    const sizes = `${gif.frames.length} frames, ${Math.round(result.bytes / 1024)} KB, ${result.seconds}s`;
    if (!result.estimate) return sizes;
    const { low, high, exact } = result.estimate;
    const estimate = exact ? 'exact' : `${Math.round(low / 1024)}-${Math.round(high / 1024)} KB`;
    return `${sizes}, estimate ${estimate} in ${result.estimateSeconds}s`;
}

function checkResult(result, readGif) {
    if (result.status !== 'pass' || result.skipCheck) return result;

    const bytes = readGif(result.index);
    const gif = parseGif(new Uint8Array(bytes));
    const problems = [];

    if (bytes.length !== result.bytes) problems.push(`${bytes.length} bytes, reported ${result.bytes}`);
    if (result.blobType !== 'image/gif') problems.push(`blob type ${result.blobType}`);
    if (result.progress?.done !== result.progress?.total) problems.push('progress ended early');
    if (result.progress?.bytes > result.bytes) problems.push('progress overstated the bytes');

    checkStructure(gif, result, problems);
    if (result.expectFrames !== undefined && gif.frames.length !== result.expectFrames) {
        problems.push(`${gif.frames.length} frames, expected ${result.expectFrames}`);
    }
    if (!result.noBarcode) checkBarcodes(gif, result, problems);
    if (result.noBarcode && result.settings.loop === 'boomerang') {
        const frames = planFrames(result.settings).times.length;
        if (gif.frames.length !== outputFrameCount(frames, 'boomerang')) problems.push(`boomerang has ${gif.frames.length} frames`);
    }
    if (result.estimate) checkEstimate(result, problems);

    const ffmpegProblem = checkWithFfmpeg(bytes);
    if (ffmpegProblem) problems.push(ffmpegProblem);

    if (problems.length === 0) return { ...result, detail: describeSuccess(result, gif) };
    const shown = problems.slice(0, 5).join('; ');
    return { ...result, status: 'FAIL', detail: problems.length > 5 ? `${shown}; and ${problems.length - 5} more` : shown };
}

export function checkConvertReport(report, readGif) {
    return { ...report, results: report.results.map((result) => checkResult(result, readGif)) };
}
