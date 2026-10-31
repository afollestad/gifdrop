// Predicts a GIF's size from encoding a sample of it. Short clips are simply encoded
// whole. Longer ones are sampled in runs of consecutive frames, since a GIF frame's
// cost depends on what changed since the one before. The first few of each run are
// left out of the average: they follow a jump across the clip or a fresh start, and
// don't cost what a frame normally does.

const WINDOWS = 8;
const WINDOW_LENGTH = 6;
const SETTLING_FRAMES = 3;
const LOW_FACTOR = 0.9;
// On real footage the size came within 5% of the middle of this, and it's kept wider
// than that because the footage it was measured on can't speak for all footage.
const HIGH_FACTOR = 1.15;

// Which of `count` frames to encode, in order.
export function estimateFrameIndices(count) {
    const all = WINDOWS * WINDOW_LENGTH;
    if (count <= all) return Array.from({ length: count }, (_, i) => i);
    const indices = [];
    for (let w = 0; w < WINDOWS; w++) {
        const start = Math.round(w * (count - WINDOW_LENGTH) / (WINDOWS - 1));
        for (let i = 0; i < WINDOW_LENGTH; i++) indices.push(start + i);
    }
    return indices;
}

function returnTripFrames(frames, loop) {
    return loop === 'boomerang' && frames > 2 ? frames - 2 : 0;
}

// `frameSizes` holds the cost of each frame in estimateFrameIndices(frames), the
// first including the header and palette. Returns the likely range in bytes, and
// whether it's `exact` because nothing was left out. That's exact for what was
// encoded: Safari can decode the same frame slightly differently on another pass, so
// a real conversion can still differ by a little.
export function estimateSize({ frameSizes, frames, loop }) {
    const returnFrames = returnTripFrames(frames, loop);
    const total = (values) => values.reduce((sum, value) => sum + value, 0);

    if (frames <= WINDOWS * WINDOW_LENGTH) {
        const outbound = total(frameSizes);
        if (returnFrames === 0) return { low: outbound, high: outbound, exact: true };
        const meanDelta = total(frameSizes.slice(1)) / Math.max(1, frameSizes.length - 1);
        const size = outbound + returnFrames * meanDelta;
        return { low: size * LOW_FACTOR, high: size * HIGH_FACTOR, exact: false };
    }

    const settled = frameSizes.filter((_, i) => i % WINDOW_LENGTH >= SETTLING_FRAMES);
    const meanDelta = total(settled) / settled.length;
    const size = frameSizes[0] + (frames - 1 + returnFrames) * meanDelta;
    return { low: size * LOW_FACTOR, high: size * HIGH_FACTOR, exact: false };
}
