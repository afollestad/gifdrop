import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBarcode } from '../barcode.js';

const WIDTH = 320;
const HEIGHT = 180;

function drawHorizontal(value) {
    const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const bit = Math.floor(x * 16 / WIDTH);
            data[4 * (y * WIDTH + x)] = (value >> bit) & 1 ? 255 : 0;
        }
    }
    return { data, width: WIDTH, height: HEIGHT };
}

function drawVertical(value) {
    const data = new Uint8ClampedArray(HEIGHT * WIDTH * 4);
    for (let y = 0; y < WIDTH; y++) {
        for (let x = 0; x < HEIGHT; x++) {
            const bit = Math.floor((WIDTH - 1 - y) * 16 / WIDTH);
            data[4 * (y * HEIGHT + x)] = (value >> bit) & 1 ? 255 : 0;
        }
    }
    return { data, width: HEIGHT, height: WIDTH };
}

test('readBarcode reads across the width, first bit on the left', () => {
    for (const value of [0, 1, 2, 30, 75, 300, 599]) {
        assert.equal(readBarcode(drawHorizontal(value)), value);
    }
});

test('readBarcode reads a rotated clip up from the bottom', () => {
    for (const value of [0, 1, 30, 300, 599]) {
        assert.equal(readBarcode(drawVertical(value), 'height'), value);
    }
});
