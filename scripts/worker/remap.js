// Turns RGBA frames into palette indices, and pixels that needn't change into
// transparency. Ordered dithering depends only on a pixel's value and position, so
// unchanged areas come out identical from frame to frame and compress away, where
// error diffusion would ripple a one-pixel change across the frame.
//
// A pixel is compared with the source value of what's showing there now, not with
// the previous frame, so tiny changes can't add up unnoticed over many frames.
//
// A pixel whose lookup cell holds a palette color takes the one nearest the cell's
// center, without dithering. On a screen recording's flat colors the dither pattern was
// the most visible error, and gained nothing, and near black Oklab is so steep that
// the center of pure black's cell was nearer a dark gray. Other pixels still dither, so
// gradients a small palette can't follow don't band. Skipping by distance instead made
// Safari's slightly different decodes from one pass to the next flip more pixels
// between the two, and sizes vary more. The choice depends only on the value, like the
// dither, so it stays the same from frame to frame.
//
// With `alpha`, pixels under the cutoff are transparent, which `composite` holds as
// TRANSPARENT_INDEX. A frame can leave them as they are, or draw over them, but a
// pixel showing a color can only become transparent by clearing the whole canvas, so
// a frame that needs that writes every pixel.
import { ALPHA_CUTOFF } from './alpha.js';
import { srgbToOklab } from './oklab.js';
import { TRANSPARENT_INDEX } from './palette.js';

const LOOKUP_BITS = 6;
const LOOKUP_SHIFT = 8 - LOOKUP_BITS;
const LOOKUP_SIZE = 1 << (LOOKUP_BITS * 3);
const UNSET = -1;
const NOT_FLAT = -2;

const BAYER_SIZE = 8;
const BAYER = [
    0, 32, 8, 40, 2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
];

const MIN_DITHER = 4;
const MAX_DITHER = 16;

// Weighted squared difference, like how much each channel shows in brightness.
const WEIGHT_R = 2;
const WEIGHT_G = 4;
const WEIGHT_B = 1;
const WEIGHT_TOTAL = WEIGHT_R + WEIGHT_G + WEIGHT_B;

// A fixed amount of dither would be wrong: too little leaves banding on a palette
// that's far off, and too much adds noise to one that's close.
export function ditherAmplitude(rmsError, scale) {
    return Math.min(MAX_DITHER, Math.max(MIN_DITHER, scale * rmsError));
}

function makeThresholds(amplitude) {
    const thresholds = new Int16Array(BAYER.length);
    for (let i = 0; i < BAYER.length; i++) {
        thresholds[i] = Math.round(((BAYER[i] + 0.5) / BAYER.length - 0.5) * amplitude);
    }
    return thresholds;
}

function lookupKey(r, g, b) {
    return (r >> LOOKUP_SHIFT) << (2 * LOOKUP_BITS) | (g >> LOOKUP_SHIFT) << LOOKUP_BITS | (b >> LOOKUP_SHIFT);
}

function clampChannel(value) {
    return value < 0 ? 0 : value > 255 ? 255 : value;
}

// The nearest of the palette indices in `candidates`.
function nearestIndex(paletteLab, candidates, l, a, b) {
    let best = candidates[0];
    let bestDistance = Infinity;
    for (const c of candidates) {
        const dl = l - paletteLab[c * 3];
        const da = a - paletteLab[c * 3 + 1];
        const db = b - paletteLab[c * 3 + 2];
        const distance = dl * dl + da * da + db * db;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = c;
        }
    }
    return best;
}

export class FrameRemapper {
    #width;
    #height;
    #paletteLab;
    // Every palette index that's a color, and those in each lookup cell holding any.
    #colorIndices = [];
    #cellIndices = new Map();
    // Per lookup key, the nearest palette index, and that index again where it's in the
    // cell, so isn't dithered, or NOT_FLAT. #fill sets both.
    #lookup = new Int16Array(LOOKUP_SIZE).fill(UNSET);
    #flat = new Int16Array(LOOKUP_SIZE);
    #thresholds;
    #toleranceSquared;
    #alpha;
    #started = false;
    #shownR;
    #shownG;
    #shownB;
    #lab = new Float64Array(3);

    // What to write for the latest frame, with TRANSPARENT_INDEX where it can be
    // skipped, and the full picture showing after it. Both are reused.
    indices;
    composite;
    // Whether the latest frame needs the canvas cleared first, in which case `indices`
    // is the whole picture, with TRANSPARENT_INDEX where it's transparent.
    clears = false;

    // Without `alpha`, every pixel is taken as opaque.
    constructor({ width, height, palette, rmsError, ditherScale, tolerance, alpha = false }) {
        const pixels = width * height;
        this.#width = width;
        this.#height = height;
        this.#alpha = alpha;
        this.#thresholds = makeThresholds(ditherAmplitude(rmsError, ditherScale));
        this.#toleranceSquared = tolerance * tolerance * WEIGHT_TOTAL;
        this.#paletteLab = new Float64Array(palette.length * 3);
        palette.forEach(([r, g, b], c) => {
            srgbToOklab(r, g, b, this.#paletteLab, c * 3);
            if (c === TRANSPARENT_INDEX) return;
            this.#colorIndices.push(c);
            const key = lookupKey(r, g, b);
            if (!this.#cellIndices.has(key)) this.#cellIndices.set(key, []);
            this.#cellIndices.get(key).push(c);
        });
        this.#shownR = new Uint8Array(pixels);
        this.#shownG = new Uint8Array(pixels);
        this.#shownB = new Uint8Array(pixels);
        this.indices = new Uint8Array(pixels);
        this.composite = new Uint8Array(pixels);
    }

    #fill(key) {
        const half = 1 << (LOOKUP_SHIFT - 1);
        const r = ((key >> (2 * LOOKUP_BITS)) << LOOKUP_SHIFT) | half;
        const g = (((key >> LOOKUP_BITS) & ((1 << LOOKUP_BITS) - 1)) << LOOKUP_SHIFT) | half;
        const b = ((key & ((1 << LOOKUP_BITS) - 1)) << LOOKUP_SHIFT) | half;
        const lab = this.#lab;
        srgbToOklab(r, g, b, lab);
        const inCell = this.#cellIndices.get(key);
        const index = nearestIndex(this.#paletteLab, inCell ?? this.#colorIndices, lab[0], lab[1], lab[2]);
        this.#lookup[key] = index;
        this.#flat[key] = inCell ? index : NOT_FLAT;
    }

    // Whether a pixel showing a color is transparent in `rgba`.
    #needsClear(rgba) {
        const { composite } = this;
        for (let p = 0, i = 3; p < composite.length; p++, i += 4) {
            if (rgba[i] < ALPHA_CUTOFF && composite[p] !== TRANSPARENT_INDEX) return true;
        }
        return false;
    }

    // Fills `indices` and `composite`, sets `clears`, and returns how many pixels
    // changed. The first frame always writes every pixel.
    remap(rgba) {
        const width = this.#width;
        const height = this.#height;
        const lookup = this.#lookup;
        const flat = this.#flat;
        const thresholds = this.#thresholds;
        const toleranceSquared = this.#toleranceSquared;
        const shownR = this.#shownR;
        const shownG = this.#shownG;
        const shownB = this.#shownB;
        const { indices, composite } = this;
        const alpha = this.#alpha;
        const first = !this.#started;
        const clears = alpha && !first && this.#needsClear(rgba);
        let changed = 0;

        for (let y = 0, i = 0, p = 0; y < height; y++) {
            const row = (y & (BAYER_SIZE - 1)) * BAYER_SIZE;
            for (let x = 0; x < width; x++, i += 4, p++) {
                // Transparent stays transparent, and is cleared otherwise, so either way
                // it's left out of the frame.
                if (alpha && rgba[i + 3] < ALPHA_CUTOFF) {
                    indices[p] = TRANSPARENT_INDEX;
                    if (composite[p] !== TRANSPARENT_INDEX) {
                        composite[p] = TRANSPARENT_INDEX;
                        changed++;
                    }
                    continue;
                }

                const r = rgba[i];
                const g = rgba[i + 1];
                const b = rgba[i + 2];

                // Only a pixel showing a color has a source value to compare with. After a
                // clear, it's written again as it was.
                if (!first && composite[p] !== TRANSPARENT_INDEX) {
                    const dr = r - shownR[p];
                    const dg = g - shownG[p];
                    const db = b - shownB[p];
                    if (WEIGHT_R * dr * dr + WEIGHT_G * dg * dg + WEIGHT_B * db * db < toleranceSquared) {
                        indices[p] = clears ? composite[p] : TRANSPARENT_INDEX;
                        continue;
                    }
                }

                const key = lookupKey(r, g, b);
                if (lookup[key] === UNSET) this.#fill(key);
                let index = flat[key];
                if (index === NOT_FLAT) {
                    const threshold = thresholds[row + (x & (BAYER_SIZE - 1))];
                    const ditheredKey = lookupKey(clampChannel(r + threshold), clampChannel(g + threshold), clampChannel(b + threshold));
                    if (lookup[ditheredKey] === UNSET) this.#fill(ditheredKey);
                    index = lookup[ditheredKey];
                }

                if (!first && index === composite[p]) {
                    indices[p] = clears ? index : TRANSPARENT_INDEX;
                    continue;
                }
                indices[p] = index;
                composite[p] = index;
                shownR[p] = r;
                shownG[p] = g;
                shownB[p] = b;
                changed++;
            }
        }
        this.#started = true;
        this.clears = clears;
        return changed;
    }
}
