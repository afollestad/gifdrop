// What tests/e2e/convert.html runs, each through the real converter and worker. By
// default a case converts all of barcode.mp4 to 320 wide at 15 FPS, and
// convert-check.mjs reads back every frame's barcode. `optionalCodec` is as in
// capture-cases.js, and `noBarcode` is for footage without one.

export const CONVERT_CASES = [
    { name: 'plain loop' },
    { name: 'plays once', loop: 'once' },
    { name: 'boomerang of a trim', loop: 'boomerang', trimStart: 1, trimEnd: 2.5 },
    { name: 'trimmed', trimStart: 1.2, trimEnd: 3.1 },
    { name: '2x speed', speed: 2 },
    { name: '0.5x at 30fps, repeating source frames', speed: 0.5, fps: 30, trimEnd: 2 },
    { name: '30fps', fps: 30 },
    { name: 'cropped to a band', crop: { x: 0, y: 90, width: 640, height: 180 } },
    { name: 'small quality', quality: 'small' },
    { name: 'high quality', quality: 'high' },
    { name: 'large downscale', width: 96 },
    { name: 'rotated', src: 'barcode-rotated.mp4', axis: 'height', width: 180 },
    { name: 'long GOP from 10s', src: 'barcode-longgop.mp4', trimStart: 10, trimEnd: 12 },
    { name: 'vp9', src: 'barcode.webm', optionalCodec: true },
    { name: 'hevc', src: 'barcode-hevc.mp4', optionalCodec: true },
    { name: 'one unchanging picture', src: 'still.mp4', noBarcode: true, expectFrames: 1 },
    { name: 'realistic footage', src: 'motion.mp4', noBarcode: true, estimate: true },
    { name: 'realistic boomerang', src: 'motion.mp4', noBarcode: true, estimate: true, loop: 'boomerang', trimEnd: 4 },
    { name: 'short clip estimated exactly', src: 'motion.mp4', noBarcode: true, estimate: true, trimEnd: 2 },
];
