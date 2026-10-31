// Works out which moments of a video become GIF frames, and for how long each
// shows. GIF delays are whole hundredths of a second, so delays are rounded from
// each frame's position rather than one by one: every frame stays within half a
// hundredth of its true time and the error never builds up. Speed only changes
// which moments are sampled, so delays depend on FPS alone, and with FPS capped
// they stay above the 2cs that viewers start to clamp.

const MAX_FPS = 50;

function centiseconds(index, fps) {
    return Math.round(index * 100 / fps);
}

export function planFrames({ trimStart, trimEnd, fps, speed }) {
    if (!(fps > 0 && fps <= MAX_FPS)) throw new RangeError(`FPS out of range: ${fps}`);
    if (!(speed > 0)) throw new RangeError(`Speed out of range: ${speed}`);
    if (!(trimEnd > trimStart)) throw new RangeError(`Empty trim: ${trimStart} to ${trimEnd}`);

    const step = speed / fps;
    const count = Math.max(1, Math.round((trimEnd - trimStart) / step));
    const times = new Float64Array(count);
    const delays = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
        times[i] = trimStart + i * step;
        delays[i] = centiseconds(i + 1, fps) - centiseconds(i, fps);
    }
    return { times, delays };
}

// Up to `max` indices spread evenly across `count`, in order.
export function evenlySpacedIndices(count, max) {
    const picked = Math.min(count, max);
    return Array.from({ length: picked }, (_, i) => Math.floor(i * count / picked));
}

// A boomerang plays E0..Ek, then E(k-1)..E1, so neither end shows twice in a row.
export function outputFrameCount(frames, loop) {
    return loop === 'boomerang' && frames > 1 ? 2 * (frames - 1) : frames;
}

// The width that makes a crop's longest edge `longestEdge`, so a portrait video gets
// the same-sized GIF as a landscape one rather than one nearly twice as tall as wide
// at the same width, and several times the file size.
export function widthForLongestEdge(crop, longestEdge) {
    const scale = Math.min(1, longestEdge / Math.max(crop.width, crop.height));
    return Math.max(1, Math.round(crop.width * scale));
}

// Keeps the crop's shape, and at least one pixel, within both limits.
export function outputSize(crop, requestedWidth, { maxWidth, maxHeight }) {
    const scale = Math.min(requestedWidth, maxWidth, crop.width) / crop.width;
    const fittedScale = Math.min(scale, maxHeight / crop.height);
    return {
        width: Math.max(1, Math.round(crop.width * fittedScale)),
        height: Math.max(1, Math.round(crop.height * fittedScale)),
    };
}
