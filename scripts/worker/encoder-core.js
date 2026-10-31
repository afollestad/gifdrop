// One GIF's encoding, from sampled colors to finished bytes, with no worker or
// browser dependency so it can be tested on its own. encoder-worker.js only passes
// messages to it.
import { GifWriter, OutputTooLargeError } from './gif-writer.js';
import { buildPalette, ColorHistogram } from './palette.js';
import { FrameRemapper } from './remap.js';

export { OutputTooLargeError };

export class EncoderJob {
    #config;
    #histogram = new ColorHistogram();
    #remapper = null;
    #writer = null;

    // `colors`, `tolerance` and `ditherScale` come from a quality preset.
    constructor({ width, height, colors, tolerance, ditherScale, loop, maxBytes = Infinity }) {
        this.#config = { width, height, colors, tolerance, ditherScale, loop, maxBytes };
    }

    get bytesWritten() {
        return this.#writer?.bytesWritten ?? 0;
    }

    // Samples can be smaller than the output, so they carry their own size.
    addSample(rgba, width, height) {
        this.#histogram.addFrame(rgba, width, height, 1);
    }

    // Call once, after the last sample and before the first frame.
    buildPalette() {
        const { width, height, colors, tolerance, ditherScale, loop, maxBytes } = this.#config;
        const { palette, rmsError } = buildPalette(this.#histogram, colors);
        this.#histogram = null;
        this.#remapper = new FrameRemapper({ width, height, palette, rmsError, ditherScale, tolerance });
        this.#writer = new GifWriter({ width, height, palette, loop, maxBytes });
        return palette.length - 1;
    }

    addFrame(rgba, delay) {
        const remapper = this.#remapper;
        const changed = remapper.remap(rgba);
        this.#writer.addFrame(remapper.indices, remapper.composite, delay, changed);
    }

    // Returns the GIF as `chunks`, and GifWriter's `frameSizes`.
    finish() {
        const writer = this.#writer;
        const chunks = writer.finish();
        return { chunks, frameSizes: writer.frameSizes, frames: writer.framesWritten, bytes: writer.bytesWritten };
    }
}
