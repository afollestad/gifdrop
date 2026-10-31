import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFiles, looksLikeVideo } from '../../scripts/app/file-check.js';
import { convertErrorMessage, loadErrorMessage } from '../../scripts/app/messages.js';

const file = (name, type, extra = {}) => ({ name, type, size: 100, isDirectory: false, ...extra });

test('looksLikeVideo trusts a video type', () => {
    assert.equal(looksLikeVideo(file('clip', 'video/mp4')), true);
    assert.equal(looksLikeVideo(file('clip.bin', 'video/quicktime')), true);
});

test('looksLikeVideo falls back to the extension when no type is known', () => {
    assert.equal(looksLikeVideo(file('clip.MOV', '')), true);
    assert.equal(looksLikeVideo(file('clip.mkv', 'application/octet-stream')), true);
    assert.equal(looksLikeVideo(file('notes.txt', '')), false);
    assert.equal(looksLikeVideo(file('noextension', '')), false);
});

test('looksLikeVideo rejects a known other type, whatever the extension', () => {
    assert.equal(looksLikeVideo(file('song.mp3', 'audio/mpeg')), false);
    assert.equal(looksLikeVideo(file('photo.mp4', 'image/jpeg')), false);
});

test('checkFiles accepts one video', () => {
    const video = file('clip.mp4', 'video/mp4');
    assert.deepEqual(checkFiles([video]), { file: video });
});

test('checkFiles explains each way of getting it wrong', () => {
    assert.match(checkFiles([]).error, /didn't include a file/);
    assert.match(checkFiles([file('a.mp4', 'video/mp4'), file('b.mp4', 'video/mp4')]).error, /one video at a time/);
    assert.match(checkFiles([file('folder', '', { isDirectory: true })]).error, /folder/);
    assert.match(checkFiles([file('empty.mp4', 'video/mp4', { size: 0 })]).error, /empty\.mp4 is empty/);
    assert.match(checkFiles([file('song.mp3', 'audio/mpeg')]).error, /song\.mp3 isn't a video/);
});

test('loadErrorMessage covers every load failure, with a fallback', () => {
    for (const reason of ['undecodable', 'no-video', 'timeout', 'anything else']) {
        assert.ok(loadErrorMessage(reason).length > 0);
    }
    assert.match(loadErrorMessage('no-video'), /audio only/);
});

test('convertErrorMessage names the time where a seek went wrong', () => {
    assert.match(convertErrorMessage({ name: 'SeekStalledError', time: 63.2 }), /1:03\.2/);
    assert.match(convertErrorMessage({ name: 'VideoDecodeError', time: 3 }), /0:03\.0/);
    assert.match(convertErrorMessage({ name: 'EncoderError', reason: 'memory' }), /memory/);
    assert.match(convertErrorMessage({ name: 'EncoderError', reason: 'too-large' }), /too large/);
    assert.match(convertErrorMessage({ name: 'TypeError' }), /try again/);
});
