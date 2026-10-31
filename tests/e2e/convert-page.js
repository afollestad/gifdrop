// Converts each case through the real converter and worker, and posts every GIF back
// for convert-check.mjs to read. Also checks what only a browser can: cancelling, and
// whether the size estimate holds up.
import { convert } from '/scripts/app/converter.js';
import { fullCrop } from '/scripts/app/crop-math.js';
import { estimate } from '/scripts/app/estimator.js';
import { planFrames, outputSize } from '/scripts/app/plan.js';
import { SIZE_LIMITS } from '/scripts/app/limits.js';
import { loadVideo, releaseVideo, VideoLoadError } from '/scripts/app/video-source.js';
import { CONVERT_CASES } from '/tests/e2e/convert-cases.js';

const reportName = new URLSearchParams(location.search).get('report') ?? 'convert';
const UNSUPPORTED_REASONS = new Set(['undecodable', 'timeout']);

function log(line) {
    document.getElementById('log').textContent += `${line}\n`;
}

async function post(name, ext, body) {
    await fetch(`/report?name=${encodeURIComponent(name)}&ext=${ext}`, { method: 'POST', body });
}

async function openFixture(src) {
    const response = await fetch(`/tests/fixtures/${src}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(new File([blob], src, { type: blob.type }));
    const video = document.createElement('video');
    document.getElementById('stage').append(video);
    return {
        video,
        url,
        close() {
            releaseVideo(video);
            video.remove();
            URL.revokeObjectURL(url);
        },
    };
}

function settingsFor(testCase, video) {
    const crop = testCase.crop ?? fullCrop(video.videoWidth, video.videoHeight);
    const settings = {
        trimStart: testCase.trimStart ?? 0,
        trimEnd: testCase.trimEnd ?? Math.floor(video.duration),
        fps: testCase.fps ?? 15,
        speed: testCase.speed ?? 1,
        loop: testCase.loop ?? 'forever',
        quality: testCase.quality ?? 'balanced',
    };
    return {
        ...settings,
        crop,
        plan: planFrames(settings),
        size: outputSize(crop, testCase.width ?? 320, SIZE_LIMITS),
    };
}

async function runCase(testCase, index) {
    const result = { name: testCase.name, index, noBarcode: Boolean(testCase.noBarcode), axis: testCase.axis, expectFrames: testCase.expectFrames, expectExact: testCase.expectExact };
    const { video, url, close } = await openFixture(testCase.src ?? 'barcode.mp4');
    try {
        await loadVideo(video, url);
        const settings = settingsFor(testCase, video);
        const { plan, size, crop, quality, loop } = settings;
        Object.assign(result, {
            settings: { trimStart: settings.trimStart, trimEnd: settings.trimEnd, fps: settings.fps, speed: settings.speed, loop },
            size,
        });

        if (testCase.estimate) {
            const began = performance.now();
            result.estimate = await estimate({ video, plan, crop, size, quality, loop });
            result.estimateSeconds = Number(((performance.now() - began) / 1000).toFixed(2));
        }

        let lastProgress = null;
        const began = performance.now();
        const output = await convert({ video, plan, crop, size, quality, loop, onProgress: (progress) => { lastProgress = progress; } });
        result.seconds = Number(((performance.now() - began) / 1000).toFixed(2));
        result.bytes = output.bytes;
        result.blobBytes = output.blob.size;
        result.blobType = output.blob.type;
        result.frames = output.frames;
        result.progress = lastProgress;
        result.stats = output.stats;
        await post(`${reportName}-${index}`, 'gif', output.blob);
        result.status = 'pass';
    } catch (error) {
        const unsupported = testCase.optionalCodec && error instanceof VideoLoadError && UNSUPPORTED_REASONS.has(error.reason);
        result.status = unsupported ? 'unsupported' : 'ERROR';
        result.error = String(error);
    } finally {
        close();
    }
    return result;
}

// Cancels partway through, then converts again on the same video to show that nothing
// was left in a bad state.
async function checkCancelling() {
    const result = { name: 'cancelled partway', skipCheck: true };
    const { video, url, close } = await openFixture('barcode.mp4');
    try {
        await loadVideo(video, url);
        const { plan, size, crop, quality, loop } = settingsFor({}, video);
        const controller = new AbortController();
        let stepsAtAbort = 0;
        let stepsAfterwards = 0;
        const job = convert({
            video, plan, crop, size, quality, loop,
            signal: controller.signal,
            onProgress: ({ done }) => {
                if (controller.signal.aborted) stepsAfterwards++;
                else if (done === 40) {
                    stepsAtAbort = done;
                    controller.abort();
                }
            },
        });
        let errorName = 'none';
        try {
            await job;
        } catch (error) {
            errorName = error.name;
        }
        const again = await convert({ video, plan, crop, size, quality, loop });
        const ok = errorName === 'AbortError' && stepsAtAbort === 40 && stepsAfterwards <= 1 && again.frames === plan.times.length;
        result.status = ok ? 'pass' : 'FAIL';
        result.detail = `${errorName} at step ${stepsAtAbort}, ${stepsAfterwards} steps after, then ${again.frames} frames`;
    } catch (error) {
        result.status = 'ERROR';
        result.error = String(error);
    } finally {
        close();
    }
    return result;
}

// Starting with a signal that's already aborted shouldn't do any work.
async function checkAlreadyCancelled() {
    const result = { name: 'cancelled before starting', skipCheck: true };
    const { video, url, close } = await openFixture('barcode.mp4');
    try {
        await loadVideo(video, url);
        const { plan, size, crop, quality, loop } = settingsFor({}, video);
        const controller = new AbortController();
        controller.abort();
        let steps = 0;
        let errorName = 'none';
        try {
            await convert({ video, plan, crop, size, quality, loop, signal: controller.signal, onProgress: () => { steps++; } });
        } catch (error) {
            errorName = error.name;
        }
        result.status = errorName === 'AbortError' && steps === 0 ? 'pass' : 'FAIL';
        result.detail = `${errorName}, ${steps} steps`;
    } finally {
        close();
    }
    return result;
}

const results = [];
for (const [index, testCase] of CONVERT_CASES.entries()) {
    log(`Running ${testCase.name}...`);
    results.push(await runCase(testCase, index));
    log(`  ${results.at(-1).status} ${results.at(-1).error ?? ''}`);
    await post(`${reportName}-progress`, 'json', JSON.stringify({ userAgent: navigator.userAgent, hidden: document.hidden, results }));
}
results.push(await checkCancelling());
results.push(await checkAlreadyCancelled());

await post(reportName, 'json', JSON.stringify({ userAgent: navigator.userAgent, hidden: document.hidden, results }));
log('Done.');
