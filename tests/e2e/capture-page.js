// Runs every case through FrameGrabber in whichever browser opened this page,
// reads each captured frame's barcode, and reports frames that don't match the
// time they were asked for. No gesture is involved, so this also shows whether
// an untouched video paints on iOS.
import { FrameGrabber } from '/scripts/app/frame-grabber.js';
import { canSeekNearEnd } from '/scripts/app/video-seeker.js';
import { loadVideo, releaseVideo, resumeBlockedLoad, VideoLoadError } from '/scripts/app/video-source.js';
import { readBarcode } from '/tests/barcode.js';
import { CAPTURE_CASES, REJECTED_FILES } from '/tests/e2e/capture-cases.js';

const reportName = new URLSearchParams(location.search).get('report') ?? 'capture';
const UNSUPPORTED_REASONS = new Set(['undecodable', 'timeout']);

// Object URLs from a File, as the app gets from a drop or the file picker, since
// browsers can load those differently from a video on a server.
async function fixtureUrl(src) {
    const response = await fetch(`/tests/fixtures/${src}`);
    const blob = await response.blob();
    return URL.createObjectURL(new File([blob], src, { type: blob.type }));
}
const frameAt30 = (t) => Math.floor(t * 30);

function log(line) {
    document.getElementById('log').textContent += `${line}\n`;
}

function makeVideo() {
    const video = document.createElement('video');
    document.getElementById('stage').append(video);
    return video;
}

function removeVideo(video) {
    releaseVideo(video);
    video.remove();
}

async function startPreview(preview, url) {
    preview.loop = true;
    await loadVideo(preview, url);
    try {
        await preview.play();
        return true;
    } catch (error) {
        return String(error);
    }
}

async function captureAll(video, testCase, grabber, wrong) {
    const speed = testCase.speed ?? 1;
    const start = testCase.start ?? 0;
    const frameAt = testCase.frameAt ?? frameAt30;
    const step = speed / testCase.fps;
    const duration = (testCase.end ?? Math.floor(video.duration)) - start;
    const count = Math.max(1, Math.round(duration / step));
    for (let i = 0; i < count; i++) {
        const t = start + i * step;
        const image = await grabber.grab(t);
        const got = readBarcode(image, testCase.axis);
        const expected = frameAt(t + 0.001);
        if (got !== expected) wrong.push({ i, t: Number(t.toFixed(4)), expected, got });
    }
    return count;
}

// iOS can't get frames without playing, so it fails as blocked and takes the tap's
// path. Others have the frame by then, and shouldn't notice.
async function loadWithRefusedPlay(video, url) {
    video.play = () => Promise.reject(new DOMException('Refused', 'NotAllowedError'));
    try {
        await loadVideo(video, url);
    } catch (error) {
        if (error.reason !== 'blocked') throw error;
        delete video.play;
        await resumeBlockedLoad(video);
    }
}

async function runCase(testCase) {
    const url = await fixtureUrl(testCase.src);
    const video = makeVideo();
    const preview = testCase.withPreview ? makeVideo() : null;
    const result = { name: testCase.name };
    // Shadows the method on this element, as a browser without it would have.
    if (testCase.noFrameCallback) video.requestVideoFrameCallback = undefined;
    try {
        if (testCase.refusePlay) await loadWithRefusedPlay(video, url);
        else await loadVideo(video, url);
        result.size = [video.videoWidth, video.videoHeight];
        const sizeOk = !testCase.expectSize || (video.videoWidth === testCase.expectSize[0] && video.videoHeight === testCase.expectSize[1]);

        if (preview) result.previewPlaying = await startPreview(preview, url);

        // Checked first where it decides whether the frames mean anything, and after
        // capturing otherwise, so the first capture still follows a fresh load.
        if (testCase.mayNotSeek || testCase.mustNotSeek) {
            const reachable = await canSeekNearEnd(video);
            if (!reachable) {
                result.status = 'flagged';
                result.error = 'Flagged as not readable to the end';
                return result;
            }
            if (testCase.mustNotSeek) {
                result.status = 'FAIL';
                result.error = 'Not flagged, though the file stops partway';
                return result;
            }
        }

        const outputWidth = testCase.outputWidth ?? 320;
        const makeGrabber = () => new FrameGrabber(video, {
            crop: { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight },
            width: outputWidth,
            height: Math.round(outputWidth * video.videoHeight / video.videoWidth),
        });

        const wrong = [];
        const grabber = makeGrabber();
        const began = performance.now();
        let frames = await captureAll(video, testCase, grabber, wrong);
        const elapsed = performance.now() - began;
        if (testCase.rerun) frames += await captureAll(video, testCase, makeGrabber(), wrong);

        result.frames = frames;
        result.wrong = wrong.length;
        result.wrongSample = wrong.slice(0, 8);
        result.capturedPerSecond = Number((grabber.stats.frames / (elapsed / 1000)).toFixed(1));
        result.stats = grabber.stats;
        const flaggedWrongly = !testCase.mayNotSeek && !(await canSeekNearEnd(video));
        if (flaggedWrongly) result.error = 'Flagged as not readable to the end';
        result.status = wrong.length === 0 && sizeOk && !flaggedWrongly ? 'pass' : 'FAIL';
    } catch (error) {
        const unsupported = testCase.optionalCodec && error instanceof VideoLoadError && UNSUPPORTED_REASONS.has(error.reason);
        result.status = unsupported ? 'unsupported' : 'ERROR';
        result.error = String(error);
    } finally {
        removeVideo(video);
        if (preview) removeVideo(preview);
        URL.revokeObjectURL(url);
    }
    return result;
}

async function checkRejected({ name, src }) {
    const url = await fixtureUrl(src);
    const video = makeVideo();
    try {
        await loadVideo(video, url);
        return { name, status: 'FAIL', error: 'Loaded as if playable' };
    } catch (error) {
        const rejected = error instanceof VideoLoadError;
        return { name, status: rejected ? 'pass' : 'ERROR', error: rejected ? `rejected: ${error.reason}` : String(error) };
    } finally {
        removeVideo(video);
        URL.revokeObjectURL(url);
    }
}

async function post(name, payload) {
    await fetch(`/report?name=${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(payload, null, 2) });
}

const results = [];
for (const testCase of CAPTURE_CASES) {
    log(`Running ${testCase.name}...`);
    const result = await runCase(testCase);
    results.push(result);
    log(`  ${result.status} ${result.error ?? `${result.wrong}/${result.frames} wrong`}`);
    await post(`${reportName}-progress`, { userAgent: navigator.userAgent, hidden: document.hidden, results });
}
for (const file of REJECTED_FILES) results.push(await checkRejected(file));

await post(reportName, { userAgent: navigator.userAgent, hidden: document.hidden, results });
log('Done.');
