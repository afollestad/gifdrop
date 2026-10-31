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

export const DEFAULTS = { trimSeconds: 5, longestEdge: 480, fps: 15, speed: 1, quality: 'balanced', loop: 'forever' };

export const SIZE_LIMITS = { minWidth: 64, maxWidth: 1280, maxHeight: 1280 };

const MAX_FRAMES = 1000;
const MAX_MEGAPIXELS = 400;
const MAX_BOOMERANG_STORE_BYTES = 256 * 1024 * 1024;
const WARN_FRAMES = 300;
const WARN_MEGAPIXELS = 40;
const WARN_WIDTH = 800;
const WARN_FPS = 20;
const WARN_ESTIMATE_BYTES = 15 * 1024 * 1024;

export const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

// `frames` counts the frames captured, before a boomerang adds its return trip.
// Returns `errors`, which rule out converting, and `warnings`, which don't.
export function checkOutput({ width, height, frames, fps, loop, estimateUpperBytes = 0 }) {
    const errors = [];
    const warnings = [];
    const outputFrames = outputFrameCount(frames, loop);
    const megapixels = width * height * outputFrames / 1e6;

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
    } else if (megapixels > WARN_MEGAPIXELS) {
        warnings.push('This is a lot of pixels to process. A smaller width would be much quicker.');
    } else if (width > WARN_WIDTH) {
        warnings.push('Wide GIFs get large quickly. 480 is plenty for most uses.');
    } else if (fps > WARN_FPS) {
        warnings.push('Above 20 FPS, GIFs grow much faster than they look smoother.');
    }
    return { errors, warnings };
}
