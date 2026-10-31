// Getting a file in, by the picker or by dropping anywhere on the page. While dragging,
// a full-page overlay is the only drop target, with nothing inside it able to receive
// events, so entering and leaving it are the only events to track, without the counting
// that drifts when moving between child elements.
import { checkFiles } from '../app/file-check.js';

function describeDropped(dataTransfer) {
    const files = [...dataTransfer.files];
    const items = [...(dataTransfer.items ?? [])].filter((item) => item.kind === 'file');
    return files.map((file, i) => {
        const entry = items[i]?.webkitGetAsEntry?.();
        return { name: file.name, type: file.type, size: file.size, isDirectory: Boolean(entry?.isDirectory), original: file };
    });
}

function carriesFiles(event) {
    return [...(event.dataTransfer?.types ?? [])].includes('Files');
}

// `canAccept` says whether a file can start now, and `onFile` and `onRejected` get the
// outcome.
export function createDropzone({ button, input, overlay, canAccept, onFile, onRejected }) {
    function accept(described) {
        const { file, error } = checkFiles(described);
        if (error) onRejected(error);
        else onFile(file.original);
    }

    button.addEventListener('click', () => input.click());

    input.addEventListener('change', () => {
        const [file] = input.files;
        // Cleared so choosing the same file again still counts as a change.
        const described = file ? [{ name: file.name, type: file.type, size: file.size, isDirectory: false, original: file }] : [];
        input.value = '';
        if (described.length > 0) accept(described);
    });

    function hideOverlay() {
        overlay.hidden = true;
    }

    window.addEventListener('dragenter', (event) => {
        if (carriesFiles(event)) overlay.hidden = false;
    });

    overlay.addEventListener('dragleave', (event) => {
        if (event.target === overlay) hideOverlay();
    });

    // Without these, the browser would navigate away to the dropped file.
    window.addEventListener('dragover', (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('drop', (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        hideOverlay();
        if (!canAccept()) {
            onRejected('Finish or cancel this GIF before starting another.');
            return;
        }
        accept(describeDropped(event.dataTransfer));
    });

    // A drag that ends outside the window never reaches the overlay.
    window.addEventListener('dragend', hideOverlay);

    return {
        openPicker() {
            input.click();
        },
    };
}
