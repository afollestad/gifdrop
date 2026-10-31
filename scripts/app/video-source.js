// Loads a video into a <video> element until its frames can be captured, and
// says why when they can't.

const LOAD_TIMEOUT_MS = 20000;
const FETCH_GRACE_MS = 500;
const REFUSED_PLAY_GRACE_MS = 5000;
const FIRST_SEEK_TIME = 0.05;
const PROBE_TIMEOUT_MS = 10000;
const PROBE_TIME = 1e7;
const HAVE_CURRENT_DATA = 2;

export class VideoLoadError extends Error {
    // `reason` is one of:
    //   undecodable - the browser can't read the file
    //   no-video    - it read the file, which has no picture
    //   blocked     - the browser wouldn't start it without a tap
    //   timeout     - it never got as far as a frame
    constructor(reason, message) {
        super(message);
        this.name = 'VideoLoadError';
        this.reason = reason;
    }
}

function waitForEvents(video, eventNames, timeoutMs) {
    return new Promise((resolve, reject) => {
        const finish = (settle) => {
            clearTimeout(timer);
            for (const eventName of eventNames) video.removeEventListener(eventName, onEvent);
            video.removeEventListener('error', onError);
            settle();
        };
        const onEvent = () => finish(resolve);
        const onError = () => finish(() => reject(new VideoLoadError('undecodable', `Media error ${video.error?.code ?? 'unknown'}`)));
        const timer = setTimeout(() => finish(() => reject(new VideoLoadError('timeout', `Timed out waiting for ${eventNames.join(' or ')}`))), timeoutMs);
        for (const eventName of eventNames) video.addEventListener(eventName, onEvent);
        video.addEventListener('error', onError);
    });
}

function rejectAfter(timeoutMs) {
    let timer;
    const promise = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new VideoLoadError('timeout', 'Timed out starting playback')), timeoutMs);
    });
    return { promise, cancel: () => clearTimeout(timer) };
}

// iOS holds back frame data until a video has played, whatever `preload` says,
// so a video with none shortly after its metadata gets played. Other browsers
// have it by then, or soon after.
async function ensureFrameData(video) {
    if (video.readyState >= HAVE_CURRENT_DATA) return;
    try {
        await waitForEvents(video, ['loadeddata'], FETCH_GRACE_MS);
    } catch (error) {
        if (error.reason !== 'timeout') throw error;
    }
    if (video.readyState >= HAVE_CURRENT_DATA) return;
    await playForFrameData(video);
}

// Muted inline video may play without a tap, except in iOS Low Power Mode, which
// rejects with NotAllowedError. Desktop Safari can refuse too, while still loading
// on its own, so a refusal only counts once the frame has had time to arrive
// anyway. iOS can also leave play() unsettled for a codec it can't decode, hence
// the timeout.
async function playForFrameData(video) {
    const timeout = rejectAfter(LOAD_TIMEOUT_MS);
    try {
        await Promise.race([video.play(), timeout.promise]);
        video.pause();
        await spendFirstSeek(video);
    } catch (error) {
        if (error instanceof VideoLoadError) throw error;
        if (error.name !== 'NotAllowedError') throw new VideoLoadError('undecodable', error.message);
        await waitForFrameAfterRefusal(video);
    } finally {
        timeout.cancel();
    }
}

// On iOS the first seek after that pause can report `seeked` without ever
// painting, however long it's given, while a later one to a different position
// paints at once. Repeating the position doesn't help, and neither does seeking
// to 0, where the video already is. Near the start is the cheapest place to
// spend it, since there's little to decode.
async function spendFirstSeek(video) {
    const seeked = waitForEvents(video, ['seeked'], PROBE_TIMEOUT_MS);
    video.currentTime = Math.min(FIRST_SEEK_TIME, video.duration / 2);
    await seeked;
}

async function waitForFrameAfterRefusal(video) {
    if (video.readyState >= HAVE_CURRENT_DATA) return;
    try {
        await waitForEvents(video, ['loadeddata'], REFUSED_PLAY_GRACE_MS);
    } catch (error) {
        if (error.reason !== 'timeout') throw error;
        throw new VideoLoadError('blocked', 'Playback needs a tap');
    }
}

// Recorded WebM often has no duration in its header. Seeking past the end makes
// the browser work it out.
async function resolveDuration(video) {
    if (Number.isFinite(video.duration)) return;
    const changed = waitForEvents(video, ['durationchange'], PROBE_TIMEOUT_MS);
    video.currentTime = PROBE_TIME;
    await changed;
    if (!Number.isFinite(video.duration)) throw new VideoLoadError('timeout', 'Could not work out the duration');
    const seeked = waitForEvents(video, ['seeked'], PROBE_TIMEOUT_MS);
    video.currentTime = 0;
    await seeked;
}

export async function loadVideo(video, url) {
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');

    const metadata = waitForEvents(video, ['loadedmetadata'], LOAD_TIMEOUT_MS);
    video.src = url;
    await metadata;

    if (video.videoWidth === 0) throw new VideoLoadError('no-video', 'The file has no video track');

    await ensureFrameData(video);
    await resolveDuration(video);
}

// Whether the picture is HDR, in which case the browser tone-maps it down for the
// GIF and colors may look flatter than in the original.
export function isHdr(video) {
    if (typeof VideoFrame === 'undefined') return false;
    try {
        const frame = new VideoFrame(video);
        const { transfer } = frame.colorSpace;
        frame.close();
        return transfer === 'pq' || transfer === 'hlg';
    } catch {
        return false;
    }
}

// Finishes a load that failed as `blocked`. Call this directly from a tap's
// handler, since play() has to start within the tap.
export async function resumeBlockedLoad(video) {
    await playForFrameData(video);
    await resolveDuration(video);
}

// Decoders are scarce on phones, and revoking a URL doesn't free one, so this
// comes before revoking.
export function releaseVideo(video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
}
