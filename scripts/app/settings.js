// What someone has chosen, and what it works out to. Pure, so every combination can
// be tested without a page.
import { centeredCrop, clampCrop, fullCrop } from './crop-math.js';
import { checkOutput, DEFAULTS, SIZE_LIMITS } from './limits.js';
import { outputSize, planFrames, widthForLongestEdge } from './plan.js';

export function initialSettings({ videoWidth, videoHeight, duration }) {
    const crop = fullCrop(videoWidth, videoHeight);
    return {
        trimStart: 0,
        trimEnd: Math.min(duration, DEFAULTS.trimSeconds),
        aspect: 'original',
        crop,
        width: widthForLongestEdge(crop, DEFAULTS.longestEdge),
        requestedWidth: widthForLongestEdge(crop, DEFAULTS.longestEdge),
        fps: DEFAULTS.fps,
        speed: DEFAULTS.speed,
        quality: DEFAULTS.quality,
        loop: DEFAULTS.loop,
    };
}

// The shortest trim that still makes a frame.
export function minimumTrim({ fps, speed }) {
    return speed / fps;
}

// Keeps the two ends in order and at least one frame apart, moving whichever end
// wasn't just set.
export function clampTrim(settings, duration, moved) {
    const gap = Math.min(minimumTrim(settings), duration);
    let trimStart = Math.max(0, Math.min(settings.trimStart, duration));
    let trimEnd = Math.max(0, Math.min(settings.trimEnd, duration));
    if (trimEnd - trimStart < gap) {
        if (moved === 'end') {
            trimEnd = Math.max(trimEnd, gap);
            trimStart = trimEnd - gap;
        } else {
            trimStart = Math.min(trimStart, duration - gap);
            trimEnd = trimStart + gap;
        }
    }
    return { ...settings, trimStart, trimEnd };
}

// `aspect` is 'original', 'free', or width over height as a string.
export function withAspect(settings, aspect, { videoWidth, videoHeight }) {
    const ratio = Number(aspect);
    const crop = Number.isFinite(ratio) ? centeredCrop(videoWidth, videoHeight, ratio) : fullCrop(videoWidth, videoHeight);
    return { ...settings, aspect, crop, width: keptWidth(settings, crop) };
}

// With a fixed shape, a change to one dimension carries the other with it, shrinking to
// fit if that would run past the frame.
function holdAspect(crop, previous, aspect, videoWidth, videoHeight) {
    const ratio = aspectNumber(aspect);
    if (ratio === null || (crop.width === previous.width && crop.height === previous.height)) return crop;
    const heightLed = crop.height !== previous.height && crop.width === previous.width;
    const requestedWidth = heightLed ? crop.height * ratio : crop.width;
    const width = Math.min(requestedWidth, videoWidth, videoHeight * ratio);
    return { ...crop, width, height: width / ratio };
}

export function withCrop(settings, crop, { videoWidth, videoHeight }) {
    const held = holdAspect(crop, settings.crop, settings.aspect, videoWidth, videoHeight);
    const fitted = clampCrop(held, videoWidth, videoHeight);
    return { ...settings, crop: fitted, width: keptWidth(settings, fitted) };
}

// A crop can't be scaled up, so it can hold the width below what was asked for, but only
// for as long as it's that small.
function keptWidth(settings, crop) {
    return Math.min(settings.requestedWidth, crop.width, widthLimit(crop));
}

export function withOutputWidth(settings, width) {
    return { ...settings, requestedWidth: width, width: Math.min(width, settings.crop.width, widthLimit(settings.crop)) };
}

// The widest output this crop allows, staying within both size limits.
export function widthLimit(crop) {
    return outputSize(crop, SIZE_LIMITS.maxWidth, SIZE_LIMITS).width;
}

export function aspectNumber(aspect) {
    const ratio = Number(aspect);
    return Number.isFinite(ratio) ? ratio : null;
}

// Everything the settings imply: `plan` and `size` for the converter, how long the GIF
// plays for, and any `errors` or `warnings`.
export function deriveOutput(settings, { estimateUpperBytes = 0 } = {}) {
    const { trimStart, trimEnd, fps, speed, loop, crop, width } = settings;
    const plan = planFrames({ trimStart, trimEnd, fps, speed });
    const size = outputSize(crop, width, SIZE_LIMITS);
    const { errors, warnings } = checkOutput({ ...size, frames: plan.times.length, fps, loop, estimateUpperBytes });
    return { plan, size, errors, warnings };
}

// How long the finished GIF plays, in seconds, in one pass.
export function playbackSeconds(plan, loop) {
    const { delays } = plan;
    let hundredths = 0;
    for (let i = 0; i < delays.length; i++) hundredths += delays[i];
    if (loop === 'boomerang' && delays.length > 2) {
        for (let i = 1; i < delays.length - 1; i++) hundredths += delays[i];
    }
    return hundredths / 100;
}
