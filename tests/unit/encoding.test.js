// The encoding modules together, checked by reading their bytes back with the
// separately written parser in tests/gif-parse.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GifWriter } from '../../scripts/worker/gif-writer.js';
import { buildPalette, ColorHistogram, TRANSPARENT_INDEX } from '../../scripts/worker/palette.js';
import { ditherAmplitude, FrameRemapper } from '../../scripts/worker/remap.js';
import { compositeFrames, parseGif } from '../gif-parse.js';

const WIDTH = 64;
const HEIGHT = 48;

function makeFrame(paint) {
    const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const [r, g, b] = paint(x, y);
            const i = 4 * (y * WIDTH + x);
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = 255;
        }
    }
    return rgba;
}

const gradient = (x, y) => [x * 4, y * 5, 128];

// A white square moving over a gradient.
function movingSquare(step) {
    return makeFrame((x, y) => (x >= step * 4 && x < step * 4 + 12 && y >= 10 && y < 22 ? [255, 255, 255] : gradient(x, y)));
}

function encode(frames, { loop = 'forever', colors = 255, tolerance = 5, delay = 7 } = {}) {
    const histogram = new ColorHistogram();
    for (const frame of frames) histogram.addFrame(frame, WIDTH, HEIGHT, 1);
    const { palette, rmsError } = buildPalette(histogram, colors);
    const remapper = new FrameRemapper({ width: WIDTH, height: HEIGHT, palette, rmsError, ditherScale: 2, tolerance });
    const writer = new GifWriter({ width: WIDTH, height: HEIGHT, palette, loop });
    const pictures = [];
    for (const frame of frames) {
        const changed = remapper.remap(frame);
        writer.addFrame(remapper.indices, remapper.composite, delay, changed);
        pictures.push(remapper.composite.slice());
    }
    const chunks = writer.finish();
    const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let at = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
    }
    assert.equal(writer.bytesWritten, bytes.length);
    return { gif: parseGif(bytes), palette, rmsError, pictures, writer };
}

test('buildPalette reserves its first entry and stays within the limit', () => {
    const histogram = new ColorHistogram();
    histogram.addFrame(makeFrame(gradient), WIDTH, HEIGHT, 1);
    const { palette } = buildPalette(histogram, 16);
    assert.ok(palette.length <= 17);
    assert.ok(palette.length >= 2);
    assert.deepEqual(palette[TRANSPARENT_INDEX], [0, 0, 0]);
});

test('buildPalette handles fewer colors than it could use', () => {
    const histogram = new ColorHistogram();
    histogram.addFrame(makeFrame((x) => (x < 32 ? [10, 20, 30] : [200, 100, 50])), WIDTH, HEIGHT, 1);
    const { palette, rmsError } = buildPalette(histogram, 255);
    assert.equal(palette.length, 3);
    assert.deepEqual(palette.slice(1).sort(), [[10, 20, 30], [200, 100, 50]].sort());
    assert.equal(rmsError, 0);
});

test('buildPalette keeps pure black and white from gray averages', () => {
    const histogram = new ColorHistogram();
    histogram.addFrame(makeFrame((x, y) => {
        if (y < 6) return [0, 0, 0];
        if (y > 41) return [255, 255, 255];
        return [x * 4, (x * 4 + y * 5) % 256, y * 5];
    }), WIDTH, HEIGHT, 1);
    const { palette } = buildPalette(histogram, 8);
    assert.ok(palette.slice(1).some(([r, g, b]) => r + g + b === 0), JSON.stringify(palette));
    assert.ok(palette.slice(1).some(([r, g, b]) => r + g + b === 765), JSON.stringify(palette));
});

test('buildPalette copes with an empty histogram', () => {
    assert.ok(buildPalette(new ColorHistogram(), 255).palette.length >= 2);
});

test('ditherAmplitude scales with palette error within bounds', () => {
    assert.equal(ditherAmplitude(0, 2), 4);
    assert.equal(ditherAmplitude(5, 2), 10);
    assert.equal(ditherAmplitude(100, 2), 16);
});

test('the first frame is complete and never uses the transparent entry', () => {
    const { gif } = encode([movingSquare(0), movingSquare(1)]);
    assert.equal(gif.frames[0].transparentIndex, null);
    assert.ok(gif.frames[0].indices.every((index) => index !== TRANSPARENT_INDEX));
});

test('later frames keep what is under them, with no local palettes', () => {
    const { gif } = encode([movingSquare(0), movingSquare(1), movingSquare(2)]);
    assert.equal(gif.frames.length, 3);
    for (const frame of gif.frames) {
        assert.equal(frame.disposal, 1);
        assert.equal(frame.localPalette, null);
        assert.equal(frame.x, 0);
        assert.equal(frame.width, WIDTH);
    }
    assert.equal(gif.frames[1].transparentIndex, TRANSPARENT_INDEX);
});

test('parsing the GIF gives back exactly the pictures the remapper tracked', () => {
    const frames = [0, 1, 2, 3, 4].map(movingSquare);
    const { gif, pictures } = encode(frames);
    const decoded = compositeFrames(gif);
    assert.equal(decoded.length, pictures.length);
    decoded.forEach((picture, i) => assert.deepEqual(picture, pictures[i], `frame ${i}`));
});

test('later frames only write what changed', () => {
    const { gif } = encode([movingSquare(0), movingSquare(1)]);
    const written = gif.frames[1].indices.filter((index) => index !== TRANSPARENT_INDEX).length;
    assert.ok(written > 0);
    assert.ok(written < WIDTH * HEIGHT / 4, `wrote ${written}`);
});

test('tiny changes do not add up unnoticed', () => {
    // Drifts one level a frame, always under the tolerance from the frame before,
    // so comparing with only that frame would never write anything after the first.
    const frames = Array.from({ length: 40 }, (_, level) => makeFrame(() => [100 + level, 100 + level, 100 + level]));
    const { gif, palette } = encode(frames, { colors: 64 });
    const last = compositeFrames(gif).at(-1);
    const [r] = palette[last[0]];
    assert.ok(Math.abs(r - 139) <= 12, `shows ${r}, source is 139`);
    assert.ok(gif.frames.length > 1);
});

test('unchanged frames extend the one before instead of adding to the file', () => {
    const same = movingSquare(0);
    const { gif } = encode([same, same, same, movingSquare(1)], { delay: 5 });
    assert.equal(gif.frames.length, 2);
    assert.equal(gif.frames[0].delay, 15);
    assert.equal(gif.frames[1].delay, 5);
});

test('static frames at the end still count toward the last delay', () => {
    const same = movingSquare(0);
    const { gif } = encode([same, same, same], { delay: 4 });
    assert.equal(gif.frames.length, 1);
    assert.equal(gif.frames[0].delay, 12);
});

test('delays pass through in hundredths of a second', () => {
    const { gif } = encode([movingSquare(0), movingSquare(1)], { delay: 3 });
    assert.deepEqual(gif.frames.map((frame) => frame.delay), [3, 3]);
});

test('loop modes write the right block', () => {
    const frames = [movingSquare(0), movingSquare(1)];
    assert.equal(encode(frames, { loop: 'forever' }).gif.loop, 0);
    assert.equal(encode(frames, { loop: 'once' }).gif.loop, null);
    assert.equal(encode(frames, { loop: 'boomerang' }).gif.loop, 0);
});

test('a boomerang returns through the same pictures without repeating the ends', () => {
    const frames = [0, 1, 2, 3].map(movingSquare);
    const { gif, pictures } = encode(frames, { loop: 'boomerang' });
    assert.equal(gif.frames.length, 6);
    const decoded = compositeFrames(gif);
    [0, 1, 2, 3, 2, 1].forEach((source, i) => assert.deepEqual(decoded[i], pictures[source], `position ${i}`));
});

test('a boomerang return trip reuses the outbound delays', () => {
    const frames = [0, 1, 2, 3].map(movingSquare);
    const { gif } = encode(frames, { loop: 'boomerang', delay: 6 });
    assert.deepEqual(gif.frames.map((frame) => frame.delay), [6, 6, 6, 6, 6, 6]);
});

test('a boomerang with merged frames holds them on both trips', () => {
    const a = movingSquare(0);
    const { gif } = encode([a, a, movingSquare(1), movingSquare(2)], { loop: 'boomerang', delay: 5 });
    assert.deepEqual(gif.frames.map((frame) => frame.delay), [10, 5, 5, 5]);
});

test('boomerangs of one or two distinct frames have no return trip to add', () => {
    assert.equal(encode([movingSquare(0)], { loop: 'boomerang' }).gif.frames.length, 1);
    assert.equal(encode([movingSquare(0), movingSquare(1)], { loop: 'boomerang' }).gif.frames.length, 2);
});

test('small palettes still produce a valid GIF', () => {
    const { gif, pictures } = encode([makeFrame(() => [50, 60, 70]), makeFrame((x) => (x < 32 ? [50, 60, 70] : [200, 10, 10]))]);
    assert.ok(gif.frames[0].minCodeSize >= 2);
    assert.deepEqual(compositeFrames(gif)[1], pictures[1]);
});
