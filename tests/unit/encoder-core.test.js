import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EncoderJob, OutputTooLargeError } from '../../scripts/worker/encoder-core.js';
import { compositeFrames, parseGif } from '../gif-parse.js';

const WIDTH = 32;
const HEIGHT = 16;
const TRAILER_BYTES = 1;
const CONFIG = { width: WIDTH, height: HEIGHT, colors: 255, tolerance: 5, ditherScale: 2, loop: 'forever' };

function frame(level) {
    const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = (i / 4 % WIDTH) * 8;
        rgba[i + 1] = level;
        rgba[i + 2] = 128;
        rgba[i + 3] = 255;
    }
    return rgba;
}

function join(chunks) {
    const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let at = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
    }
    return bytes;
}

function encode(levels, config = CONFIG) {
    const job = new EncoderJob(config);
    for (const level of levels) job.addSample(frame(level), WIDTH, HEIGHT);
    job.buildPalette();
    for (const level of levels) job.addFrame(frame(level), 5);
    return job.finish();
}

test('EncoderJob reports every frame and its bytes', () => {
    const { chunks, frames, bytes } = encode([0, 100, 200]);
    const gif = parseGif(join(chunks));
    assert.equal(frames, 3);
    assert.equal(gif.frames.length, 3);
    assert.equal(bytes, join(chunks).length);
    assert.equal(compositeFrames(gif).length, 3);
});

test('frameSizes has one entry per added frame and accounts for all but the trailer', () => {
    const { frameSizes, bytes } = encode([0, 100, 200]);
    assert.equal(frameSizes.length, 3);
    assert.ok(frameSizes.every((size) => size > 0));
    const counted = frameSizes.reduce((total, size) => total + size, 0);
    assert.equal(counted + TRAILER_BYTES, bytes);
});

test('frameSizes counts a repeated frame as free', () => {
    const { frameSizes, bytes } = encode([50, 50, 200]);
    assert.equal(frameSizes[1], 0);
    assert.ok(frameSizes[0] > 0 && frameSizes[2] > 0);
    assert.equal(frameSizes.reduce((total, size) => total + size, 0) + TRAILER_BYTES, bytes);
});

test('a sample can be smaller than the output', () => {
    const job = new EncoderJob(CONFIG);
    job.addSample(new Uint8ClampedArray(4 * 4).fill(200), 2, 2);
    assert.ok(job.buildPalette() >= 1);
});

test('the size limit also covers the last frame and a return trip', () => {
    const encode = (loop, maxBytes) => {
        const job = new EncoderJob({ ...CONFIG, loop, maxBytes });
        for (const level of [0, 80, 160, 240]) job.addSample(frame(level), WIDTH, HEIGHT);
        job.buildPalette();
        for (const level of [0, 80, 160, 240]) job.addFrame(frame(level), 5);
        return job;
    };
    const plain = encode('forever', Infinity).finish().bytes;
    assert.throws(() => encode('forever', plain - 10).finish(), OutputTooLargeError);
    const boomerang = encode('boomerang', Infinity).finish().bytes;
    assert.throws(() => encode('boomerang', boomerang - 10).finish(), OutputTooLargeError);
});

test('going over the size limit stops the job', () => {
    const job = new EncoderJob({ ...CONFIG, maxBytes: 100 });
    job.addSample(frame(0), WIDTH, HEIGHT);
    job.addSample(frame(200), WIDTH, HEIGHT);
    job.buildPalette();
    job.addFrame(frame(0), 5);
    assert.throws(() => job.addFrame(frame(200), 5), OutputTooLargeError);
});
