// The choices the controls offer, and what's too much to attempt or worth warning
// about. Warnings suggest the one change likely to help most.
import { outputFrameCount } from './plan.js';

export const FPS_OPTIONS = [8, 10, 12, 15, 20, 25, 30];
export const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2, 4];
export const LOOP_OPTIONS = ['forever', 'once', 'boomerang'];

export const QUALITY_PRESETS = {
    small: { colors: 127, tolerance: 8, ditherScale: 1.5 },
    balanced: { colors: 255, tolerance: 5, ditherScale: 2 },
    high: { colors: 255, tolerance: 2.5, ditherScale: 2 },
};

export const DEFAULTS = { trimSeconds: 5, fps: 15, speed: 1, quality: 'balanced', loop: 'forever' };

export const SIZE_LIMITS = { minWidth: 64, maxWidth: 2560, maxHeight: 2560 };

const MAX_FRAMES = 1000;
const MAX_MEGAPIXELS = 400;
const MAX_BOOMERANG_STORE_BYTES = 256 * 1024 * 1024;
const WARN_FRAMES = 300;
const WARN_MEGAPIXELS = 40;
const WARN_WIDTH = 800;
const WARN_FPS = 20;
const WARN_ESTIMATE_BYTES = 15 * 1024 * 1024;

const DEFAULT_LONGEST_EDGE = 480;
const LARGE_SOURCE_EDGE = 1600;
const MAX_DEFAULT_LONGEST_EDGE = 1280;
const DEFAULT_FRAMES = DEFAULTS.trimSeconds * DEFAULTS.fps;

export const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

// The longest edge a GIF starts with. A big source, such as a Retina screen recording,
// loses its text and detail at 480, so it starts at half size, which shows a Retina
// recording's text as it was on screen, up to 1280.
export function defaultLongestEdge(crop) {
    const longest = Math.max(crop.width, crop.height);
    if (longest < LARGE_SOURCE_EDGE) return DEFAULT_LONGEST_EDGE;
    return Math.min(MAX_DEFAULT_LONGEST_EDGE, Math.round(longest / 2));
}

// `frames` counts the frames captured, before a boomerang adds its return trip, and
// `start` is the size the video started at, which never warns about its width or, at
// the default length, its pixels. Returns `errors`, which rule out converting, and
// `warnings`, which don't.
export function checkOutput({ width, height, frames, fps, loop, estimateUpperBytes = 0, start = { width: DEFAULT_LONGEST_EDGE, height: 0 } }) {
    const errors = [];
    const warnings = [];
    const outputFrames = outputFrameCount(frames, loop);
    const megapixels = width * height * outputFrames / 1e6;
    const warnMegapixels = Math.max(WARN_MEGAPIXELS, start.width * start.height * DEFAULT_FRAMES / 1e6);
    const warnWidth = Math.max(WARN_WIDTH, start.width);

    if (outputFrames > MAX_FRAMES) {
        errors.push(`That's ${outputFrames} frames, and the limit is ${MAX_FRAMES}. Try a shorter trim or a lower FPS.`);
    } else if (megapixels > MAX_MEGAPIXELS) {
        errors.push('That GIF is too large to make. Try a smaller width or a shorter trim.');
    } else if (loop === 'boomerang' && width * height * frames > MAX_BOOMERANG_STORE_BYTES) {
        errors.push('That boomerang needs too much memory. Try a smaller width or a shorter trim.');
    }
    if (errors.length > 0) return { errors, warnings };

    if (estimateUpperBytes > WARN_ESTIMATE_BYTES) {
        const halved = Math.round(width / Math.SQRT2);
        warnings.push(`This could be a very large GIF. Lowering the width to ${halved} would about halve it.`);
    } else if (outputFrames > WARN_FRAMES) {
        warnings.push(`${outputFrames} frames will take a while. A shorter trim or a lower FPS would be quicker.`);
    } else if (megapixels > warnMegapixels) {
        warnings.push('This is a lot of pixels to process. A smaller width would be much quicker.');
    } else if (width > warnWidth) {
        warnings.push(`Wide GIFs get large quickly. ${start.width} is plenty for most uses.`);
    } else if (fps > WARN_FPS) {
        warnings.push('Above 20 FPS, GIFs grow much faster than they look smoother.');
    }
    return { errors, warnings };
}
