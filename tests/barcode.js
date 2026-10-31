// Reads the frame number that tests/make-fixtures.sh encodes in 16 black or white
// cells, least significant bit first. Blank output reads as frame 0, so checks
// shouldn't rely on frame 0 alone.

const CELLS = 16;
const SPREAD = 1;
const WHITE_THRESHOLD = 128;

// `axis: 'height'` reads a rotated clip, whose first cell is at the bottom.
export function readBarcode({ data, width, height }, axis = 'width') {
    let value = 0;
    for (let bit = 0; bit < CELLS; bit++) {
        let sum = 0;
        let count = 0;
        for (let offset = -SPREAD; offset <= SPREAD; offset++) {
            const x = axis === 'height' ? Math.floor(width / 2) + offset : Math.floor((bit + 0.5) * width / CELLS);
            const y = axis === 'height' ? height - 1 - Math.floor((bit + 0.5) * height / CELLS) : Math.floor(height / 2) + offset;
            sum += data[4 * (y * width + x)];
            count++;
        }
        if (sum / count > WHITE_THRESHOLD) value |= 1 << bit;
    }
    return value;
}
