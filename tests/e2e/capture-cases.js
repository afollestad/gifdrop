// What tests/e2e/capture.html runs. `optionalCodec` marks a format a browser may
// legitimately not decode, such as HEVC on Linux or VP9 in the iOS Simulator, so
// failing to load it is reported as unsupported rather than as a failure. H.264
// has no such pass.

const at30 = (t) => Math.floor(t * 30);

export const CAPTURE_CASES = [
    { name: 'h264 15fps', src: 'barcode.mp4', fps: 15 },
    { name: 'h264 30fps', src: 'barcode.mp4', fps: 30 },

    // Frame 0 reads the same as blank or stale output, so these start later to
    // catch a first capture that shows the wrong frame.
    { name: 'h264 from 1s', src: 'barcode.mp4', fps: 15, start: 1 },
    { name: 'h264 from 2.5s', src: 'barcode.mp4', fps: 15, start: 2.5 },
    { name: 'long GOP from 10s', src: 'barcode-longgop.mp4', fps: 15, start: 10, end: 12 },
    { name: 'vp9 from 1s', src: 'barcode.webm', fps: 15, start: 1, optionalCodec: true },
    { name: 'hevc from 1s', src: 'barcode-hevc.mp4', fps: 15, start: 1, optionalCodec: true },

    { name: 'rerun on the same video, seeking back', src: 'barcode.mp4', fps: 15, start: 1, rerun: true },
    { name: 'h264 0.5x at 30fps (same-frame seeks)', src: 'barcode.mp4', fps: 30, speed: 0.5 },
    { name: 'h264 4x at 15fps', src: 'barcode.mp4', fps: 15, speed: 4 },
    { name: 'long GOP 15fps', src: 'barcode-longgop.mp4', fps: 15, end: 20 },
    { name: 'vp9 15fps', src: 'barcode.webm', fps: 15, optionalCodec: true },
    { name: 'hevc 15fps', src: 'barcode-hevc.mp4', fps: 15, optionalCodec: true },
    { name: 'vfr 15fps', src: 'barcode-vfr.mp4', fps: 15, frameAt: (t) => (t < 2 ? at30(t) : 60 + Math.floor((t - 2) * 10)) },
    { name: 'rotated', src: 'barcode-rotated.mp4', fps: 15, axis: 'height', expectSize: [360, 640] },
    { name: 'anamorphic', src: 'barcode-anamorphic.mp4', fps: 15, expectSize: [640, 360] },
    { name: 'large downscale', src: 'barcode.mp4', fps: 15, outputWidth: 96 },
    { name: 'beside a playing preview', src: 'barcode.mp4', fps: 15, withPreview: true },
    { name: 'without frame callbacks', src: 'barcode.mp4', fps: 15, start: 1, noFrameCallback: true },
    { name: 'no duration webm', src: 'barcode-noduration.webm', fps: 15, optionalCodec: true },
    { name: 'play refused while loading', src: 'barcode.mp4', fps: 15, start: 1, refusePlay: true },
];

export const REJECTED_FILES = [
    { name: 'audio only', src: 'audio-only.m4a' },
    { name: 'truncated', src: 'truncated.mp4' },
];
