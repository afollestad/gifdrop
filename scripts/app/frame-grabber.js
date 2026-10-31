// Captures frames from a <video>, one seek at a time. Waits out a hidden tab,
// where throttled timers and frame callbacks can't be trusted to show the right
// frame, and retries a stalled seek once.
import { FrameReader } from './frame-reader.js';
import { seekTarget } from './seek-policy.js';
import { captureAbortedError, SeekStalledError, VideoSeeker } from './video-seeker.js';

const RETRY_OFFSET = 0.005;

function whenVisible(signal) {
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

export class FrameGrabber {
    #video;
    #signal;
    #onPaused;
    #seeker;
    #reader;
    #frames = 0;
    #retries = 0;
    #hiddenPauses = 0;

    constructor(video, { crop, width, height, signal, onPaused }) {
        this.#video = video;
        this.#signal = signal;
        this.#onPaused = onPaused;
        this.#seeker = new VideoSeeker(video, { signal });
        this.#reader = new FrameReader({ crop, width, height });
    }

    get stats() {
        return {
            frames: this.#frames,
            presentFallbacks: this.#seeker.presentFallbacks,
            retries: this.#retries,
            hiddenPauses: this.#hiddenPauses,
        };
    }

    // Resolves with the RGBA ImageData of the frame showing at `time`.
    async grab(time) {
        for (;;) {
            if (document.hidden) {
                this.#hiddenPauses++;
                this.#onPaused?.();
                await whenVisible(this.#signal);
            }
            await this.#seekWithRetry(time);
            if (!document.hidden) break;
        }
        this.#frames++;
        return this.#reader.read(this.#video);
    }

    async #seekWithRetry(time) {
        const { duration } = this.#video;
        try {
            await this.#seeker.seek(seekTarget(time, duration));
        } catch (error) {
            if (!(error instanceof SeekStalledError)) throw error;
            this.#retries++;
            try {
                await this.#seeker.seek(seekTarget(time + RETRY_OFFSET, duration));
            } catch (retryError) {
                if (retryError instanceof SeekStalledError) throw new SeekStalledError(time);
                throw retryError;
            }
        }
    }
}
