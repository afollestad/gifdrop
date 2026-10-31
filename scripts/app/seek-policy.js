// The rules for deciding when a seek has landed, with no browser dependency so
// they can be tested on their own. Times are in seconds unless named otherwise.

const SEEK_OFFSET = 0.001;
const MEDIA_TIME_TOLERANCE = 0.002;
const MEDIA_TIME_EPSILON = 1e-6;
const SAME_FRAME_FALLBACK_MS = 150;
const SAME_FRAME_CONFIRMED_MS = 40;
const LATENCY_MARGIN = 4;
const LATENCY_DECAY = 0.9;

// Beyond this a seek is taken to have left the frame showing, since no ordinary
// frame rate holds a frame this long. Only variable frame rate video can, such as a
// screen recording of a still screen, where a jump can land in the same frame and get
// no callback at all. So each long seek that ends without one waits less than the
// last, or a still clip would spend seconds on every jump.
const LONG_SEEK = 0.25;
const LONG_SEEK_FALLBACKS_MS = [5000, 1000, 250];
const NO_CALLBACK_LONG_SEEK_FALLBACK_MS = 1000;
const MAX_FALLBACK_MS = 10000;
const RETRY_WAYPOINT_DISTANCE = 0.5;

// The offset keeps the seek off a frame boundary, where rounding could land on
// the frame before. Seeking exactly to the duration can show nothing at all.
export function seekTarget(time, duration) {
    return Math.max(0, Math.min(time + SEEK_OFFSET, duration - SEEK_OFFSET));
}

// Whether a frame callback shows the seek landed, rather than describing a frame
// from before it, which Safari can report even after `seeked`. A frame that
// started no later than where the video was could be either one, so it doesn't
// count, and a seek within the frame already showing takes the fallback. Going
// backward, anything from before the seek is past the target.
export function showsNewFrame(mediaTime, target, before) {
    if (mediaTime > target + MEDIA_TIME_TOLERANCE) return false;
    return target <= before || mediaTime > before;
}

// Some browsers present the same frame again after a seek within it, which suggests
// no new frame is coming. It's only a suggestion, since Chrome can also do this just
// before presenting a new one, so it shortens the wait rather than ending it. Only
// after `seeked`, since Safari's leftover callbacks from before a seek can also
// repeat a time.
export function confirmsSameFrame(mediaTime, shownMediaTime, seeked) {
    return seeked && shownMediaTime !== null && Math.abs(mediaTime - shownMediaTime) < MEDIA_TIME_EPSILON;
}

// How long after `seeked` to wait for a frame callback before capturing anyway.
// A seek within one frame may never get a callback, so there has to be a limit,
// but `seeked` can lead the paint by however long decoding takes: a long jump
// through a long keyframe interval takes far more than a short hop.
// `longSeekMisses` counts long seeks that ended without a new frame. One means this video
// has long gaps, so a repeat of the frame showing can be believed on long seeks too. The
// first is never shortened, since a file cut off partway looks just the same.
// One very slow seek must not hold up every seek after it for minutes, hence the limit.
export function presentFallbackMs(seek) {
    return Math.min(MAX_FALLBACK_MS, uncappedFallbackMs(seek));
}

function uncappedFallbackMs({ distance, recentLatencyMs, hasFrameCallback, sameFrameConfirmed = false, longSeekMisses = 0 }) {
    if (sameFrameConfirmed && (!isLongSeek(distance) || longSeekMisses > 0)) return Math.max(SAME_FRAME_CONFIRMED_MS, recentLatencyMs);
    const shortWait = Math.max(SAME_FRAME_FALLBACK_MS, recentLatencyMs * LATENCY_MARGIN);
    if (!isLongSeek(distance)) return shortWait;
    if (!hasFrameCallback) return Math.max(shortWait, NO_CALLBACK_LONG_SEEK_FALLBACK_MS);
    const longWait = LONG_SEEK_FALLBACKS_MS[Math.min(longSeekMisses, LONG_SEEK_FALLBACKS_MS.length - 1)];
    return Math.max(shortWait, longWait);
}

export function isLongSeek(distance) {
    return distance > LONG_SEEK;
}

// Where to go before repeating a long seek that found no new frame, since seeking to the
// same position again doesn't make it paint. It's back toward where the seek came from, so
// the repeat is still a long seek, but close to the target, so there's little more to decode.
export function retryWaypoint(target, from) {
    const distance = Math.min(Math.abs(from - target), RETRY_WAYPOINT_DISTANCE);
    return from < target ? target - distance : target + distance;
}

// Tracks the slowest recent seek, fading so one slow seek doesn't slow the rest.
// `latencyMs` is null when a seek ended on the fallback, which measures nothing.
export function nextRecentLatency(recentLatencyMs, latencyMs) {
    return Math.max(latencyMs ?? 0, recentLatencyMs * LATENCY_DECAY);
}
