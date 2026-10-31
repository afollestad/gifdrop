// Seeks a <video> and resolves once the frame at the new position is showing.
// `seeked` alone isn't enough, since Safari and iOS can paint after it, and
// requestVideoFrameCallback alone isn't either, since a seek that lands on the
// frame already showing may never fire it. seek-policy.js decides between them.
import { nextRecentLatency, presentFallbackMs, seekTarget, showsNewFrame } from './seek-policy.js';

const SEEK_WATCHDOG_MS = 15000;
const INITIAL_FRAME_WAIT_MS = 150;
const HAVE_CURRENT_DATA = 2;
const NEAR_END_SHARE = 0.9;

export class SeekStalledError extends Error {
    constructor(time) {
        super(`Seek stalled at ${time}s`);
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

export class VideoSeeker {
    #video;
    #signal;
    #settled = false;
    #recentLatencyMs = 0;

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
                handle = video.requestVideoFrameCallback(() => {
                    clearTimeout(timer);
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

            const finish = (error) => {
                clearTimeout(watchdog);
                clearTimeout(fallback);
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
                    resolve();
                }
            };

            const check = () => {
                if (!seeked || video.readyState < HAVE_CURRENT_DATA) return;
                if (latencyMs !== null) {
                    finish();
                } else if (fallback === null) {
                    fallback = setTimeout(() => {
                        this.presentFallbacks++;
                        finish();
                    }, presentFallbackMs({
                        distance: Math.abs(target - before),
                        recentLatencyMs: this.#recentLatencyMs,
                        hasFrameCallback,
                    }));
                }
            };

            const watchFrames = () => {
                frameHandle = video.requestVideoFrameCallback((now, metadata) => {
                    frameHandle = null;
                    if (showsNewFrame(metadata.mediaTime, target, before)) {
                        latencyMs = performance.now() - began;
                        check();
                    } else {
                        watchFrames();
                    }
                });
            };

            // Throttled timers would make a hidden tab look stalled.
            function armWatchdog() {
                clearTimeout(watchdog);
                if (!document.hidden) {
                    watchdog = setTimeout(() => finish(new SeekStalledError(target)), SEEK_WATCHDOG_MS);
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
        });
    }
}

// Whether seeking really reaches the end of this video. A file cut off partway, or
// WebM with no seek index in Firefox, reports `seeked` and its whole length as
// seekable while still showing an earlier frame, so the only sign is that no new
// frame arrives. A video that barely changes can also fail this, so it's for a
// warning rather than for refusing the file. Browsers without frame callbacks can't
// tell.
export async function canSeekNearEnd(video) {
    if (!video.requestVideoFrameCallback) return true;
    const seeker = new VideoSeeker(video);
    try {
        await seeker.seek(seekTarget(video.duration * NEAR_END_SHARE, video.duration));
    } catch (error) {
        if (error instanceof SeekStalledError || error instanceof VideoDecodeError) return false;
        throw error;
    }
    return seeker.presentFallbacks === 0;
}
