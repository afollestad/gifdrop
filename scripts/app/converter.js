// Turns a loaded video and settings into a GIF: samples colors across the clip,
// then captures and encodes every frame. Each job gets its own worker, so cancelling
// frees its memory straight away.
import { EncoderClient } from './encoder-client.js';
import { FrameGrabber } from './frame-grabber.js';
import { MAX_OUTPUT_BYTES, QUALITY_PRESETS } from './limits.js';
import { evenlySpacedIndices } from './plan.js';
import { captureAbortedError } from './video-seeker.js';

const MAX_PALETTE_SAMPLES = 32;

export function encoderConfig({ size, quality, loop }) {
    return { ...size, ...QUALITY_PRESETS[quality], loop, maxBytes: MAX_OUTPUT_BYTES };
}

// Halved, since the palette only needs a color count, not detail.
export function sampleSize({ width, height }) {
    return { width: Math.max(1, width >> 1), height: Math.max(1, height >> 1) };
}

// Captures sampled frames into the encoder and builds its palette.
export async function samplePalette({ video, encoder, times, crop, size, signal, onPaused, onResumed, onStep }) {
    const grabber = new FrameGrabber(video, { crop, ...sampleSize(size), signal, onPaused, onResumed });
    for (const index of evenlySpacedIndices(times.length, MAX_PALETTE_SAMPLES)) {
        await encoder.addSample(await grabber.grab(times[index]));
        onStep?.();
    }
    await encoder.buildPalette();
}

// `plan` is from planFrames. `onProgress` gets `done` and `total` steps and the bytes
// written so far. Rejects with an AbortError if `signal` aborts, or EncoderError,
// SeekStalledError or VideoDecodeError otherwise.
export async function convert({ video, plan, crop, size, quality, loop, signal, onProgress, onPaused, onResumed }) {
    const { times, delays } = plan;
    const samples = Math.min(times.length, MAX_PALETTE_SAMPLES);
    const total = samples + times.length;
    const encoder = new EncoderClient();
    let done = 0;
    const step = () => {
        done++;
        onProgress?.({ done, total, bytes: encoder.bytes });
    };

    const onAbort = () => encoder.terminate(captureAbortedError());
    signal?.addEventListener('abort', onAbort);
    try {
        signal?.throwIfAborted();
        await encoder.start(encoderConfig({ size, quality, loop }));
        await samplePalette({ video, encoder, times, crop, size, signal, onPaused, onResumed, onStep: step });

        const grabber = new FrameGrabber(video, { crop, ...size, signal, onPaused, onResumed });
        for (let i = 0; i < times.length; i++) {
            await encoder.addFrame(await grabber.grab(times[i]), delays[i]);
            step();
        }

        const result = await encoder.finish();
        return { blob: result.blob, frames: result.frames, bytes: result.bytes, width: size.width, height: size.height, stats: grabber.stats };
    } finally {
        signal?.removeEventListener('abort', onAbort);
        encoder.terminate();
    }
}
