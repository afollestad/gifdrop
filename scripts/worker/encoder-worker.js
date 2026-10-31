// Runs an EncoderJob off the main thread. Every message gets one reply, or a
// `failed` message that ends the job, and encoder-client.js is the other side.
import { EncoderJob, OutputTooLargeError } from './encoder-core.js';

let job = null;

function failureReason(error) {
    if (error instanceof OutputTooLargeError) return 'too-large';
    if (error instanceof RangeError) return 'memory';
    return 'internal';
}

const HANDLERS = {
    start({ config }) {
        job = new EncoderJob(config);
        return { type: 'ack' };
    },
    sample({ pixels, width, height }) {
        job.addSample(new Uint8ClampedArray(pixels), width, height);
        return { type: 'ack' };
    },
    buildPalette() {
        return { type: 'ack', colors: job.buildPalette() };
    },
    frame({ pixels, delay }) {
        job.addFrame(new Uint8ClampedArray(pixels), delay);
        return { type: 'ack', bytes: job.bytesWritten };
    },
    finish() {
        const { chunks, frameSizes, frames, bytes } = job.finish();
        return { type: 'ack', blob: new Blob(chunks, { type: 'image/gif' }), frameSizes, frames, bytes };
    },
};

self.onmessage = ({ data }) => {
    try {
        self.postMessage(HANDLERS[data.type](data));
    } catch (error) {
        self.postMessage({ type: 'failed', reason: failureReason(error), message: error.message });
    }
};
