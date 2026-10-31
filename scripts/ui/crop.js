// The crop control: aspect choices, number fields, and a box on the preview that can
// be dragged, resized by its handles, or moved and resized from the keyboard. Dragging
// only writes to the box's own custom properties, once per frame.
import { moveCrop, resizeCrop } from '../app/crop-math.js';

const KEY_STEPS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const SHIFT_MULTIPLIER = 10;
const ANNOUNCE_DELAY_MS = 500;

export function createCrop({ layer, box, fields, fieldset, announcer, aspectGroup, onCrop, onAspect }) {
    let videoWidth = 1;
    let videoHeight = 1;
    let crop = { x: 0, y: 0, width: 1, height: 1 };
    let aspect = null;
    let drag = null;
    let pendingFrame = 0;
    let announceTimer = 0;

    function paint() {
        box.style.setProperty('--crop-x', crop.x / videoWidth);
        box.style.setProperty('--crop-y', crop.y / videoHeight);
        box.style.setProperty('--crop-w', crop.width / videoWidth);
        box.style.setProperty('--crop-h', crop.height / videoHeight);
    }

    function fillFields() {
        for (const key of ['x', 'y', 'width', 'height']) fields[key].value = crop[key];
        fields.x.max = videoWidth - crop.width;
        fields.y.max = videoHeight - crop.height;
        fields.width.max = videoWidth;
        fields.height.max = videoHeight;
    }

    function announce() {
        clearTimeout(announceTimer);
        announceTimer = setTimeout(() => {
            announcer.textContent = `Crop ${crop.width} by ${crop.height} at ${crop.x}, ${crop.y}`;
        }, ANNOUNCE_DELAY_MS);
    }

    function apply(next, { commit = true } = {}) {
        crop = next;
        paint();
        fillFields();
        if (commit) onCrop(crop);
    }

    function scheduleDragPaint() {
        if (pendingFrame) return;
        pendingFrame = requestAnimationFrame(() => {
            pendingFrame = 0;
            if (drag) paint();
        });
    }

    function onPointerDown(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        const rect = layer.getBoundingClientRect();
        drag = {
            pointerId: event.pointerId,
            handle: event.target.dataset.handle ?? null,
            startX: event.clientX,
            startY: event.clientY,
            original: crop,
            scaleX: videoWidth / rect.width,
            scaleY: videoHeight / rect.height,
        };
        box.setPointerCapture(event.pointerId);
        box.focus({ preventScroll: true });
        box.classList.add('is-dragging');
    }

    function onPointerMove(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const dx = (event.clientX - drag.startX) * drag.scaleX;
        const dy = (event.clientY - drag.startY) * drag.scaleY;
        crop = drag.handle
            ? resizeCrop(drag.original, drag.handle, dx, dy, videoWidth, videoHeight, aspect)
            : moveCrop(drag.original, dx, dy, videoWidth, videoHeight);
        scheduleDragPaint();
    }

    function endDrag(commit) {
        if (!drag) return;
        const { original, pointerId } = drag;
        drag = null;
        box.classList.remove('is-dragging');
        if (box.hasPointerCapture(pointerId)) box.releasePointerCapture(pointerId);
        apply(commit ? crop : original, { commit });
        announce();
    }

    box.addEventListener('pointerdown', onPointerDown);
    box.addEventListener('pointermove', onPointerMove, { passive: true });
    // Only the pointer doing the dragging can end it, not a second finger.
    box.addEventListener('pointerup', (event) => {
        if (event.pointerId === drag?.pointerId) endDrag(true);
    });
    box.addEventListener('pointercancel', (event) => {
        if (event.pointerId === drag?.pointerId) endDrag(false);
    });

    box.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && drag) {
            event.preventDefault();
            endDrag(false);
            return;
        }
        const step = KEY_STEPS[event.key];
        if (!step) return;
        event.preventDefault();
        const amount = event.shiftKey ? SHIFT_MULTIPLIER : 1;
        const dx = step[0] * amount;
        const dy = step[1] * amount;
        const next = event.altKey
            ? resizeCrop(crop, 'se', dx, dy, videoWidth, videoHeight, aspect)
            : moveCrop(crop, dx, dy, videoWidth, videoHeight);
        apply(next);
        announce();
    });

    for (const key of ['x', 'y', 'width', 'height']) {
        fields[key].addEventListener('change', () => {
            const value = Number(fields[key].value);
            if (!Number.isFinite(value) || fields[key].value === '') {
                fillFields();
                return;
            }
            onCrop({ ...crop, [key]: value });
        });
    }

    aspectGroup.addEventListener('change', (event) => {
        if (event.target.name === 'aspect') onAspect(event.target.value);
    });

    return {
        setVideoSize(width, height) {
            videoWidth = width;
            videoHeight = height;
        },
        // `aspectValue` is 'original', 'free' or a ratio string. `aspectRatio` is that
        // ratio as a number, or null when free.
        update(newCrop, aspectValue, aspectRatio) {
            aspect = aspectRatio;
            const editing = aspectValue !== 'original';
            layer.hidden = !editing;
            fieldset.hidden = !editing;
            const radio = aspectGroup.querySelector(`input[value="${aspectValue}"]`);
            if (radio) radio.checked = true;
            apply(newCrop, { commit: false });
        },
    };
}
