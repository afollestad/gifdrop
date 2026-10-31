// The retry against a fake video, since a real one can't be made to miss a paint on demand.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { canSeekNearEnd, VideoSeeker } from '../../scripts/app/video-seeker.js';

// `paint` says what frame time a seek ends up showing, by its position and its place in
// the order, or null for one that never paints.
class FakeVideo extends EventTarget {
    readyState = 2;
    seeking = false;
    duration = 20;
    seeks = [];
    #time;
    #paint;
    #callback = null;

    constructor({ at = 0, paint = () => null } = {}) {
        super();
        this.#time = at;
        this.#paint = paint;
    }

    get currentTime() {
        return this.#time;
    }

    set currentTime(position) {
        this.#time = position;
        const mediaTime = this.#paint(position, this.seeks.length);
        this.seeks.push(position);
        queueMicrotask(() => {
            this.dispatchEvent(new Event('seeked'));
            if (mediaTime !== null) this.#callback?.(0, { mediaTime });
        });
    }

    requestVideoFrameCallback(callback) {
        this.#callback = callback;
        return 1;
    }

    cancelVideoFrameCallback() {
        this.#callback = null;
    }
}

// Runs the mocked clock until the promise settles, so waits take no real time.
async function settled(promise) {
    let done = false;
    const finish = () => {
        done = true;
    };
    promise.then(finish, finish);
    while (!done) {
        await new Promise(setImmediate);
        mock.timers.tick(50);
    }
    return promise;
}

beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
});

afterEach(() => {
    mock.timers.reset();
    delete globalThis.document;
});

test('a long seek that paints goes straight there', async () => {
    const video = new FakeVideo({ paint: () => 10 });
    assert.equal(await settled(new VideoSeeker(video).seek(10.001)), true);
    assert.deepEqual(video.seeks, [10.001]);
});

test('the first long miss goes somewhere nearby and tries again', async () => {
    const video = new FakeVideo({ paint: (position, index) => (index === 2 ? 10 : null) });
    assert.equal(await settled(new VideoSeeker(video).seek(10)), true);
    assert.deepEqual(video.seeks, [10, 9.5, 10]);
});

test('passing through the waypoint needs no frame and counts as nothing', async () => {
    const misses = [];
    const video = new FakeVideo();
    const seeker = new VideoSeeker(video, { onLongMiss: (miss) => misses.push(miss) });
    assert.equal(await settled(seeker.seek(10)), false);
    assert.deepEqual(misses.map(({ target, before, earlierMisses }) => [target, before, earlierMisses]), [[10, 0, 0], [10, 9.5, 1]]);
});

test('only the first long miss is tried again', async () => {
    const video = new FakeVideo();
    const seeker = new VideoSeeker(video);
    assert.equal(await settled(seeker.seek(10)), false);
    assert.equal(await settled(seeker.seek(15)), false);
    assert.deepEqual(video.seeks, [10, 9.5, 10, 15]);
});

test('a later long miss is not tried again after a retry that worked', async () => {
    const video = new FakeVideo({ paint: (position, index) => (index === 2 ? 10 : null) });
    const seeker = new VideoSeeker(video);
    assert.equal(await settled(seeker.seek(10)), true);
    assert.equal(await settled(seeker.seek(15)), false);
    assert.deepEqual(video.seeks, [10, 9.5, 10, 15]);
});

test('a short seek that misses is not tried again, even after a long miss', async () => {
    const video = new FakeVideo();
    const seeker = new VideoSeeker(video);
    assert.equal(await settled(seeker.seek(0.1)), false);
    assert.deepEqual(video.seeks, [0.1]);
    assert.equal(await settled(seeker.seek(10)), false);
    assert.equal(await settled(seeker.seek(10.1)), false);
    assert.deepEqual(video.seeks, [0.1, 10, 9.5, 10, 10.1]);
});

test('nothing is tried again where it could not be told to have worked', async () => {
    const noCallbacks = new FakeVideo();
    noCallbacks.requestVideoFrameCallback = undefined;
    await settled(new VideoSeeker(noCallbacks).seek(10));
    assert.deepEqual(noCallbacks.seeks, [10]);

    const hidden = new FakeVideo();
    globalThis.document.hidden = true;
    await settled(new VideoSeeker(hidden).seek(10));
    assert.deepEqual(hidden.seeks, [10]);
});

test('a cancel while passing through the waypoint stops there', async () => {
    const controller = new AbortController();
    const video = new FakeVideo({
        paint: (position, index) => {
            if (index === 1) queueMicrotask(() => controller.abort());
            return null;
        },
    });
    await assert.rejects(settled(new VideoSeeker(video, { signal: controller.signal }).seek(10)), { name: 'AbortError' });
    assert.deepEqual(video.seeks, [10, 9.5]);
});

test('canSeekNearEnd goes by how the retry ended', async () => {
    const healed = new FakeVideo({ paint: (position, index) => (index === 2 ? position : null) });
    assert.equal(await settled(canSeekNearEnd(healed)), true);

    const cutOff = new FakeVideo();
    assert.equal(await settled(canSeekNearEnd(cutOff)), false);
});
