// One opened video: its object URL and two elements of its own. The preview is what
// people see and control. The capture element sits behind it, rendered but covered, so
// converting and estimating never disturb the preview, and its work runs one job at a
// time. Each session's elements are new, so anything still finishing from an earlier
// session can only touch elements that are already gone.
import { hasTransparency } from '../worker/alpha.js';
import { fullCrop } from './crop-math.js';
import { FrameGrabber } from './frame-grabber.js';
import { canSeekNearEnd } from './video-seeker.js';
import { isHdr, loadVideo, releaseVideo, resumeBlockedLoad } from './video-source.js';

const PROBE_WIDTH = 160;

function makeVideo(className, label) {
    const video = document.createElement('video');
    video.className = className;
    if (label) {
        video.setAttribute('aria-label', label);
    } else {
        video.setAttribute('aria-hidden', 'true');
        video.tabIndex = -1;
    }
    return video;
}

export class VideoSession {
    #url;
    #queue = Promise.resolve();
    #pendingSeek = null;
    #seeking = false;
    #closing = new AbortController();

    constructor({ stage, file }) {
        this.file = file;
        this.capture = makeVideo('stage-video');
        this.preview = makeVideo('stage-video stage-preview', 'Video preview');
        stage.prepend(this.capture, this.preview);
        this.#url = URL.createObjectURL(file);
        this.preview.addEventListener('seeked', () => this.#seekNext());
    }

    // Both load together, so a tap can unlock both at once if it comes to that.
    // Resolves when both are ready, and rejects with the first failure.
    open() {
        return Promise.all([loadVideo(this.preview, this.#url), loadVideo(this.capture, this.#url)]);
    }

    // For a load that failed as blocked, called directly from a tap's handler.
    resume() {
        return Promise.all([resumeBlockedLoad(this.preview), resumeBlockedLoad(this.capture)]);
    }

    get isHdr() {
        return isHdr(this.preview);
    }

    // Runs `task` once earlier capture work has finished, however it finished.
    runCapture(task) {
        const run = this.#queue.then(task, task);
        this.#queue = run.catch(() => {});
        return run;
    }

    canSeekNearEnd() {
        return this.runCapture(() => canSeekNearEnd(this.capture, { signal: this.#closing.signal }));
    }

    // Whether the first frame has any transparency, captured small, as frames are, since
    // a video that hasn't painted yet reads as transparent.
    firstFrameHasTransparency() {
        return this.runCapture(async () => {
            const { videoWidth, videoHeight } = this.capture;
            const width = Math.min(videoWidth, PROBE_WIDTH);
            const height = Math.max(1, Math.round(width * videoHeight / videoWidth));
            const crop = fullCrop(videoWidth, videoHeight);
            const grabber = new FrameGrabber(this.capture, { crop, width, height, alpha: true, signal: this.#closing.signal });
            return hasTransparency((await grabber.grab(0)).data);
        });
    }

    // Shows a moment in the preview. While a seek is underway only the latest request
    // is kept, so dragging never queues up seeks the video can't keep up with.
    seekPreview(time) {
        if (this.#seeking) {
            this.#pendingSeek = time;
            return;
        }
        this.#seeking = true;
        this.preview.currentTime = time;
    }

    #seekNext() {
        this.#seeking = false;
        if (this.#pendingSeek === null) return;
        const time = this.#pendingSeek;
        this.#pendingSeek = null;
        this.seekPreview(time);
    }

    close() {
        this.#closing.abort();
        for (const video of [this.preview, this.capture]) {
            releaseVideo(video);
            video.remove();
        }
        URL.revokeObjectURL(this.#url);
    }
}
