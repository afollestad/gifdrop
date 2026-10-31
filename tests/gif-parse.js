// Reads a GIF's bytes independently of what wrote it: the frame count, raw delays,
// loop block and flags that ffprobe hides or rewrites, and the pixels. Written from
// the GIF89a format rather than sharing anything with the app's encoder.

const SIGNATURE = 'GIF89a';
const EXTENSION = 0x21;
const IMAGE = 0x2c;
const TRAILER = 0x3b;
const GRAPHIC_CONTROL = 0xf9;
const APPLICATION = 0xff;
const MAX_CODE_SIZE = 12;

function readSubBlocks(bytes, start) {
    const parts = [];
    let at = start;
    for (;;) {
        const size = bytes[at++];
        if (size === undefined) throw new Error('Ran out of data inside a sub-block');
        if (size === 0) break;
        parts.push(bytes.subarray(at, at + size));
        at += size;
    }
    const data = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let written = 0;
    for (const part of parts) {
        data.set(part, written);
        written += part.length;
    }
    return { data, next: at };
}

function decodeLzw(data, minCodeSize, pixelCount) {
    const clear = 1 << minCodeSize;
    const end = clear + 1;
    const prefixes = new Int32Array(1 << MAX_CODE_SIZE);
    const suffixes = new Uint8Array(1 << MAX_CODE_SIZE);
    const stack = new Uint8Array((1 << MAX_CODE_SIZE) + 1);
    const output = new Uint8Array(pixelCount);

    let codeSize = minCodeSize + 1;
    let available = end + 1;
    let previous = -1;
    let first = 0;
    let written = 0;
    let bitBuffer = 0;
    let bitCount = 0;

    for (let at = 0; at < data.length;) {
        while (bitCount < codeSize && at < data.length) {
            bitBuffer |= data[at++] << bitCount;
            bitCount += 8;
        }
        if (bitCount < codeSize) break;
        const code = bitBuffer & ((1 << codeSize) - 1);
        bitBuffer >>>= codeSize;
        bitCount -= codeSize;

        if (code === end) break;
        if (code === clear) {
            codeSize = minCodeSize + 1;
            available = end + 1;
            previous = -1;
            continue;
        }
        if (previous === -1) {
            if (code >= clear) throw new Error(`Bad first code ${code}`);
            output[written++] = code;
            previous = code;
            first = code;
            continue;
        }
        if (code > available) throw new Error(`Code ${code} is past the table's ${available}`);

        let current = code;
        let depth = 0;
        if (current === available) {
            stack[depth++] = first;
            current = previous;
        }
        while (current >= clear) {
            stack[depth++] = suffixes[current];
            current = prefixes[current];
        }
        first = current;
        stack[depth++] = first;
        if (available < 1 << MAX_CODE_SIZE) {
            prefixes[available] = previous;
            suffixes[available] = first;
            available++;
            if (available === 1 << codeSize && codeSize < MAX_CODE_SIZE) codeSize++;
        }
        while (depth > 0 && written < pixelCount) output[written++] = stack[--depth];
        previous = code;
    }
    if (written !== pixelCount) throw new Error(`Decoded ${written} pixels of ${pixelCount}`);
    return output;
}

function readColorTable(bytes, at, size) {
    const table = [];
    for (let i = 0; i < size; i++) table.push([bytes[at + i * 3], bytes[at + i * 3 + 1], bytes[at + i * 3 + 2]]);
    return table;
}

// `frames` hold each frame's `delay` in hundredths of a second, `disposal`,
// `transparentIndex` (null when it has none), position and palette `indices`. `loop`
// is null with no NETSCAPE block, and otherwise its repeat count, where 0 is forever.
export function parseGif(bytes) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (signature !== SIGNATURE) throw new Error(`Not a GIF89a: ${signature}`);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint16(6, true);
    const height = view.getUint16(8, true);
    const fields = bytes[10];
    let at = 13;
    let globalPalette = null;
    if (fields & 0x80) {
        const size = 1 << ((fields & 7) + 1);
        globalPalette = readColorTable(bytes, at, size);
        at += size * 3;
    }

    const frames = [];
    let loop = null;
    let control = null;
    let sawTrailer = false;

    while (at < bytes.length) {
        const marker = bytes[at++];
        if (marker === TRAILER) {
            sawTrailer = true;
            break;
        }
        if (marker === EXTENSION) {
            const label = bytes[at++];
            if (label === GRAPHIC_CONTROL) {
                const packed = bytes[at + 1];
                control = {
                    disposal: (packed >> 2) & 7,
                    delay: view.getUint16(at + 2, true),
                    transparentIndex: packed & 1 ? bytes[at + 4] : null,
                };
                at += bytes[at] + 2;
            } else if (label === APPLICATION) {
                const appSize = bytes[at];
                const appName = String.fromCharCode(...bytes.subarray(at + 1, at + 1 + appSize));
                const { data, next } = readSubBlocks(bytes, at + 1 + appSize);
                if (appName === 'NETSCAPE2.0') loop = data[1] | (data[2] << 8);
                at = next;
            } else {
                at = readSubBlocks(bytes, at).next;
            }
        } else if (marker === IMAGE) {
            const x = view.getUint16(at, true);
            const y = view.getUint16(at + 2, true);
            const frameWidth = view.getUint16(at + 4, true);
            const frameHeight = view.getUint16(at + 6, true);
            const packed = bytes[at + 8];
            at += 9;
            let localPalette = null;
            if (packed & 0x80) {
                const size = 1 << ((packed & 7) + 1);
                localPalette = readColorTable(bytes, at, size);
                at += size * 3;
            }
            const minCodeSize = bytes[at++];
            const { data, next } = readSubBlocks(bytes, at);
            at = next;
            frames.push({
                x,
                y,
                width: frameWidth,
                height: frameHeight,
                localPalette,
                minCodeSize,
                delay: control?.delay ?? 0,
                disposal: control?.disposal ?? 0,
                transparentIndex: control?.transparentIndex ?? null,
                indices: decodeLzw(data, minCodeSize, frameWidth * frameHeight),
            });
            control = null;
        } else {
            throw new Error(`Unknown block ${marker} at byte ${at - 1}`);
        }
    }
    if (!sawTrailer) throw new Error('The GIF has no trailer');
    return { width, height, palette: globalPalette, loop, frames };
}

// The picture after each frame, assuming each one keeps what's under it, which the
// writer's tests assert. Returns one index buffer per frame.
export function compositeFrames({ width, height, frames }) {
    const shown = new Uint8Array(width * height);
    return frames.map(({ indices, transparentIndex }) => {
        for (let p = 0; p < indices.length; p++) {
            if (indices[p] !== transparentIndex) shown[p] = indices[p];
        }
        return shown.slice();
    });
}
