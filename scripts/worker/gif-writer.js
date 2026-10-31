// Writes frames to GIF bytes with gifenc, which only handles the format here: the
// palette and pixel decisions are made before it. Output is flushed frame by frame
// into separate chunks, since a single growing buffer would keep being copied.
import { GIFEncoder } from '../../vendor/gifenc/gifenc.esm.js';
import { TRANSPARENT_INDEX } from './palette.js';

const MAX_DELAY = 65535;
const MIN_COLOR_DEPTH = 2;
// Leaves the previous frame in place under this one, where gifenc's default for a
// frame with transparency would clear it.
const DISPOSE_KEEP = 1;
// gifenc's repeat values: 0 loops forever, and -1 leaves out the loop block.
const REPEAT_FOREVER = 0;
const REPEAT_ONCE = -1;

export class OutputTooLargeError extends Error {
    constructor(maxBytes) {
        super(`The GIF passed the ${maxBytes} byte limit`);
        this.name = 'OutputTooLargeError';
    }
}

export class GifWriter {
    #maxBytes;
    #width;
    #height;
    #palette;
    #colorDepth;
    #repeat;
    #boomerang;
    #encoder;
    #chunks = [];
    #framesWritten = 0;
    #bytesWritten = 0;

    // The newest frame waits here in case the next is identical and just extends it.
    #pending;
    #pendingDelay = 0;
    #hasPending = false;
    #pendingSlot = 0;
    #frameSizes = [];

    // For a boomerang's return trip, the full picture and delay of each frame.
    #pictures = [];
    #pictureDelays = [];

    constructor({ width, height, palette, loop, maxBytes = Infinity }) {
        this.#maxBytes = maxBytes;
        this.#width = width;
        this.#height = height;
        this.#palette = palette;
        this.#colorDepth = Math.max(MIN_COLOR_DEPTH, Math.ceil(Math.log2(palette.length)));
        this.#repeat = loop === 'once' ? REPEAT_ONCE : REPEAT_FOREVER;
        this.#boomerang = loop === 'boomerang';
        this.#pending = new Uint8Array(width * height);
        this.#encoder = GIFEncoder({ auto: false, initialCapacity: width * height });
        this.#encoder.writeHeader();
    }

    get framesWritten() {
        return this.#framesWritten;
    }

    get bytesWritten() {
        return this.#bytesWritten;
    }

    // What each frame added with addFrame cost, the first including the header and
    // palette, and a frame that only extended the one before costing nothing. A
    // frame's entry is final once the next has been added, or after finish().
    get frameSizes() {
        return this.#frameSizes;
    }

    // Takes the remapper's output, which it copies, since the remapper reuses both
    // buffers. `changed` is how many pixels differ from the frame before.
    addFrame(indices, composite, delay, changed) {
        if (this.#hasPending && changed === 0) {
            this.#pendingDelay += delay;
            if (this.#boomerang) this.#pictureDelays[this.#pictureDelays.length - 1] += delay;
            this.#frameSizes.push(0);
            return;
        }
        this.#flushPending();
        this.#pending.set(indices);
        this.#pendingDelay = delay;
        this.#hasPending = true;
        this.#pendingSlot = this.#frameSizes.length;
        this.#frameSizes.push(0);
        if (this.#boomerang) {
            this.#pictures.push(composite.slice());
            this.#pictureDelays.push(delay);
        }
    }

    // Returns the whole GIF, as chunks in order.
    finish() {
        this.#flushPending();
        if (this.#boomerang) this.#writeReturnTrip();
        this.#encoder.finish();
        this.#takeChunk();
        return this.#chunks;
    }

    #flushPending() {
        if (!this.#hasPending) return;
        const before = this.#bytesWritten;
        this.#write(this.#pending, this.#pendingDelay);
        this.#frameSizes[this.#pendingSlot] = this.#bytesWritten - before;
        this.#hasPending = false;
    }

    // Plays the frames between the two ends backward. Each shows exactly what it did
    // on the way out, so these compare pictures with no tolerance.
    #writeReturnTrip() {
        const pictures = this.#pictures;
        for (let i = pictures.length - 2; i >= 1; i--) {
            const picture = pictures[i];
            const shown = pictures[i + 1];
            const indices = this.#pending;
            for (let p = 0; p < picture.length; p++) {
                indices[p] = picture[p] === shown[p] ? TRANSPARENT_INDEX : picture[p];
            }
            this.#write(indices, this.#pictureDelays[i]);
        }
    }

    #write(indices, delay) {
        const first = this.#framesWritten === 0;
        this.#encoder.writeFrame(indices, this.#width, this.#height, {
            first,
            palette: first ? this.#palette : null,
            repeat: this.#repeat,
            colorDepth: this.#colorDepth,
            transparent: !first,
            transparentIndex: TRANSPARENT_INDEX,
            dispose: DISPOSE_KEEP,
            // gifenc takes milliseconds and rounds to the hundredths the format holds.
            delay: Math.min(delay, MAX_DELAY) * 10,
        });
        this.#framesWritten++;
        this.#takeChunk();
        if (this.#bytesWritten > this.#maxBytes) throw new OutputTooLargeError(this.#maxBytes);
    }

    #takeChunk() {
        const chunk = this.#encoder.bytes();
        this.#encoder.reset();
        this.#chunks.push(chunk);
        this.#bytesWritten += chunk.length;
    }
}
