// GIF transparency is all or nothing, so a pixel below half opacity becomes
// transparent and the rest keep their own color, which looks the same on any
// background. Pure, and shared by the page and the worker.

export const ALPHA_CUTOFF = 128;

export function hasTransparency(rgba) {
    for (let i = 3; i < rgba.length; i += 4) {
        if (rgba[i] < ALPHA_CUTOFF) return true;
    }
    return false;
}
