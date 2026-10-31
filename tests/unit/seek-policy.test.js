import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmsSameFrame, isLongSeek, nextRecentLatency, presentFallbackMs, retryWaypoint, seekTarget, showsNewFrame } from '../../scripts/app/seek-policy.js';

test('seekTarget stays off frame boundaries and inside the video', () => {
    assert.equal(seekTarget(1, 4), 1.001);
    assert.equal(seekTarget(0, 4), 0.001);
    assert.equal(seekTarget(4, 4), 3.999);
    assert.equal(seekTarget(0, 0), 0);
});

test('showsNewFrame rejects a callback for the frame from before a forward seek', () => {
    // Safari reports the first frame after a seek to 1s has already finished.
    assert.equal(showsNewFrame(0, 1.001, 0), false);
    // Frames left over from iOS playing the video briefly while loading it.
    assert.equal(showsNewFrame(0.1, 1.001, 0.12), false);
});

test('showsNewFrame accepts the frame a forward seek lands on', () => {
    assert.equal(showsNewFrame(1, 1.001, 0), true);
    assert.equal(showsNewFrame(1.0666, 1.067, 1.001), true);
});

test('showsNewFrame leaves a seek within the showing frame to the fallback', () => {
    assert.equal(showsNewFrame(1.0666, 1.068, 1.067), false);
});

test('showsNewFrame rejects frames beyond the target, including when seeking back', () => {
    assert.equal(showsNewFrame(3.9, 1.001, 3.95), false);
    assert.equal(showsNewFrame(1, 1.001, 3.95), true);
    assert.equal(showsNewFrame(2, 1.001, 0), false);
});

test('confirmsSameFrame needs the seek done and the frame known to be showing', () => {
    assert.equal(confirmsSameFrame(1.0666, 1.0666, true), true);
    assert.equal(confirmsSameFrame(1.0666, 1.0666, false), false);
    assert.equal(confirmsSameFrame(1.0666, null, true), false);
    assert.equal(confirmsSameFrame(0.1, 1.0666, true), false);
});

test('presentFallbackMs waits briefly for a short hop', () => {
    assert.equal(presentFallbackMs({ distance: 0.066, recentLatencyMs: 0, hasFrameCallback: true }), 150);
});

test('presentFallbackMs waits less once the same frame is shown again', () => {
    assert.equal(presentFallbackMs({ distance: 0.066, recentLatencyMs: 0, hasFrameCallback: true, sameFrameConfirmed: true }), 40);
    assert.equal(presentFallbackMs({ distance: 0.066, recentLatencyMs: 90, hasFrameCallback: true, sameFrameConfirmed: true }), 90);
});

test('presentFallbackMs never cuts a long jump short', () => {
    assert.equal(presentFallbackMs({ distance: 10, recentLatencyMs: 0, hasFrameCallback: true, sameFrameConfirmed: true }), 5000);
});

test('presentFallbackMs believes a repeated frame on long seeks once gaps are known', () => {
    assert.equal(presentFallbackMs({ distance: 10, recentLatencyMs: 0, hasFrameCallback: true, sameFrameConfirmed: true, longSeekMisses: 1 }), 40);
});

test('presentFallbackMs scales with how slow seeks have been', () => {
    assert.equal(presentFallbackMs({ distance: 0.066, recentLatencyMs: 100, hasFrameCallback: true }), 400);
});

test('presentFallbackMs waits much longer after a long jump', () => {
    // A jump through a long keyframe interval outlasted 150ms in the iOS Simulator.
    assert.equal(presentFallbackMs({ distance: 10, recentLatencyMs: 0, hasFrameCallback: true }), 5000);
    assert.equal(presentFallbackMs({ distance: 10, recentLatencyMs: 2000, hasFrameCallback: true }), 8000);
});

test('presentFallbackMs waits less after each long seek that found no new frame', () => {
    const base = { distance: 10, recentLatencyMs: 0, hasFrameCallback: true };
    assert.equal(presentFallbackMs({ ...base, longSeekMisses: 0 }), 5000);
    assert.equal(presentFallbackMs({ ...base, longSeekMisses: 1 }), 1000);
    assert.equal(presentFallbackMs({ ...base, longSeekMisses: 2 }), 250);
    assert.equal(presentFallbackMs({ ...base, longSeekMisses: 50 }), 250);
});

test('presentFallbackMs still allows for seeks known to be slow', () => {
    assert.equal(presentFallbackMs({ distance: 10, recentLatencyMs: 400, hasFrameCallback: true, longSeekMisses: 5 }), 1600);
});

test('presentFallbackMs bounds a long jump when no callback can ever arrive', () => {
    assert.equal(presentFallbackMs({ distance: 10, recentLatencyMs: 0, hasFrameCallback: false }), 1000);
    assert.equal(presentFallbackMs({ distance: 0.066, recentLatencyMs: 0, hasFrameCallback: false }), 150);
});

test('retryWaypoint stops short of the target, on the side the seek came from', () => {
    assert.equal(retryWaypoint(10, 0), 9.5);
    assert.equal(retryWaypoint(1, 9), 1.5);
});

test('retryWaypoint never goes past where the seek came from, and leaves a long seek', () => {
    assert.equal(retryWaypoint(1, 0.7), 0.7);
    assert.equal(retryWaypoint(1, 1.3), 1.3);
    for (const from of [0.7, 1.3, 5]) assert.ok(isLongSeek(Math.abs(1 - retryWaypoint(1, from))));
});

test('nextRecentLatency holds the slowest seek and fades without a measurement', () => {
    assert.equal(nextRecentLatency(0, 40), 40);
    assert.equal(nextRecentLatency(100, 40), 90);
    assert.equal(nextRecentLatency(100, null), 90);
    assert.equal(nextRecentLatency(10, 200), 200);
});
