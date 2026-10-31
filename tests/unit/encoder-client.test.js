// The client's protocol against a fake worker, for what a real one can't be made to do
// on demand: crash, fail to load, or send something unreadable.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { EncoderClient, EncoderError } from '../../scripts/app/encoder-client.js';

let worker;

class FakeWorker {
    sent = [];

    constructor() {
        worker = this;
    }

    postMessage(message) {
        this.sent.push(message);
    }

    terminate() {
        this.terminated = true;
    }

    reply(data = { type: 'ack' }) {
        this.onmessage({ data });
    }
}

beforeEach(() => {
    globalThis.Worker = FakeWorker;
});

const frame = () => ({ data: { buffer: new ArrayBuffer(4) }, width: 1, height: 1 });
const settled = () => new Promise((resolve) => setImmediate(resolve));

test('frames wait for room once enough are in flight, and then go in order', async () => {
    const client = new EncoderClient();
    const sends = [];
    for (let i = 0; i < 6; i++) sends.push(client.addFrame(frame(), i));
    await settled();
    assert.equal(worker.sent.length, 4);
    worker.reply();
    await settled();
    assert.equal(worker.sent.length, 5);
    worker.reply();
    await Promise.all(sends);
    assert.deepEqual(worker.sent.map((message) => message.delay), [0, 1, 2, 3, 4, 5]);
});

test('reported bytes follow the replies', async () => {
    const client = new EncoderClient();
    await client.addFrame(frame(), 1);
    worker.reply({ type: 'ack', bytes: 500 });
    assert.equal(client.bytes, 500);
});

test('a failure from the worker reaches whoever is waiting, with its reason', async () => {
    const client = new EncoderClient();
    const finishing = client.finish();
    worker.reply({ type: 'failed', reason: 'too-large', message: 'Too big' });
    await assert.rejects(finishing, (error) => error instanceof EncoderError && error.reason === 'too-large');
    await assert.rejects(client.buildPalette(), (error) => error.reason === 'too-large');
});

test('a failure also reaches frames waiting for room', async () => {
    const client = new EncoderClient();
    for (let i = 0; i < 4; i++) await client.addFrame(frame(), i);
    const waiting = client.addFrame(frame(), 4);
    worker.reply({ type: 'failed', reason: 'memory', message: 'Out' });
    await assert.rejects(waiting, (error) => error.reason === 'memory');
});

function errorEvent(message) {
    return { message, preventDefault() {} };
}

test('a crash after starting reads as running out of memory', async () => {
    const client = new EncoderClient();
    const starting = client.start({});
    worker.reply();
    await starting;
    const finishing = client.finish();
    worker.onerror(errorEvent('Crashed'));
    await assert.rejects(finishing, (error) => error.reason === 'memory');
});

test('failing before any reply reads as a failed load, not memory', async () => {
    const client = new EncoderClient();
    const starting = client.start({});
    worker.onerror(errorEvent('Could not load'));
    await assert.rejects(starting, (error) => error.reason === 'internal');
});

test('an unreadable message fails the job rather than leaving it hanging', async () => {
    const client = new EncoderClient();
    const finishing = client.finish();
    worker.onmessageerror();
    await assert.rejects(finishing, (error) => error.reason === 'internal');
});

test('terminating stops the worker and fails what was waiting, with the reason given', async () => {
    const client = new EncoderClient();
    const finishing = client.finish();
    const reason = new DOMException('Stop', 'AbortError');
    client.terminate(reason);
    assert.equal(worker.terminated, true);
    await assert.rejects(finishing, (error) => error === reason);
});
