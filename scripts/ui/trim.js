// The trim control: two native range inputs sharing a track, since mobile screen readers
// can operate those with their adjust gestures and can't operate custom sliders, plus
// text fields for precise times.
import { formatTime, parseTime, spokenTime } from '../app/format.js';

const STEPS = 2000;
const KEY_STEP = 0.1;
const LARGE_KEY_STEP = 1;
const KEY_DIRECTIONS = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };

export function createTrim({ track, startRange, endRange, startText, endText, length, onChange }) {
    let duration = 1;
    let start = 0;
    let end = 1;

    function render() {
        startRange.value = start;
        endRange.value = end;
        startRange.setAttribute('aria-valuetext', spokenTime(start));
        endRange.setAttribute('aria-valuetext', spokenTime(end));
        if (document.activeElement !== startText) startText.value = formatTime(start);
        if (document.activeElement !== endText) endText.value = formatTime(end);
        length.textContent = `${formatTime(end - start)} selected`;
        track.style.setProperty('--trim-start', start / duration);
        track.style.setProperty('--trim-end', end / duration);
    }

    // Whichever handle was touched last sits on top, so both stay reachable when they
    // meet at either end of the track.
    function raise(range) {
        startRange.classList.toggle('is-raised', range === startRange);
        endRange.classList.toggle('is-raised', range === endRange);
    }

    function bindRange(range, moved) {
        range.addEventListener('input', () => {
            const value = Number(range.value);
            onChange(moved === 'start' ? value : start, moved === 'end' ? value : end, moved);
        });
        // The range's own step is fine for dragging but far too small for a key press.
        range.addEventListener('keydown', (event) => {
            const direction = KEY_DIRECTIONS[event.key];
            if (!direction) return;
            event.preventDefault();
            const value = Number(range.value) + direction * (event.shiftKey ? LARGE_KEY_STEP : KEY_STEP);
            onChange(moved === 'start' ? value : start, moved === 'end' ? value : end, moved);
        });
        range.addEventListener('pointerdown', () => raise(range));
        range.addEventListener('focus', () => raise(range));
    }

    function bindText(text, moved) {
        function apply() {
            const parsed = parseTime(text.value);
            if (parsed === null) {
                text.setAttribute('aria-invalid', 'true');
                return;
            }
            text.removeAttribute('aria-invalid');
            onChange(moved === 'start' ? parsed : start, moved === 'end' ? parsed : end, moved);
        }
        text.addEventListener('change', apply);
        text.addEventListener('blur', () => {
            text.removeAttribute('aria-invalid');
            text.value = formatTime(moved === 'start' ? start : end);
        });
        text.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                apply();
            }
        });
    }

    bindRange(startRange, 'start');
    bindRange(endRange, 'end');
    bindText(startText, 'start');
    bindText(endText, 'end');

    return {
        setDuration(newDuration) {
            duration = newDuration;
            const step = newDuration / STEPS;
            for (const range of [startRange, endRange]) {
                range.max = newDuration;
                range.step = step;
            }
        },
        setRange(newStart, newEnd) {
            start = newStart;
            end = newEnd;
            render();
        },
    };
}
