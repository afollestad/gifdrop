import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkOutput, QUALITY_PRESETS } from '../../scripts/app/limits.js';

const OK = { width: 480, height: 270, frames: 75, fps: 15, loop: 'forever' };

test('checkOutput says nothing about ordinary settings', () => {
    assert.deepEqual(checkOutput(OK), { errors: [], warnings: [] });
});

test('checkOutput rejects too many frames, counting the return trip', () => {
    assert.equal(checkOutput({ ...OK, frames: 1000 }).errors.length, 0);
    assert.equal(checkOutput({ ...OK, frames: 1001 }).errors.length, 1);
    assert.equal(checkOutput({ ...OK, frames: 600, loop: 'boomerang' }).errors.length, 1);
});

test('checkOutput rejects too many pixels in total', () => {
    assert.equal(checkOutput({ ...OK, width: 1280, height: 720, frames: 500 }).errors.length, 1);
});

test('checkOutput rejects a boomerang too large to store', () => {
    assert.equal(checkOutput({ ...OK, width: 1000, height: 1000, frames: 150, loop: 'forever' }).errors.length, 0);
    assert.equal(checkOutput({ ...OK, width: 1000, height: 1000, frames: 300, loop: 'boomerang' }).errors.length, 1);
});

test('checkOutput gives only its most useful warning', () => {
    const { warnings } = checkOutput({ ...OK, width: 1000, height: 562, fps: 30, frames: 150, estimateUpperBytes: 20 * 1024 * 1024 });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /width to 707/);
});

test('checkOutput warns about width and FPS on their own', () => {
    assert.match(checkOutput({ ...OK, width: 801 }).warnings[0], /480/);
    assert.match(checkOutput({ ...OK, fps: 25 }).warnings[0], /20 FPS/);
});

test('every palette leaves room for the transparent entry', () => {
    for (const { colors } of Object.values(QUALITY_PRESETS)) assert.ok(colors <= 255);
});
