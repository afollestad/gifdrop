// One opened video: its object URL and two elements of its own. The preview is what
// people see and control. The capture element sits behind it, rendered but covered, so
// converting and estimating never disturb the preview, and its work runs one job at a
// time. Each session's elements are new, so anything still finishing from an earlier
// session can only touch elements that are already gone.
import { canSeekNearEnd } from './video-seeker.js';
import { isHdr, loadVideo, releaseVideo, resumeBlockedLoad } from './video-source.js';

function makeVideo(label) {
    const video = document.createElement('video');
    video.className = 'stage-video';
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
        this.capture = makeVideo();
        this.preview = makeVideo('Video preview');
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
