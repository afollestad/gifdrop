import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outputFrameCount, outputSize, planFrames, widthForLongestEdge } from '../../scripts/app/plan.js';

const LIMITS = { maxWidth: 1280, maxHeight: 1280 };

test('planFrames samples at fps over the trim', () => {
    const { times } = planFrames({ trimStart: 1, trimEnd: 3, fps: 10, speed: 1 });
    assert.equal(times.length, 20);
    assert.equal(times[0], 1);
    assert.ok(Math.abs(times[19] - 2.9) < 1e-9);
});

test('planFrames speed changes the sampling, not the delays', () => {
    const normal = planFrames({ trimStart: 0, trimEnd: 4, fps: 15, speed: 1 });
    const fast = planFrames({ trimStart: 0, trimEnd: 4, fps: 15, speed: 2 });
    assert.equal(normal.times.length, 60);
    assert.equal(fast.times.length, 30);
    assert.deepEqual([...fast.delays], [...normal.delays].slice(0, 30));
});

test('planFrames rounding never builds up', () => {
    for (const fps of [8, 10, 12, 15, 20, 25, 30]) {
        const { delays } = planFrames({ trimStart: 0, trimEnd: 60, fps, speed: 1 });
        let elapsed = 0;
        delays.forEach((delay, i) => {
            elapsed += delay;
            assert.ok(Math.abs(elapsed - (i + 1) * 100 / fps) <= 0.5, `${fps}fps frame ${i}`);
        });
    }
});

test('planFrames at 30fps alternates 3 and 4 hundredths, above what viewers clamp', () => {
    const { delays } = planFrames({ trimStart: 0, trimEnd: 1, fps: 30, speed: 1 });
    assert.deepEqual([...delays].slice(0, 6), [3, 4, 3, 3, 4, 3]);
    assert.ok(delays.every((delay) => delay >= 2));
});

test('planFrames always gives at least one frame', () => {
    assert.equal(planFrames({ trimStart: 0, trimEnd: 0.001, fps: 8, speed: 1 }).times.length, 1);
});

test('planFrames rejects impossible settings', () => {
    assert.throws(() => planFrames({ trimStart: 0, trimEnd: 1, fps: 51, speed: 1 }), RangeError);
    assert.throws(() => planFrames({ trimStart: 0, trimEnd: 1, fps: 0, speed: 1 }), RangeError);
    assert.throws(() => planFrames({ trimStart: 0, trimEnd: 1, fps: 15, speed: 0 }), RangeError);
    assert.throws(() => planFrames({ trimStart: 2, trimEnd: 2, fps: 15, speed: 1 }), RangeError);
});

test('outputFrameCount adds a return trip without repeating the ends', () => {
    assert.equal(outputFrameCount(5, 'forever'), 5);
    assert.equal(outputFrameCount(5, 'boomerang'), 8);
    assert.equal(outputFrameCount(2, 'boomerang'), 2);
    assert.equal(outputFrameCount(1, 'boomerang'), 1);
});

test('widthForLongestEdge treats portrait and landscape alike, without upscaling', () => {
    assert.equal(widthForLongestEdge({ width: 1920, height: 1080 }, 480), 480);
    assert.equal(widthForLongestEdge({ width: 720, height: 1280 }, 480), 270);
    assert.equal(widthForLongestEdge({ width: 320, height: 180 }, 480), 320);
});

test('outputSize keeps the crop shape and never upscales', () => {
    const crop = { x: 0, y: 0, width: 1920, height: 1080 };
    assert.deepEqual(outputSize(crop, 480, LIMITS), { width: 480, height: 270 });
    assert.deepEqual(outputSize({ ...crop, width: 320, height: 180 }, 480, LIMITS), { width: 320, height: 180 });
});

test('outputSize fits tall crops within the height limit', () => {
    assert.deepEqual(outputSize({ x: 0, y: 0, width: 1080, height: 1920 }, 1080, LIMITS), { width: 720, height: 1280 });
});

test('outputSize keeps at least a pixel for extreme shapes', () => {
    assert.deepEqual(outputSize({ x: 0, y: 0, width: 4000, height: 2 }, 64, LIMITS), { width: 64, height: 1 });
});
