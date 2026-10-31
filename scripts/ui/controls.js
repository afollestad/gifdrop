// The output settings, the size estimate, and any warnings. Changes go out through
// `onChange` as soon as they happen, so nothing here waits on the work they cause.
import { formatByteRange, formatBytes } from '../app/format.js';
import { FPS_OPTIONS, SIZE_LIMITS, SPEED_OPTIONS } from '../app/limits.js';

const speedLabel = (speed) => (speed === 1 ? 'Normal' : `${speed}×`);

function fillSelect(select, values, label) {
    select.replaceChildren(...values.map((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label(value);
        return option;
    }));
}

export function createControls({ els, onChange, onConvert }) {
    fillSelect(els.fps, FPS_OPTIONS, (fps) => `${fps} FPS`);
    fillSelect(els.speed, SPEED_OPTIONS, speedLabel);

    els.size.addEventListener('input', () => onChange({ width: Number(els.size.value) }));
    els.fps.addEventListener('change', () => onChange({ fps: Number(els.fps.value) }));
    els.speed.addEventListener('change', () => onChange({ speed: Number(els.speed.value) }));
    els.quality.addEventListener('change', (event) => onChange({ quality: event.target.value }));
    els.loop.addEventListener('change', (event) => onChange({ loop: event.target.value }));
    els.convert.addEventListener('click', onConvert);

    return {
        // Shows the settings as they stand, including anything they caused to change,
        // such as the width after a smaller crop.
        render({ settings, size, maxWidth, errors, warnings }) {
            els.size.min = Math.min(SIZE_LIMITS.minWidth, maxWidth);
            els.size.max = maxWidth;
            els.size.value = settings.width;
            els.sizeOutput.textContent = `${size.width} × ${size.height}`;
            els.size.setAttribute('aria-valuetext', `${size.width} by ${size.height} pixels`);
            els.fps.value = settings.fps;
            els.speed.value = settings.speed;
            els.quality.querySelector(`input[value="${settings.quality}"]`).checked = true;
            els.loop.querySelector(`input[value="${settings.loop}"]`).checked = true;
            els.loopHint.hidden = settings.loop !== 'once';

            const messages = [...errors, ...warnings];
            els.noticePanel.hidden = messages.length === 0;
            els.noticeMessages.replaceChildren(...messages.map((message) => {
                const line = document.createElement('p');
                line.textContent = message;
                return line;
            }));
            els.convert.disabled = errors.length > 0;
        },

        // For when the video isn't ready to be converted yet.
        setConvertEnabled(enabled) {
            els.convert.disabled = !enabled;
        },

        showEstimating() {
            els.estimate.setAttribute('aria-busy', 'true');
            els.estimateValue.textContent = 'Estimating size…';
            els.estimateDetail.textContent = ' ';
        },

        // Returns what was shown, for announcing once settled.
        showEstimate({ low, high, exact }) {
            els.estimate.removeAttribute('aria-busy');
            const text = exact ? `About ${formatBytes(high)}` : `About ${formatByteRange(low, high)}`;
            els.estimateValue.textContent = text;
            els.estimateDetail.textContent = exact ? 'Exact size appears after converting' : 'Estimated from a sample';
            return `Estimated size ${text.toLowerCase()}`;
        },

        showNoEstimate() {
            els.estimate.removeAttribute('aria-busy');
            els.estimateValue.textContent = ' ';
            els.estimateDetail.textContent = ' ';
        },
    };
}
