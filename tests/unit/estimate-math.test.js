import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateFrameIndices, estimateSize } from '../../scripts/app/estimate-math.js';
import { evenlySpacedIndices } from '../../scripts/app/plan.js';

test('estimateFrameIndices takes every frame of a short clip', () => {
    assert.deepEqual(estimateFrameIndices(3), [0, 1, 2]);
    assert.equal(estimateFrameIndices(48).length, 48);
});

test('estimateFrameIndices samples runs across a long clip, in order', () => {
    const indices = estimateFrameIndices(600);
    assert.equal(indices.length, 48);
    assert.equal(indices[0], 0);
    assert.equal(indices.at(-1), 599);
    for (let i = 1; i < indices.length; i++) assert.ok(indices[i] > indices[i - 1]);
    assert.equal(indices[5], 5);
    assert.ok(indices[6] > 6);
});

test('estimateSize is exact for a clip encoded whole', () => {
    assert.deepEqual(estimateSize({ frameSizes: [1000, 100, 100], frames: 3, loop: 'forever' }), { low: 1200, high: 1200, exact: true });
});

test('estimateSize predicts a short boomerang return trip', () => {
    const { low, high, exact } = estimateSize({ frameSizes: [1000, 100, 100, 100], frames: 4, loop: 'boomerang' });
    assert.equal(exact, false);
    assert.ok(low < 1500 && high > 1500);
});

test('estimateSize ignores each run\'s settling frames', () => {
    // A run's first three frames are wildly expensive, then it settles at 100.
    const frameSizes = [];
    for (let w = 0; w < 8; w++) frameSizes.push(5000, 5000, 5000, 100, 100, 100);
    const { low, high } = estimateSize({ frameSizes, frames: 101, loop: 'forever' });
    const expected = 5000 + 100 * 100;
    assert.ok(high < expected * 1.2);
    assert.ok(low <= expected && expected <= high, `${low} to ${high}`);
});

test('estimateSize adds the return trip for a long boomerang', () => {
    const frameSizes = Array(48).fill(100);
    const plain = estimateSize({ frameSizes, frames: 101, loop: 'forever' });
    const boomerang = estimateSize({ frameSizes, frames: 101, loop: 'boomerang' });
    assert.ok(boomerang.low > plain.low * 1.9);
});

test('evenlySpacedIndices spreads picks across the range', () => {
    assert.deepEqual(evenlySpacedIndices(4, 32), [0, 1, 2, 3]);
    assert.deepEqual(evenlySpacedIndices(100, 4), [0, 25, 50, 75]);
    assert.deepEqual(evenlySpacedIndices(0, 4), []);
});
