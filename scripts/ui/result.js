// Shows the finished GIF, and owns its object URL. A GIF can't be paused, so pausing
// swaps it for a still of its first frame, and playing restarts it from a fresh URL.
// With reduced motion it starts paused.
import { formatBytes, formatTime, gifFileName } from '../app/format.js';

export function createResult({ els, prefersReducedMotion }) {
    let blob = null;
    let url = null;
    let playing = false;

    function revoke() {
        if (url) URL.revokeObjectURL(url);
        url = null;
    }

    function renderToggle() {
        els.toggle.setAttribute('aria-label', playing ? 'Pause GIF' : 'Play GIF');
        els.toggle.classList.toggle('is-playing', playing);
        els.image.hidden = !playing;
        els.poster.hidden = playing;
    }

    function drawPoster(bitmapSource, width, height) {
        els.poster.width = width;
        els.poster.height = height;
        els.poster.getContext('2d').drawImage(bitmapSource, 0, 0, width, height);
    }

    function play() {
        playing = true;
        // The download link keeps its own URL, so this only restarts the picture.
        const previous = els.image.src;
        els.image.src = URL.createObjectURL(blob);
        if (previous.startsWith('blob:') && previous !== url) URL.revokeObjectURL(previous);
        renderToggle();
    }

    function pause() {
        playing = false;
        renderToggle();
    }

    els.toggle.addEventListener('click', () => {
        if (playing) pause();
        else play();
    });

    return {
        // `output` is what convert() returned. Resolves once the picture is decoded, so
        // the screen changes with the GIF already showing.
        async show(output, { sourceName, seconds }) {
            revoke();
            blob = output.blob;
            url = URL.createObjectURL(blob);
            els.download.href = url;
            els.download.download = gifFileName(sourceName);
            els.size.textContent = formatBytes(output.bytes);
            els.dimensions.textContent = `${output.width} × ${output.height}`;
            els.frames.textContent = String(output.frames);
            els.length.textContent = formatTime(seconds);
            els.image.width = output.width;
            els.image.height = output.height;

            const stillUrl = URL.createObjectURL(blob);
            const still = new Image();
            still.src = stillUrl;
            try {
                await still.decode();
                drawPoster(still, output.width, output.height);
            } catch {
                // The still is only for pausing, so the GIF can show without one.
            } finally {
                URL.revokeObjectURL(stillUrl);
            }

            if (prefersReducedMotion()) pause();
            else play();
        },

        clear() {
            revoke();
            blob = null;
            playing = false;
            const previous = els.image.src;
            els.image.removeAttribute('src');
            if (previous.startsWith('blob:')) URL.revokeObjectURL(previous);
        },
    };
}
