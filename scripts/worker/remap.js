// Turns RGBA frames into palette indices, and pixels that needn't change into
// transparency. Ordered dithering depends only on a pixel's value and position, so
// unchanged areas come out identical from frame to frame and compress away, where
// error diffusion would ripple a one-pixel change across the frame.
//
// A pixel is compared with the source value of what's showing there now, not with
// the previous frame, so tiny changes can't add up unnoticed over many frames.
import { srgbToOklab } from './oklab.js';
import { TRANSPARENT_INDEX } from './palette.js';

const LOOKUP_BITS = 6;
const LOOKUP_SHIFT = 8 - LOOKUP_BITS;
const LOOKUP_SIZE = 1 << (LOOKUP_BITS * 3);
const UNSET = -1;

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

function nearestIndex(paletteLab, colors, l, a, b) {
    let best = TRANSPARENT_INDEX + 1;
    let bestDistance = Infinity;
    for (let c = TRANSPARENT_INDEX + 1; c < colors; c++) {
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
    #colors;
    #paletteLab;
    #lookup = new Int16Array(LOOKUP_SIZE).fill(UNSET);
    #thresholds;
    #toleranceSquared;
    #started = false;
    #shownR;
    #shownG;
    #shownB;
    #lab = new Float64Array(3);

    // What to write for the latest frame, with TRANSPARENT_INDEX where it can be
    // skipped, and the full picture showing after it. Both are reused.
    indices;
    composite;

    constructor({ width, height, palette, rmsError, ditherScale, tolerance }) {
        const pixels = width * height;
        this.#width = width;
        this.#height = height;
        this.#colors = palette.length;
        this.#thresholds = makeThresholds(ditherAmplitude(rmsError, ditherScale));
        this.#toleranceSquared = tolerance * tolerance * WEIGHT_TOTAL;
        this.#paletteLab = new Float64Array(palette.length * 3);
        palette.forEach(([r, g, b], c) => srgbToOklab(r, g, b, this.#paletteLab, c * 3));
        this.#shownR = new Uint8Array(pixels);
        this.#shownG = new Uint8Array(pixels);
        this.#shownB = new Uint8Array(pixels);
        this.indices = new Uint8Array(pixels);
        this.composite = new Uint8Array(pixels);
    }

    #fillLookup(key) {
        const half = 1 << (LOOKUP_SHIFT - 1);
        const r = ((key >> (2 * LOOKUP_BITS)) << LOOKUP_SHIFT) | half;
        const g = (((key >> LOOKUP_BITS) & ((1 << LOOKUP_BITS) - 1)) << LOOKUP_SHIFT) | half;
        const b = ((key & ((1 << LOOKUP_BITS) - 1)) << LOOKUP_SHIFT) | half;
        srgbToOklab(r, g, b, this.#lab);
        const index = nearestIndex(this.#paletteLab, this.#colors, this.#lab[0], this.#lab[1], this.#lab[2]);
        this.#lookup[key] = index;
        return index;
    }

    // Fills `indices` and `composite`, and returns how many pixels changed. The
    // first frame always writes every pixel.
    remap(rgba) {
        const width = this.#width;
        const height = this.#height;
        const lookup = this.#lookup;
        const thresholds = this.#thresholds;
        const toleranceSquared = this.#toleranceSquared;
        const shownR = this.#shownR;
        const shownG = this.#shownG;
        const shownB = this.#shownB;
        const { indices, composite } = this;
        const first = !this.#started;
        let changed = 0;

        for (let y = 0, i = 0, p = 0; y < height; y++) {
            const row = (y & (BAYER_SIZE - 1)) * BAYER_SIZE;
            for (let x = 0; x < width; x++, i += 4, p++) {
                const r = rgba[i];
                const g = rgba[i + 1];
                const b = rgba[i + 2];

                if (!first) {
                    const dr = r - shownR[p];
                    const dg = g - shownG[p];
                    const db = b - shownB[p];
                    if (WEIGHT_R * dr * dr + WEIGHT_G * dg * dg + WEIGHT_B * db * db < toleranceSquared) {
                        indices[p] = TRANSPARENT_INDEX;
                        continue;
                    }
                }

                const threshold = thresholds[row + (x & (BAYER_SIZE - 1))];
                const dr = r + threshold;
                const dg = g + threshold;
                const db = b + threshold;
                const key = ((dr < 0 ? 0 : dr > 255 ? 255 : dr) >> LOOKUP_SHIFT) << (2 * LOOKUP_BITS)
                    | ((dg < 0 ? 0 : dg > 255 ? 255 : dg) >> LOOKUP_SHIFT) << LOOKUP_BITS
                    | ((db < 0 ? 0 : db > 255 ? 255 : db) >> LOOKUP_SHIFT);
                let index = lookup[key];
                if (index === UNSET) index = this.#fillLookup(key);

                if (!first && index === composite[p]) {
                    indices[p] = TRANSPARENT_INDEX;
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
        return changed;
    }
}
