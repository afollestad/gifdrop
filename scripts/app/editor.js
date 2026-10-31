// Everything after a file is chosen: opening it, editing, estimating and converting.
// It's loaded separately from the page, so the page's first load stays small. Each open
// gets its own session, so anything finishing late from an earlier one can tell it's
// out of date and do nothing.
import { createControls } from '../ui/controls.js';
import { createCrop } from '../ui/crop.js';
import { createResult } from '../ui/result.js';
import { createTrim } from '../ui/trim.js';
import { convert } from './converter.js';
import { estimate } from './estimator.js';
import { formatBytes, formatTime } from './format.js';
import { convertErrorMessage, HDR_NOTICE, HIDDEN_TAB_MESSAGE, loadErrorMessage, UNREADABLE_END_NOTICE } from './messages.js';
import { aspectNumber, clampTrim, deriveOutput, initialSettings, playbackSeconds, widthLimit, withAspect, withCrop, withOutputWidth } from './settings.js';
import { VideoSession } from './video-session.js';

const ESTIMATE_DELAY_MS = 500;
const MIN_ETA_SAMPLE_S = 1;

// `els` holds the page's elements. `dispatch` sends state events to the app, and
// `status` announces to screen readers.
export function createEditor({ els, dispatch, status, prefersReducedMotion }) {
    let session = null;
    let settings = null;
    let notices = [];
    let lastEstimate = null;
    let estimateTimer = 0;
    let estimateJob = null;
    let conversion = null;
    let wantsPlaying = false;
    let lastAnnouncedError = null;

    const trim = createTrim({
        track: els.trimTrack,
        startRange: els.trimStart,
        endRange: els.trimEnd,
        startText: els.trimStartText,
        endText: els.trimEndText,
        length: els.trimLength,
        onChange: (trimStart, trimEnd, moved) => {
            pausePreview();
            settings = clampTrim({ ...settings, trimStart, trimEnd }, session.preview.duration, moved);
            trim.setRange(settings.trimStart, settings.trimEnd);
            session.seekPreview(moved === 'start' ? settings.trimStart : settings.trimEnd);
            refresh();
        },
    });

    const crop = createCrop({
        layer: els.cropLayer,
        box: els.cropBox,
        fields: els.cropFields,
        fieldset: els.cropFieldset,
        announcer: els.cropAnnouncer,
        aspectGroup: els.aspectOptions,
        // A drag can end after its video has been replaced, with nothing left to crop.
        onCrop: (next) => {
            if (!settings) return;
            settings = withCrop(settings, next, videoSize());
            renderCrop();
            refresh();
        },
        onAspect: (aspect) => {
            if (!settings) return;
            settings = withAspect(settings, aspect, videoSize());
            renderCrop();
            refresh();
        },
    });

    const controls = createControls({
        els: els.controls,
        onChange: ({ width, ...change }) => {
            const changed = width === undefined ? settings : withOutputWidth(settings, width);
            settings = clampTrim({ ...changed, ...change }, session.preview.duration, 'end');
            session.preview.playbackRate = settings.speed;
            trim.setRange(settings.trimStart, settings.trimEnd);
            refresh();
        },
        onConvert: () => startConversion(),
    });

    const result = createResult({ els: els.result, prefersReducedMotion });

    function videoSize() {
        return { videoWidth: session.preview.videoWidth, videoHeight: session.preview.videoHeight };
    }

    function renderCrop() {
        crop.update(settings.crop, settings.aspect, aspectNumber(settings.aspect));
    }

    function render() {
        const derived = deriveOutput(settings, { estimateUpperBytes: lastEstimate?.high ?? 0 });
        controls.render({
            settings,
            size: derived.size,
            maxWidth: widthLimit(settings.crop),
            errors: derived.errors,
            warnings: [...notices, ...derived.warnings],
        });
        const [error = null] = derived.errors;
        if (error !== lastAnnouncedError) {
            lastAnnouncedError = error;
            if (error) status.say(error);
        }
        return derived;
    }

    // After any change: the screen updates now, and the estimate follows when things
    // settle. Nothing waits on it. The last estimate stays in play until then, so a size
    // warning doesn't vanish and return, moving Convert each time.
    function refresh() {
        const derived = render();
        cancelEstimate();
        if (derived.errors.length > 0) {
            controls.showNoEstimate();
            return;
        }
        controls.showEstimating();
        estimateTimer = setTimeout(() => runEstimate(session), ESTIMATE_DELAY_MS);
    }

    function cancelEstimate() {
        clearTimeout(estimateTimer);
        estimateJob?.abort();
        estimateJob = null;
    }

    async function runEstimate(owner) {
        const job = new AbortController();
        estimateJob = job;
        const { plan, size } = deriveOutput(settings);
        const { crop: cropRect, quality, loop } = settings;
        try {
            const range = await owner.runCapture(() => {
                job.signal.throwIfAborted();
                return estimate({ video: owner.capture, plan, crop: cropRect, size, quality, loop, signal: job.signal });
            });
            if (job.signal.aborted || owner !== session) return;
            lastEstimate = range;
            status.say(controls.showEstimate(range));
            render();
        } catch (error) {
            if (job.signal.aborted || owner !== session) return;
            console.warn('Estimate failed', error);
            controls.showNoEstimate();
        }
    }

    function setPlaying(playing) {
        wantsPlaying = playing;
        els.playToggle.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview');
        els.playToggle.classList.toggle('is-playing', playing);
    }

    function pausePreview() {
        if (!session) return;
        session.preview.pause();
        setPlaying(false);
    }

    async function togglePreview() {
        const { preview } = session;
        if (!preview.paused) {
            pausePreview();
            return;
        }
        if (preview.currentTime < settings.trimStart || preview.currentTime >= settings.trimEnd) {
            preview.currentTime = settings.trimStart;
        }
        preview.playbackRate = settings.speed;
        try {
            await preview.play();
            setPlaying(true);
        } catch {
            setPlaying(false);
        }
    }

    // Keeps playback inside the trim. Loading can play a video briefly, before there are
    // any settings to go by, and it can reach its end while paused, which isn't a request
    // to play.
    function bindPlayback(owner) {
        const video = owner.preview;
        video.addEventListener('timeupdate', () => {
            if (owner !== session || !settings || !wantsPlaying) return;
            if (video.currentTime >= settings.trimEnd) video.currentTime = settings.trimStart;
        });
        video.addEventListener('ended', () => {
            if (owner !== session || !settings || !wantsPlaying) return;
            video.currentTime = settings.trimStart;
            video.play().catch(() => setPlaying(false));
        });
    }

    els.playToggle.addEventListener('click', () => togglePreview());

    function applyAspectRatio(video) {
        els.stageFrame.style.setProperty('--video-aspect', video.videoWidth / video.videoHeight);
    }

    function failLoad(error) {
        closeSession();
        dispatch('loadFailed', { message: loadErrorMessage(error.reason) });
    }

    function afterOpen(owner) {
        if (owner !== session) return;
        const video = owner.preview;
        applyAspectRatio(video);
        settings = initialSettings(video);
        notices = owner.isHdr ? [HDR_NOTICE] : [];
        lastEstimate = null;
        trim.setDuration(video.duration);
        trim.setRange(settings.trimStart, settings.trimEnd);
        crop.setVideoSize(video.videoWidth, video.videoHeight);
        video.currentTime = 0;
        renderCrop();
        els.stageLoading.hidden = true;
        els.unblockPanel.hidden = true;
        dispatch('loaded');
        refresh();

        // Doesn't hold anything up, and only ever adds a warning.
        owner.canSeekNearEnd().then((reachable) => {
            if (owner !== session || reachable) return;
            notices = [...notices, UNREADABLE_END_NOTICE];
            render();
        }, () => {});
    }

    function closeSession() {
        cancelEstimate();
        conversion?.abort();
        conversion = null;
        result.clear();
        session?.close();
        session = null;
        settings = null;
        lastAnnouncedError = null;
    }

    async function startConversion() {
        cancelEstimate();
        pausePreview();
        const owner = session;
        const { plan, size } = deriveOutput(settings);
        const { crop: cropRect, quality, loop } = settings;
        const job = new AbortController();
        conversion = job;
        const isCurrent = () => conversion === job && owner === session;

        status.resetProgress();
        dispatch('convert');
        els.progressBar.value = 0;
        els.progressDetail.textContent = 'Reading the video…';

        const began = performance.now();
        let pausedFor = 0;
        let pausedAt = 0;

        const onProgress = ({ done, total, bytes }) => {
            if (!isCurrent()) return;
            const share = done / total;
            els.progressBar.value = share;
            const elapsed = (performance.now() - began - pausedFor) / 1000;
            const left = Math.ceil((elapsed / done) * (total - done));
            const eta = elapsed >= MIN_ETA_SAMPLE_S && left > 0 ? `, about ${formatTime(left).replace(/\.\d$/, '')} left` : '';
            const written = bytes > 0 ? `${formatBytes(bytes)} so far` : 'Reading the video';
            // A boomerang writes its return trip after the last frame is captured.
            els.progressDetail.textContent = done === total ? 'Finishing up…' : `${written}${eta}`;
            status.progress(share, `${Math.round(share * 100)} percent done`);
        };

        try {
            const output = await owner.runCapture(() => {
                job.signal.throwIfAborted();
                return convert({
                    video: owner.capture,
                    plan,
                    crop: cropRect,
                    size,
                    quality,
                    loop,
                    signal: job.signal,
                    onProgress,
                    onPaused: () => {
                        pausedAt = performance.now();
                        if (isCurrent()) els.progressDetail.textContent = HIDDEN_TAB_MESSAGE;
                    },
                    onResumed: () => {
                        pausedFor += performance.now() - pausedAt;
                    },
                });
            });
            if (!isCurrent()) return;
            await result.show(output, { sourceName: owner.file.name, seconds: playbackSeconds(plan, loop) });
            if (!isCurrent()) return;
            conversion = null;
            dispatch('converted');
        } catch (error) {
            if (!isCurrent()) return;
            conversion = null;
            console.error('Conversion failed', error);
            dispatch('convertFailed', { message: convertErrorMessage(error) });
        }
    }

    return {
        // Shows the file as soon as it can, and finishes loading behind that.
        async open(file) {
            closeSession();
            const owner = new VideoSession({ stage: els.stage, file });
            session = owner;
            bindPlayback(owner);
            els.stageLoading.hidden = false;
            els.unblockPanel.hidden = true;
            els.cropLayer.hidden = true;
            controls.setConvertEnabled(false);
            controls.showNoEstimate();
            setPlaying(false);
            owner.preview.addEventListener('loadedmetadata', () => {
                if (owner === session) applyAspectRatio(owner.preview);
            }, { once: true });

            try {
                await owner.open();
                afterOpen(owner);
            } catch (error) {
                if (owner !== session) return;
                if (error.reason === 'blocked') {
                    els.stageLoading.hidden = true;
                    els.unblockPanel.hidden = false;
                    dispatch('needsTap');
                    return;
                }
                failLoad(error);
            }
        },

        // From the tap asking to open a video that was blocked.
        async unblock() {
            const owner = session;
            if (!owner) return;
            els.unblockPanel.hidden = true;
            els.stageLoading.hidden = false;
            try {
                await owner.resume();
                afterOpen(owner);
            } catch (error) {
                if (owner === session) failLoad(error);
            }
        },

        cancel() {
            conversion?.abort();
            conversion = null;
            dispatch('cancel');
            refresh();
        },

        adjust() {
            dispatch('adjust');
            refresh();
        },

        // After a failed conversion, once the error is dismissed.
        resume() {
            if (session && settings) refresh();
        },
    };
}
