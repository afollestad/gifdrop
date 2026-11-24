import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALPHA_CUTOFF, hasTransparency } from '../../scripts/worker/alpha.js';

const pixels = (...alphas) => new Uint8ClampedArray(alphas.flatMap((alpha) => [200, 100, 50, alpha]));

test('a pixel under half opacity is transparent', () => {
    assert.equal(ALPHA_CUTOFF, 128);
    assert.equal(hasTransparency(pixels(255, 127)), true);
    assert.equal(hasTransparency(pixels(255, 0, 255)), true);
});

test('half opacity and above is opaque', () => {
    assert.equal(hasTransparency(pixels(128, 255)), false);
    assert.equal(hasTransparency(pixels()), false);
});
