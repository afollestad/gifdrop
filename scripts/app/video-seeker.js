// Seeks a <video> and resolves once the frame at the new position is showing.
// `seeked` alone isn't enough, since Safari and iOS can paint after it, and
// requestVideoFrameCallback alone isn't either, since a seek that lands on the
// frame already showing may never fire it. seek-policy.js decides between them.
import { confirmsSameFrame, isLongSeek, nextRecentLatency, presentFallbackMs, seekTarget, showsNewFrame } from './seek-policy.js';

const SEEK_WATCHDOG_MS = 15000;
const LOST_SEEKED_CHECK_MS = 1000;
const INITIAL_FRAME_WAIT_MS = 150;
const HAVE_CURRENT_DATA = 2;
const NEAR_END_SHARE = 0.9;

export class SeekStalledError extends Error {
    constructor(time, video) {
        super(`Seek stalled at ${time}s (seeking ${video.seeking}, ready ${video.readyState}, network ${video.networkState}, at ${video.currentTime}s)`);
        this.name = 'SeekStalledError';
        this.time = time;
    }
}

export class VideoDecodeError extends Error {
    constructor(time) {
        super(`Couldn't decode the video at ${time}s`);
        this.name = 'VideoDecodeError';
        this.time = time;
    }
}

export function captureAbortedError() {
    return new DOMException('Capture cancelled', 'AbortError');
}

// Background tabs throttle timers and frame callbacks, so nothing that waits on them
// can be trusted until the tab is back.
export function whenVisible(signal) {
    if (signal?.aborted) return Promise.reject(captureAbortedError());
    if (!document.hidden) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const finish = (settle) => {
            document.removeEventListener('visibilitychange', onChange);
            signal?.removeEventListener('abort', onAbort);
            settle();
        };
        const onChange = () => {
            if (!document.hidden) finish(resolve);
        };
        const onAbort = () => finish(() => reject(captureAbortedError()));
        document.addEventListener('visibilitychange', onChange);
        signal?.addEventListener('abort', onAbort);
    });
}

export class VideoSeeker {
    #video;
    #signal;
    #settled = false;
    #recentLatencyMs = 0;
    #shownMediaTime = null;
    #longSeekMisses = 0;

    presentFallbacks = 0;

    constructor(video, { signal } = {}) {
        this.#video = video;
        this.#signal = signal;
    }

    async seek(target) {
        if (!this.#settled) {
            await this.#settleInitialFrame();
            this.#settled = true;
        }
        await this.#seekOnce(target);
    }

    // A new video's first frame callback can arrive after the first seek has
    // finished, so it's drained first. A video that already painted never fires
    // one, hence the timeout.
    #settleInitialFrame() {
        const video = this.#video;
        return new Promise((resolve) => {
            let handle = null;
            const timer = setTimeout(() => {
                if (handle !== null) video.cancelVideoFrameCallback(handle);
                resolve();
            }, INITIAL_FRAME_WAIT_MS);
            if (video.requestVideoFrameCallback) {
                handle = video.requestVideoFrameCallback((now, metadata) => {
                    clearTimeout(timer);
                    this.#shownMediaTime = metadata.mediaTime;
                    resolve();
                });
            }
        });
    }

    #seekOnce(target) {
        const video = this.#video;
        const signal = this.#signal;
        const before = video.currentTime;
        const began = performance.now();
        const hasFrameCallback = Boolean(video.requestVideoFrameCallback);
        const distance = Math.abs(target - before);

        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(captureAbortedError());
                return;
            }

            let seeked = false;
            let latencyMs = null;
            let frameHandle = null;
            let fallback = null;
            let watchdog = null;
            let lostSeekedCheck = null;
            let sameFrameConfirmed = false;

            const finish = (error) => {
                clearTimeout(watchdog);
                clearTimeout(fallback);
                clearInterval(lostSeekedCheck);
                if (frameHandle !== null) video.cancelVideoFrameCallback(frameHandle);
                video.removeEventListener('seeked', onSeeked);
                video.removeEventListener('canplay', check);
                video.removeEventListener('error', onError);
                document.removeEventListener('visibilitychange', armWatchdog);
                signal?.removeEventListener('abort', onAbort);
                if (error) {
                    reject(error);
                } else {
                    this.#recentLatencyMs = nextRecentLatency(this.#recentLatencyMs, latencyMs);
                    if (isLongSeek(distance) && latencyMs === null) this.#longSeekMisses++;
                    resolve();
                }
            };

            const check = () => {
                if (!seeked || video.readyState < HAVE_CURRENT_DATA) return;
                if (latencyMs !== null) {
                    finish();
                } else if (fallback === null) {
                    armFallback();
                }
            };

            const armFallback = () => {
                clearTimeout(fallback);
                fallback = setTimeout(() => {
                    this.presentFallbacks++;
                    finish();
                }, presentFallbackMs({
                    distance,
                    recentLatencyMs: this.#recentLatencyMs,
                    hasFrameCallback,
                    sameFrameConfirmed,
                    longSeekMisses: this.#longSeekMisses,
                }));
            };

            const watchFrames = () => {
                frameHandle = video.requestVideoFrameCallback((now, metadata) => {
                    frameHandle = null;
                    if (showsNewFrame(metadata.mediaTime, target, before)) {
                        this.#shownMediaTime = metadata.mediaTime;
                        latencyMs = performance.now() - began;
                        check();
                        return;
                    }
                    if (!sameFrameConfirmed && confirmsSameFrame(metadata.mediaTime, this.#shownMediaTime, seeked)) {
                        sameFrameConfirmed = true;
                        armFallback();
                    }
                    watchFrames();
                });
            };

            // Throttled timers would make a hidden tab look stalled.
            function armWatchdog() {
                clearTimeout(watchdog);
                if (!document.hidden) {
                    watchdog = setTimeout(() => finish(new SeekStalledError(target, video)), SEEK_WATCHDOG_MS);
                }
            }

            function onSeeked() {
                seeked = true;
                check();
            }

            function onError() {
                finish(new VideoDecodeError(target));
            }

            function onAbort() {
                finish(captureAbortedError());
            }

            video.addEventListener('seeked', onSeeked);
            video.addEventListener('canplay', check);
            video.addEventListener('error', onError);
            document.addEventListener('visibilitychange', armWatchdog);
            signal?.addEventListener('abort', onAbort);
            armWatchdog();

            if (hasFrameCallback) watchFrames();

            video.currentTime = target;

            // `seeking` going false means the seek is over, so a `seeked` event that
            // never came shouldn't count as a stall.
            lostSeekedCheck = setInterval(() => {
                if (!seeked && !video.seeking) onSeeked();
            }, LOST_SEEKED_CHECK_MS);
        });
    }
}

// Whether seeking really reaches the end of this video. A file cut off partway, or
// WebM with no seek index in Firefox, reports `seeked` and its whole length as
// seekable while still showing an earlier frame, so the only sign is that no new
// frame arrives. A video that barely changes can also fail this, so it's for a
// warning rather than for refusing the file. Browsers without frame callbacks can't
// tell, and neither can a hidden tab, so it waits until it's back.
export async function canSeekNearEnd(video, { signal } = {}) {
    if (!video.requestVideoFrameCallback) return true;
    await whenVisible(signal);
    const seeker = new VideoSeeker(video, { signal });
    try {
        await seeker.seek(seekTarget(video.duration * NEAR_END_SHARE, video.duration));
    } catch (error) {
        if (error instanceof SeekStalledError || error instanceof VideoDecodeError) return false;
        throw error;
    }
    return document.hidden || seeker.presentFallbacks === 0;
}
