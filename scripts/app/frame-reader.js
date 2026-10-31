// Reads the frame showing in a <video> as RGBA pixels at the output size.

// Despite reading every frame back, willReadFrequently stays off: forcing a software
// canvas made each read of HDR video take about 50ms instead of 1ms in Chrome, and 48ms
// instead of 5ms in Safari, with no visible change in color. Saying false outright also
// stops Chrome switching to software on its own after a few reads.
const CONTEXT_OPTIONS = { colorSpace: 'srgb', willReadFrequently: false, alpha: false };
const MAX_DIRECT_REDUCTION = 2;

function makeContext(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', CONTEXT_OPTIONS);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    return context;
}

export class FrameReader {
    #crop;
    #width;
    #height;
    #output;
    #intermediate = null;

    // `crop` is in the video's display pixels, as videoWidth and videoHeight
    // report them, so rotation and non-square pixels are already applied.
    constructor({ crop, width, height }) {
        this.#crop = crop;
        this.#width = width;
        this.#height = height;
        this.#output = makeContext(width, height);

        // Browsers differ in how far imageSmoothingQuality goes, so a large
        // reduction steps through twice the output size to match across them.
        if (crop.width / width > MAX_DIRECT_REDUCTION || crop.height / height > MAX_DIRECT_REDUCTION) {
            this.#intermediate = makeContext(width * 2, height * 2);
        }
    }

    read(video) {
        const { x, y, width, height } = this.#crop;
        if (this.#intermediate) {
            const { canvas } = this.#intermediate;
            this.#intermediate.drawImage(video, x, y, width, height, 0, 0, canvas.width, canvas.height);
            this.#output.drawImage(canvas, 0, 0, this.#width, this.#height);
        } else {
            this.#output.drawImage(video, x, y, width, height, 0, 0, this.#width, this.#height);
        }
        return this.#output.getImageData(0, 0, this.#width, this.#height);
    }
}
