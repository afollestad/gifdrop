import assert from 'node:assert/strict';
import { test } from 'node:test';
import { centeredCrop, clampCrop, fullCrop, moveCrop, resizeCrop } from '../../scripts/app/crop-math.js';

const W = 1920;
const H = 1080;

test('centeredCrop finds the largest centered rectangle of a shape', () => {
    assert.deepEqual(centeredCrop(W, H, 1), { x: 420, y: 0, width: 1080, height: 1080 });
    assert.deepEqual(centeredCrop(W, H, 16 / 9), fullCrop(W, H));
    assert.deepEqual(centeredCrop(W, H, 9 / 16), { x: 656, y: 0, width: 608, height: 1080 });
    assert.deepEqual(centeredCrop(1000, 1000, 2), { x: 0, y: 250, width: 1000, height: 500 });
    assert.deepEqual(centeredCrop(W, H, null), fullCrop(W, H));
});

test('clampCrop rounds typed numbers and fits them in the video', () => {
    assert.deepEqual(clampCrop({ x: 10.4, y: -5, width: 100.6, height: 50 }, W, H), { x: 10, y: 0, width: 101, height: 50 });
    assert.deepEqual(clampCrop({ x: 1900, y: 1000, width: 500, height: 500 }, W, H), { x: 1420, y: 580, width: 500, height: 500 });
    assert.deepEqual(clampCrop({ x: 0, y: 0, width: 1, height: 1 }, W, H), { x: 0, y: 0, width: 16, height: 16 });
    assert.deepEqual(clampCrop({ x: 0, y: 0, width: 9999, height: 9999 }, W, H), fullCrop(W, H));
});

test('clampCrop handles a video smaller than the minimum', () => {
    assert.deepEqual(clampCrop({ x: 0, y: 0, width: 1, height: 1 }, 10, 8), { x: 0, y: 0, width: 10, height: 8 });
});

test('moveCrop stops at the edges and keeps the size', () => {
    const crop = { x: 100, y: 100, width: 200, height: 200 };
    assert.deepEqual(moveCrop(crop, 10, -10, W, H), { x: 110, y: 90, width: 200, height: 200 });
    assert.deepEqual(moveCrop(crop, -500, -500, W, H), { x: 0, y: 0, width: 200, height: 200 });
    assert.deepEqual(moveCrop(crop, 5000, 5000, W, H), { x: 1720, y: 880, width: 200, height: 200 });
});

test('resizeCrop keeps the opposite edges fixed', () => {
    const crop = { x: 100, y: 100, width: 200, height: 200 };
    assert.deepEqual(resizeCrop(crop, 'se', 50, 20, W, H), { x: 100, y: 100, width: 250, height: 220 });
    assert.deepEqual(resizeCrop(crop, 'nw', 50, 20, W, H), { x: 150, y: 120, width: 150, height: 180 });
    assert.deepEqual(resizeCrop(crop, 'e', 50, 999, W, H), { x: 100, y: 100, width: 250, height: 200 });
    assert.deepEqual(resizeCrop(crop, 'n', 999, -50, W, H), { x: 100, y: 50, width: 200, height: 250 });
});

test('resizeCrop stops at the frame and at the minimum size', () => {
    const crop = { x: 100, y: 100, width: 200, height: 200 };
    assert.deepEqual(resizeCrop(crop, 'nw', -500, -500, W, H), { x: 0, y: 0, width: 300, height: 300 });
    assert.deepEqual(resizeCrop(crop, 'se', 5000, 5000, W, H), { x: 100, y: 100, width: 1820, height: 980 });
    assert.deepEqual(resizeCrop(crop, 'nw', 500, 500, W, H), { x: 284, y: 284, width: 16, height: 16 });
});

test('resizeCrop holds a fixed aspect from a corner', () => {
    const crop = { x: 100, y: 100, width: 320, height: 180 };
    const result = resizeCrop(crop, 'se', 160, 0, W, H, 16 / 9);
    assert.deepEqual(result, { x: 100, y: 100, width: 480, height: 270 });
});

test('resizeCrop with a fixed aspect shrinks when a corner moves straight in', () => {
    const crop = { x: 100, y: 100, width: 320, height: 180 };
    assert.deepEqual(resizeCrop(crop, 'se', -160, 0, W, H, 16 / 9), { x: 100, y: 100, width: 160, height: 90 });
    assert.deepEqual(resizeCrop(crop, 'se', 0, -90, W, H, 16 / 9), { x: 100, y: 100, width: 160, height: 90 });
});

test('resizeCrop holds a fixed aspect from a side, about the center', () => {
    const crop = { x: 400, y: 400, width: 320, height: 180 };
    const result = resizeCrop(crop, 'e', 160, 0, W, H, 16 / 9);
    assert.deepEqual(result, { x: 400, y: 355, width: 480, height: 270 });
});

test('resizeCrop with a fixed aspect stays inside the frame', () => {
    const crop = { x: 100, y: 100, width: 320, height: 180 };
    for (const handle of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
        for (const delta of [-5000, 5000]) {
            const r = resizeCrop(crop, handle, delta, delta, W, H, 16 / 9);
            assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= W && r.y + r.height <= H, `${handle} ${delta}: ${JSON.stringify(r)}`);
            assert.ok(Math.abs(r.width / r.height - 16 / 9) < 0.15, `${handle} ${delta}: ${JSON.stringify(r)}`);
        }
    }
});
