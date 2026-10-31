import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatByteRange, formatBytes, formatTime, gifFileName, parseTime, spokenTime } from '../../scripts/app/format.js';

test('formatTime shows minutes and tenths', () => {
    assert.equal(formatTime(0), '0:00.0');
    assert.equal(formatTime(3.24), '0:03.2');
    assert.equal(formatTime(63.24), '1:03.2');
    assert.equal(formatTime(600), '10:00.0');
});

test('formatTime carries a rounded-up tenth into the minute', () => {
    assert.equal(formatTime(59.96), '1:00.0');
    assert.equal(formatTime(9.96), '0:10.0');
});

test('parseTime reads what people type', () => {
    assert.equal(parseTime('1:03.2'), 63.2);
    assert.equal(parseTime('63.2'), 63.2);
    assert.equal(parseTime('1:03'), 63);
    assert.equal(parseTime('.5'), 0.5);
    assert.equal(parseTime(' 5 '), 5);
    assert.equal(parseTime('1,5'), 1.5);
    assert.equal(parseTime(formatTime(63.2)), 63.2);
});

test('parseTime rejects anything else', () => {
    for (const text of ['', 'abc', '1:2:3', '-1', '1:60', '1:']) {
        assert.equal(parseTime(text), null, text);
    }
});

test('spokenTime reads naturally', () => {
    assert.equal(spokenTime(0), '0 seconds');
    assert.equal(spokenTime(1), '1 second');
    assert.equal(spokenTime(3.2), '3.2 seconds');
    assert.equal(spokenTime(60), '1 minute');
    assert.equal(spokenTime(63.2), '1 minute 3.2 seconds');
    assert.equal(spokenTime(125), '2 minutes 5 seconds');
});

test('formatBytes picks a sensible unit', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2 KB');
    assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
});

test('formatBytes moves up a unit when rounding would reach the next one', () => {
    assert.equal(formatBytes(1023.6), '1 KB');
    assert.equal(formatBytes(1024 * 1023.9), '1.0 MB');
});

test('formatByteRange only repeats the unit when it differs', () => {
    const mb = 1024 * 1024;
    assert.equal(formatByteRange(1.4 * mb, 1.9 * mb), '1.4–1.9 MB');
    assert.equal(formatByteRange(900 * 1024, 1.2 * mb), '900 KB–1.2 MB');
});

test('gifFileName swaps only the last extension', () => {
    assert.equal(gifFileName('clip.mov'), 'clip.gif');
    assert.equal(gifFileName('clip.final.mp4'), 'clip.final.gif');
    assert.equal(gifFileName('noextension'), 'noextension.gif');
    assert.equal(gifFileName('.mov'), 'video.gif');
});
