// Reads the frame showing in a <video> as RGBA pixels at the output size. Its
// canvases are opaque unless asked for `alpha`, so an opaque video's reads stay as
// they were measured below.

// Despite reading every frame back, willReadFrequently stays off unless a read is refused
// (see read): forcing a software canvas made each read of HDR video take about 50ms
// instead of 1ms in Chrome, and 48ms instead of 5ms in Safari, with no visible change in
// color. Saying false outright also stops Chrome switching to software on its own after a
// few reads.
const CONTEXT_OPTIONS = { colorSpace: 'srgb', willReadFrequently: false };
const MAX_DIRECT_REDUCTION = 2;

function makeContext(width, height, alpha, willReadFrequently = false) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { ...CONTEXT_OPTIONS, alpha, willReadFrequently });
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
    #alpha;
    #software = false;

    // `crop` is in the video's display pixels, as videoWidth and videoHeight
    // report them, so rotation and non-square pixels are already applied.
    constructor({ crop, width, height, alpha = false }) {
        this.#crop = crop;
        this.#width = width;
        this.#height = height;
        this.#alpha = alpha;
        this.#output = makeContext(width, height, alpha);

        // Browsers differ in how far imageSmoothingQuality goes, so a large
        // reduction steps through twice the output size to match across them.
        if (crop.width / width > MAX_DIRECT_REDUCTION || crop.height / height > MAX_DIRECT_REDUCTION) {
            this.#intermediate = makeContext(width * 2, height * 2, alpha);
        }
    }

    read(video) {
        this.#draw(video);
        try {
            return this.#output.getImageData(0, 0, this.#width, this.#height);
        } catch (error) {
            // Safari 27.2 on GitHub's macOS 26 runners refuses to read back any accelerated
            // canvas, even an untouched one, with an InvalidStateError, yet reads a software
            // one. So a refused read moves this reader to software for the rest of its frames,
            // the intermediate too, since drawing an accelerated canvas into a software one
            // there gives its first frame every time.
            if (error?.name !== 'InvalidStateError' || this.#software) throw error;
            this.#software = true;
            this.#output = makeContext(this.#width, this.#height, this.#alpha, true);
            if (this.#intermediate) {
                const { width, height } = this.#intermediate.canvas;
                this.#intermediate = makeContext(width, height, this.#alpha, true);
            }
            this.#draw(video);
            return this.#output.getImageData(0, 0, this.#width, this.#height);
        }
    }

    #draw(video) {
        const { x, y, width, height } = this.#crop;
        if (this.#intermediate) {
            const { canvas } = this.#intermediate;
            this.#clear(this.#intermediate);
            this.#intermediate.drawImage(video, x, y, width, height, 0, 0, canvas.width, canvas.height);
            this.#clear(this.#output);
            this.#output.drawImage(canvas, 0, 0, this.#width, this.#height);
        } else {
            this.#clear(this.#output);
            this.#output.drawImage(video, x, y, width, height, 0, 0, this.#width, this.#height);
        }
    }

    // Drawing blends over what's there, so where a frame is transparent the one
    // before would show through.
    #clear(context) {
        if (this.#alpha) context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    }
}
