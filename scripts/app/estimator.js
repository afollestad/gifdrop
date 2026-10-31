// Encodes a sample of a GIF with the real pipeline, in a throwaway worker, to say
// how large it'll be. Cancelling is the normal way out, since settings keep changing.
import { encoderConfig, samplePalette } from './converter.js';
import { EncoderClient } from './encoder-client.js';
import { estimateFrameIndices, estimateSize } from './estimate-math.js';
import { FrameGrabber } from './frame-grabber.js';
import { captureAbortedError } from './video-seeker.js';

// Resolves with `low`, `high` and `exact` from estimateSize, in bytes. `quality`
// matters, `loop` only for the return trip, which estimateSize works out, so this is
// always encoded as a plain loop.
export async function estimate({ video, plan, crop, size, quality, loop, signal }) {
    const { times, delays } = plan;
    const encoder = new EncoderClient();
    const onAbort = () => encoder.terminate(captureAbortedError());
    signal?.addEventListener('abort', onAbort);
    try {
        signal?.throwIfAborted();
        await encoder.start(encoderConfig({ size, quality, loop: 'forever' }));
        await samplePalette({ video, encoder, times, crop, size, signal });

        const grabber = new FrameGrabber(video, { crop, ...size, signal });
        for (const index of estimateFrameIndices(times.length)) {
            await encoder.addFrame(await grabber.grab(times[index]), delays[index]);
        }
        const { frameSizes } = await encoder.finish();
        return estimateSize({ frameSizes, frames: times.length, loop });
    } finally {
        signal?.removeEventListener('abort', onAbort);
        encoder.terminate();
    }
}
