// The main thread's side of encoder-worker.js. Frames go over as transferred
// buffers, with a few in flight so capture never waits on a reply, but no more, so a
// slow encoder holds capture back rather than letting frames pile up in memory.

const MAX_IN_FLIGHT = 4;

export class EncoderError extends Error {
    // `reason` is one of:
    //   too-large - the GIF passed its size limit
    //   memory    - the worker ran out of memory, or crashed, which looks the same
    //   internal  - anything else
    constructor(reason, message) {
        super(message);
        this.name = 'EncoderError';
        this.reason = reason;
    }
}

export class EncoderClient {
    #worker;
    #replies = [];
    #inFlight = 0;
    #creditWaiters = [];
    #failure = null;
    #bytes = 0;
    #started = false;

    constructor() {
        this.#worker = new Worker(new URL('../worker/encoder-worker.js', import.meta.url), { type: 'module' });
        this.#worker.onmessage = ({ data }) => this.#onMessage(data);
        this.#worker.onerror = (event) => {
            event.preventDefault();
            // Before its first reply it can only have failed to load, which more memory
            // wouldn't fix.
            this.#fail(new EncoderError(this.#started ? 'memory' : 'internal', event.message || 'The encoder stopped'));
        };
        this.#worker.onmessageerror = () => this.#fail(new EncoderError('internal', 'A message from the encoder could not be read'));
    }

    #onMessage(data) {
        if (data.type === 'failed') {
            this.#fail(new EncoderError(data.reason, data.message));
            return;
        }
        this.#started = true;
        if (data.bytes !== undefined) this.#bytes = data.bytes;
        this.#replies.shift()?.resolve(data);
    }

    #fail(error) {
        if (this.#failure) return;
        this.#failure = error;
        for (const reply of this.#replies.splice(0)) reply.reject(error);
        for (const waiter of this.#creditWaiters.splice(0)) waiter.reject(error);
    }

    #send(message, transfer = []) {
        if (this.#failure) return Promise.reject(this.#failure);
        return new Promise((resolve, reject) => {
            this.#replies.push({ resolve, reject });
            this.#worker.postMessage(message, transfer);
        });
    }

    // Sends without waiting for the reply, only for room to send. A failure surfaces
    // on the next call that waits.
    async #sendPixels(message, buffer) {
        if (this.#failure) throw this.#failure;
        if (this.#inFlight >= MAX_IN_FLIGHT) {
            await new Promise((resolve, reject) => this.#creditWaiters.push({ resolve, reject }));
        } else {
            this.#inFlight++;
        }
        this.#send(message, [buffer]).then(() => {
            const next = this.#creditWaiters.shift();
            if (next) next.resolve();
            else this.#inFlight--;
        }, () => {});
    }

    // The GIF's size so far, as of the last frame the worker finished.
    get bytes() {
        return this.#bytes;
    }

    start(config) {
        return this.#send({ type: 'start', config });
    }

    addSample(image) {
        const { buffer } = image.data;
        return this.#sendPixels({ type: 'sample', pixels: buffer, width: image.width, height: image.height }, buffer);
    }

    buildPalette() {
        return this.#send({ type: 'buildPalette' });
    }

    addFrame(image, delay) {
        const { buffer } = image.data;
        return this.#sendPixels({ type: 'frame', pixels: buffer, delay }, buffer);
    }

    finish() {
        return this.#send({ type: 'finish' });
    }

    // Stops at once and frees the worker's memory, failing anything still waiting.
    terminate(reason = new EncoderError('internal', 'The encoder was stopped')) {
        this.#fail(reason);
        this.#worker.terminate();
    }
}
