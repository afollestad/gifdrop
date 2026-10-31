import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aspectNumber, clampTrim, deriveOutput, initialSettings, playbackSeconds, slideTrim, widthLimit, withAspect, withCrop, withOutputWidth } from '../../scripts/app/settings.js';
import { planFrames } from '../../scripts/app/plan.js';

const LANDSCAPE = { videoWidth: 1920, videoHeight: 1080, duration: 20 };
const PORTRAIT = { videoWidth: 720, videoHeight: 1280, duration: 20 };

test('initialSettings takes the first 5 seconds at a sensible size', () => {
    const settings = initialSettings(LANDSCAPE);
    assert.equal(settings.trimStart, 0);
    assert.equal(settings.trimEnd, 5);
    assert.equal(settings.width, 480);
    assert.deepEqual(settings.crop, { x: 0, y: 0, width: 1920, height: 1080 });
});

test('initialSettings keeps a portrait video from being tall and heavy', () => {
    assert.equal(initialSettings(PORTRAIT).width, 270);
});

test('initialSettings handles a clip shorter than the default trim', () => {
    assert.equal(initialSettings({ ...LANDSCAPE, duration: 2 }).trimEnd, 2);
});

test('clampTrim keeps a frame between the ends, moving the end that was not dragged', () => {
    const settings = { fps: 10, speed: 1 };
    assert.deepEqual(
        { ...clampTrim({ ...settings, trimStart: 5, trimEnd: 5 }, 20, 'start') },
        { ...settings, trimStart: 5, trimEnd: 5.1 },
    );
    const end = clampTrim({ ...settings, trimStart: 5, trimEnd: 4 }, 20, 'end');
    assert.equal(end.trimEnd, 4);
    assert.ok(Math.abs(end.trimStart - 3.9) < 1e-9);
});

test('clampTrim stays inside the video at both ends', () => {
    const settings = { fps: 10, speed: 1 };
    const atEnd = clampTrim({ ...settings, trimStart: 25, trimEnd: 30 }, 20, 'start');
    assert.ok(Math.abs(atEnd.trimStart - 19.9) < 1e-9);
    assert.equal(atEnd.trimEnd, 20);
    const atStart = clampTrim({ ...settings, trimStart: -3, trimEnd: 0 }, 20, 'end');
    assert.equal(atStart.trimStart, 0);
    assert.equal(atStart.trimEnd, 0.1);
});

test('clampTrim copes with a clip shorter than one frame', () => {
    const clamped = clampTrim({ fps: 8, speed: 4, trimStart: 0, trimEnd: 0.1 }, 0.1, 'start');
    assert.equal(clamped.trimStart, 0);
    assert.equal(clamped.trimEnd, 0.1);
});

test('slideTrim keeps the length and stays inside the video', () => {
    const settings = { trimStart: 2, trimEnd: 7 };
    assert.deepEqual(slideTrim(settings, 5, 20), { trimStart: 5, trimEnd: 10 });
    assert.deepEqual(slideTrim(settings, -3, 20), { trimStart: 0, trimEnd: 5 });
    assert.deepEqual(slideTrim(settings, 30, 20), { trimStart: 15, trimEnd: 20 });
});

test('withAspect centers a crop and can only bring the width down', () => {
    const settings = initialSettings(LANDSCAPE);
    const square = withAspect(settings, '1', LANDSCAPE);
    assert.deepEqual(square.crop, { x: 420, y: 0, width: 1080, height: 1080 });
    assert.equal(square.aspect, '1');
    assert.equal(square.width, 480);

    const wide = withAspect(withOutputWidth(settings, 1280), '0.5625', LANDSCAPE);
    assert.equal(wide.crop.width, 608);
    assert.equal(wide.width, 608);
});

test('withAspect returns to the whole frame for original and free', () => {
    const settings = withAspect(initialSettings(LANDSCAPE), '1', LANDSCAPE);
    assert.equal(withAspect(settings, 'original', LANDSCAPE).crop.width, 1920);
    assert.equal(withAspect(settings, 'free', LANDSCAPE).crop.width, 1920);
});

test('withCrop fits typed numbers and limits the width', () => {
    const settings = { ...initialSettings(LANDSCAPE), width: 480 };
    const fitted = withCrop(settings, { x: 1900, y: 0, width: 100, height: 100 }, LANDSCAPE);
    assert.deepEqual(fitted.crop, { x: 1820, y: 0, width: 100, height: 100 });
    assert.equal(fitted.width, 100);
});

test('the width recovers once a small crop is undone', () => {
    const settings = withAspect(initialSettings(LANDSCAPE), 'free', LANDSCAPE);
    const small = withCrop(settings, { ...settings.crop, width: 16 }, LANDSCAPE);
    assert.equal(small.width, 16);
    assert.equal(withAspect(small, 'original', LANDSCAPE).width, 480);
});

test('a typed dimension keeps a fixed shape', () => {
    const square = withAspect(initialSettings(LANDSCAPE), '1', LANDSCAPE);
    assert.deepEqual(withCrop(square, { ...square.crop, width: 100 }, LANDSCAPE).crop, { x: 420, y: 0, width: 100, height: 100 });
    assert.deepEqual(withCrop(square, { ...square.crop, height: 100 }, LANDSCAPE).crop, { x: 420, y: 0, width: 100, height: 100 });
});

test('a fixed shape shrinks to fit rather than running past the frame', () => {
    const square = withAspect(initialSettings(LANDSCAPE), '1', LANDSCAPE);
    const fitted = withCrop(square, { ...square.crop, x: 0, width: 1900 }, LANDSCAPE).crop;
    assert.equal(fitted.width, 1080);
    assert.equal(fitted.height, 1080);
});

test('moving a fixed shape leaves its size alone', () => {
    const square = withAspect(initialSettings(LANDSCAPE), '1', LANDSCAPE);
    assert.deepEqual(withCrop(square, { ...square.crop, x: 100 }, LANDSCAPE).crop, { x: 100, y: 0, width: 1080, height: 1080 });
});

test('widthLimit respects both output limits', () => {
    assert.equal(widthLimit({ width: 4000, height: 2000 }), 1280);
    assert.equal(widthLimit({ width: 1080, height: 1920 }), 720);
    assert.equal(widthLimit({ width: 320, height: 180 }), 320);
});

test('aspectNumber reads only real ratios', () => {
    assert.equal(aspectNumber('1'), 1);
    assert.equal(aspectNumber('free'), null);
    assert.equal(aspectNumber('original'), null);
});

test('deriveOutput gives what the converter needs', () => {
    const { plan, size, errors, warnings } = deriveOutput(initialSettings(LANDSCAPE));
    assert.equal(plan.times.length, 75);
    assert.deepEqual(size, { width: 480, height: 270 });
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
});

test('deriveOutput reports limits, using the estimate once there is one', () => {
    const long = { ...initialSettings(LANDSCAPE), trimEnd: 20, fps: 30, speed: 0.25, width: 480 };
    assert.equal(deriveOutput(long).errors.length, 1);
    const big = deriveOutput(initialSettings(LANDSCAPE), { estimateUpperBytes: 20 * 1024 * 1024 });
    assert.match(big.warnings[0], /very large/);
});

test('playbackSeconds counts a boomerang return trip', () => {
    const plan = planFrames({ trimStart: 0, trimEnd: 1, fps: 10, speed: 1 });
    assert.equal(playbackSeconds(plan, 'forever'), 1);
    assert.equal(playbackSeconds(plan, 'boomerang'), 1.8);
});
