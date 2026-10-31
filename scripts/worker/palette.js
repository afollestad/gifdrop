// Builds one palette for a whole GIF from a sample of its frames. Colors are
// counted in a coarse histogram, with common colors weighted less than their raw
// count so small details aren't drowned out. The color space is split repeatedly
// in Oklab at the cut leaving the least error, then refined with k-means. A median
// split collapsed on clips with very different scenes; this cut doesn't.
import { srgbToOklab } from './oklab.js';

const CHANNEL_BITS = 6;
const CHANNEL_SHIFT = 8 - CHANNEL_BITS;
const BINS = 1 << (CHANNEL_BITS * 3);
const COUNT_WEIGHT_POWER = 0.75;
const KMEANS_ROUNDS = 8;
const EXTREME_MIN_SHARE = 1e-4;

export const TRANSPARENT_INDEX = 0;

export class ColorHistogram {
    counts = new Uint32Array(BINS);
    sumR = new Float64Array(BINS);
    sumG = new Float64Array(BINS);
    sumB = new Float64Array(BINS);

    // Reads every `step`th pixel of each `step`th row.
    addFrame(rgba, width, height, step = 2) {
        const { counts, sumR, sumG, sumB } = this;
        for (let y = 0; y < height; y += step) {
            for (let x = 0, i = y * width * 4; x < width; x += step, i += step * 4) {
                const r = rgba[i];
                const g = rgba[i + 1];
                const b = rgba[i + 2];
                const bin = ((r >> CHANNEL_SHIFT) << (2 * CHANNEL_BITS)) | ((g >> CHANNEL_SHIFT) << CHANNEL_BITS) | (b >> CHANNEL_SHIFT);
                counts[bin]++;
                sumR[bin] += r;
                sumG[bin] += g;
                sumB[bin] += b;
            }
        }
    }
}

// The histogram's occupied bins, as parallel arrays.
function collectPoints({ counts, sumR, sumG, sumB }) {
    let size = 0;
    for (let bin = 0; bin < BINS; bin++) {
        if (counts[bin] > 0) size++;
    }
    const points = {
        size,
        lab: new Float64Array(size * 3),
        rgb: new Float64Array(size * 3),
        counts: new Float64Array(size),
        weights: new Float64Array(size),
    };
    for (let bin = 0, p = 0; bin < BINS; bin++) {
        const count = counts[bin];
        if (count === 0) continue;
        const r = sumR[bin] / count;
        const g = sumG[bin] / count;
        const b = sumB[bin] / count;
        points.rgb[p * 3] = r;
        points.rgb[p * 3 + 1] = g;
        points.rgb[p * 3 + 2] = b;
        srgbToOklab(r, g, b, points.lab, p * 3);
        points.counts[p] = count;
        points.weights[p] = count ** COUNT_WEIGHT_POWER;
        p++;
    }
    return points;
}

// The total weighted squared error of a run of points, and its widest axis.
function describeBox({ lab, weights }, order, start, end) {
    const sums = [0, 0, 0];
    const squares = [0, 0, 0];
    let total = 0;
    for (let i = start; i < end; i++) {
        const p = order[i];
        const w = weights[p];
        total += w;
        for (let axis = 0; axis < 3; axis++) {
            const value = lab[p * 3 + axis];
            sums[axis] += w * value;
            squares[axis] += w * value * value;
        }
    }
    let error = 0;
    let widestAxis = 0;
    let widest = -1;
    for (let axis = 0; axis < 3; axis++) {
        const spread = squares[axis] - (sums[axis] * sums[axis]) / total;
        error += spread;
        if (spread > widest) {
            widest = spread;
            widestAxis = axis;
        }
    }
    return { start, end, error, axis: widestAxis };
}

// Sorts the box along its widest axis and finds the cut leaving the least error,
// which is the one maximizing the between-parts sum of squares.
function splitBox(points, order, box) {
    const { lab, weights } = points;
    const offset = box.axis;
    order.subarray(box.start, box.end).sort((a, b) => lab[a * 3 + offset] - lab[b * 3 + offset]);

    let totalWeight = 0;
    let totalValue = 0;
    for (let i = box.start; i < box.end; i++) {
        const p = order[i];
        totalWeight += weights[p];
        totalValue += weights[p] * lab[p * 3 + offset];
    }

    let leftWeight = 0;
    let leftValue = 0;
    let bestScore = -1;
    let cut = box.start + 1;
    for (let i = box.start; i < box.end - 1; i++) {
        const p = order[i];
        leftWeight += weights[p];
        leftValue += weights[p] * lab[p * 3 + offset];
        const rightWeight = totalWeight - leftWeight;
        const rightValue = totalValue - leftValue;
        const score = (leftValue * leftValue) / leftWeight + (rightValue * rightValue) / rightWeight;
        if (score > bestScore) {
            bestScore = score;
            cut = i + 1;
        }
    }
    return [describeBox(points, order, box.start, cut), describeBox(points, order, cut, box.end)];
}

function splitIntoBoxes(points, maxColors) {
    const order = new Int32Array(points.size);
    for (let i = 0; i < points.size; i++) order[i] = i;
    const boxes = [describeBox(points, order, 0, points.size)];

    while (boxes.length < maxColors) {
        let worst = -1;
        let worstError = 0;
        for (let i = 0; i < boxes.length; i++) {
            if (boxes[i].end - boxes[i].start > 1 && boxes[i].error > worstError) {
                worst = i;
                worstError = boxes[i].error;
            }
        }
        if (worst === -1) break;
        const [left, right] = splitBox(points, order, boxes[worst]);
        boxes[worst] = left;
        boxes.push(right);
    }

    const centers = new Float64Array(boxes.length * 3);
    boxes.forEach((box, c) => {
        let total = 0;
        for (let i = box.start; i < box.end; i++) {
            const p = order[i];
            const w = points.weights[p];
            total += w;
            for (let axis = 0; axis < 3; axis++) centers[c * 3 + axis] += w * points.lab[p * 3 + axis];
        }
        for (let axis = 0; axis < 3; axis++) centers[c * 3 + axis] /= total;
    });
    return centers;
}

function assignNearest({ lab, size }, centers, assignment) {
    const colors = centers.length / 3;
    for (let p = 0; p < size; p++) {
        const l = lab[p * 3];
        const a = lab[p * 3 + 1];
        const b = lab[p * 3 + 2];
        let best = 0;
        let bestDistance = Infinity;
        for (let c = 0; c < colors; c++) {
            const dl = l - centers[c * 3];
            const da = a - centers[c * 3 + 1];
            const db = b - centers[c * 3 + 2];
            const distance = dl * dl + da * da + db * db;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = c;
            }
        }
        assignment[p] = best;
    }
}

function refineCenters(points, centers, assignment) {
    const colors = centers.length / 3;
    const totals = new Float64Array(colors);
    const sums = new Float64Array(centers.length);
    for (let round = 0; round < KMEANS_ROUNDS; round++) {
        assignNearest(points, centers, assignment);
        totals.fill(0);
        sums.fill(0);
        for (let p = 0; p < points.size; p++) {
            const c = assignment[p];
            const w = points.weights[p];
            totals[c] += w;
            sums[c * 3] += w * points.lab[p * 3];
            sums[c * 3 + 1] += w * points.lab[p * 3 + 1];
            sums[c * 3 + 2] += w * points.lab[p * 3 + 2];
        }
        for (let c = 0; c < colors; c++) {
            if (totals[c] === 0) continue;
            centers[c * 3] = sums[c * 3] / totals[c];
            centers[c * 3 + 1] = sums[c * 3 + 1] / totals[c];
            centers[c * 3 + 2] = sums[c * 3 + 2] / totals[c];
        }
    }
    assignNearest(points, centers, assignment);
}

// Each color as the average of the source colors it stands for.
function averageColors(points, assignment, colors) {
    const totals = new Float64Array(colors);
    const sums = new Float64Array(colors * 3);
    for (let p = 0; p < points.size; p++) {
        const c = assignment[p];
        const w = points.weights[p];
        totals[c] += w;
        sums[c * 3] += w * points.rgb[p * 3];
        sums[c * 3 + 1] += w * points.rgb[p * 3 + 1];
        sums[c * 3 + 2] += w * points.rgb[p * 3 + 2];
    }
    const result = [];
    for (let c = 0; c < colors; c++) {
        if (totals[c] === 0) {
            result.push(null);
        } else {
            result.push([Math.round(sums[c * 3] / totals[c]), Math.round(sums[c * 3 + 1] / totals[c]), Math.round(sums[c * 3 + 2] / totals[c])]);
        }
    }
    return result;
}

// Averaging pulls the darkest and lightest colors toward the middle, which would
// turn black bars and white text gray. The colors nearest them are replaced with
// the real extremes, ignoring stray pixels too rare to matter.
function pinExtremes(points, colors, assignment) {
    let totalCount = 0;
    for (let p = 0; p < points.size; p++) totalCount += points.counts[p];
    const minCount = totalCount * EXTREME_MIN_SHARE;

    let darkest = -1;
    let lightest = -1;
    for (let p = 0; p < points.size; p++) {
        if (points.counts[p] < minCount) continue;
        if (darkest === -1 || points.lab[p * 3] < points.lab[darkest * 3]) darkest = p;
        if (lightest === -1 || points.lab[p * 3] > points.lab[lightest * 3]) lightest = p;
    }
    for (const p of [darkest, lightest]) {
        if (p === -1) continue;
        colors[assignment[p]] = [Math.round(points.rgb[p * 3]), Math.round(points.rgb[p * 3 + 1]), Math.round(points.rgb[p * 3 + 2])];
    }
}

// The typical distance, in 0-255 per channel, between a color and its stand-in.
function rmsError(points, colors, assignment) {
    let total = 0;
    let sum = 0;
    for (let p = 0; p < points.size; p++) {
        const color = colors[assignment[p]];
        const w = points.counts[p];
        const dr = points.rgb[p * 3] - color[0];
        const dg = points.rgb[p * 3 + 1] - color[1];
        const db = points.rgb[p * 3 + 2] - color[2];
        total += w;
        sum += w * (dr * dr + dg * dg + db * db) / 3;
    }
    return total === 0 ? 0 : Math.sqrt(sum / total);
}

// Returns `palette`, whose first entry is reserved for transparency and is never
// used for a color, and `rmsError` to size the dither by. `maxColors` excludes that
// entry, so it can be at most 255.
export function buildPalette(histogram, maxColors) {
    const points = collectPoints(histogram);
    if (points.size === 0) return { palette: [[0, 0, 0], [0, 0, 0]], rmsError: 0 };

    const centers = splitIntoBoxes(points, Math.min(maxColors, points.size));
    const assignment = new Int32Array(points.size);
    refineCenters(points, centers, assignment);

    const colors = averageColors(points, assignment, centers.length / 3);
    pinExtremes(points, colors, assignment);
    const error = rmsError(points, colors, assignment);

    const used = colors.filter(Boolean);
    return { palette: [[0, 0, 0], ...used], rmsError: error };
}
