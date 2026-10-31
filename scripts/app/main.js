// Starts the page: the screen state and the ways in. The editor loads separately, when
// the browser is idle or the moment a file arrives, whichever comes first.
import { createDropzone } from '../ui/dropzone.js';
import { createStatus } from '../ui/status.js';
import { INITIAL_STATE, reduce } from './state.js';

const byId = (id) => document.getElementById(id);

const els = {
    stage: byId('stage'),
    stageFrame: byId('stage-frame'),
    stageLoading: byId('stage-loading'),
    playToggle: byId('play-toggle'),
    unblockPanel: byId('unblock-panel'),
    trimTrack: byId('trim-track'),
    trimSelection: byId('trim-selection'),
    trimStart: byId('trim-start'),
    trimEnd: byId('trim-end'),
    trimStartText: byId('trim-start-text'),
    trimEndText: byId('trim-end-text'),
    trimLength: byId('trim-length'),
    cropLayer: byId('crop-layer'),
    cropBox: byId('crop-box'),
    cropFieldset: byId('crop-fields'),
    cropAnnouncer: byId('crop-announcer'),
    aspectOptions: byId('aspect-options'),
    cropFields: { x: byId('crop-x'), y: byId('crop-y'), width: byId('crop-width'), height: byId('crop-height') },
    progressBar: byId('progress-bar'),
    progressDetail: byId('progress-detail'),
    controls: {
        size: byId('size-range'),
        sizeOutput: byId('size-output'),
        fps: byId('fps-select'),
        speed: byId('speed-select'),
        quality: byId('quality-options'),
        loop: byId('loop-options'),
        loopHint: byId('loop-hint'),
        noticePanel: byId('notice-panel'),
        noticeMessages: byId('notice-messages'),
        convert: byId('convert-button'),
        estimate: byId('estimate'),
        estimateValue: byId('estimate-value'),
        estimateDetail: byId('estimate-detail'),
    },
    result: {
        image: byId('result-image'),
        poster: byId('result-poster'),
        toggle: byId('result-toggle'),
        download: byId('download-link'),
        size: byId('result-size'),
        dimensions: byId('result-dimensions'),
        frames: byId('result-frames'),
        length: byId('result-length'),
    },
};

const status = createStatus(byId('status-region'));
const errorPanel = byId('error-panel');
const errorMessage = byId('error-message');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let state = INITIAL_STATE;
let editorPromise = null;
let loadedEditor = null;

// Where focus goes on arriving at a screen, so keyboard and screen reader users land
// where the new content is.
const FOCUS_TARGETS = {
    editing: 'editor-heading',
    converting: 'cancel-button',
    done: 'result-heading',
    error: 'error-panel',
};

function showError(message) {
    errorMessage.textContent = message;
    errorPanel.hidden = false;
}

function hideError() {
    errorPanel.hidden = true;
    errorMessage.textContent = '';
}

function focusFor(screen, previous) {
    // A cancel returns focus to what started the conversion.
    const id = screen === 'editing' && previous === 'converting' ? 'convert-button' : FOCUS_TARGETS[screen];
    if (!id) return;
    const target = byId(id);
    if (target.disabled) byId('editor-heading').focus({ preventScroll: true });
    else target.focus({ preventScroll: screen === 'editing' });
}

function render(previous) {
    const { screen, errorReturnsTo } = state;
    const view = screen === 'error' ? errorReturnsTo : screen;
    document.body.dataset.screen = screen;
    document.body.dataset.view = view;

    const inWorkspace = view !== 'empty';
    byId('picker').hidden = inWorkspace;
    byId('workspace').hidden = !inWorkspace;
    byId('controls').hidden = view !== 'editing' && view !== 'loading';
    byId('progress-panel').hidden = view !== 'converting';
    byId('result-panel').hidden = view !== 'done';
    byId('result-figure').hidden = view !== 'done';
    byId('trim-section').hidden = view === 'done';
    byId('stage-frame').hidden = view === 'done';
    // Nothing to edit until a video has finished opening.
    // or, during a conversion, that would change anything but the screen.
    for (const section of document.querySelectorAll('[data-needs-video]')) section.inert = view === 'loading' || view === 'converting';

    if (screen !== previous) focusFor(screen, previous);
}

// Events only the page cares about are handled here, and everything else is a state
// change that may need showing.
function dispatch(event, detail = {}) {
    if (event === 'needsTap') {
        status.say('Your browser needs a tap before it can open this video.');
        byId('unblock-button').focus();
        return;
    }
    const previous = state.screen;
    state = reduce(state, event);
    if (state.screen === previous && event !== 'fileChosen') return;
    if (detail.message) showError(detail.message);
    else if (event !== 'loadFailed' && event !== 'convertFailed') hideError();
    render(previous);
}

function editor() {
    editorPromise ??= import('./editor.js').then(({ createEditor }) => createEditor({
        els,
        dispatch,
        status,
        prefersReducedMotion: () => reducedMotion.matches,
    })).then((created) => {
        loadedEditor = created;
        return created;
    }, (error) => {
        // Cleared so the next attempt tries again, rather than a brief network failure
        // leaving the page broken until it's reloaded.
        editorPromise = null;
        throw error;
    });
    return editorPromise;
}

async function openFile(file) {
    dispatch('fileChosen');
    // Shown here, since the editor may still be on its way on a slow connection.
    byId('stage-loading').hidden = false;
    status.say(`Opening ${file.name}`);
    try {
        (await editor()).open(file);
    } catch (error) {
        console.error('Could not load the editor', error);
        dispatch('loadFailed', { message: 'Something went wrong starting up. Please reload the page and try again.' });
    }
}

function rejectFile(message) {
    showError(message);
    status.say(message);
}

const dropzone = createDropzone({
    button: byId('choose-file'),
    input: byId('file-input'),
    overlay: byId('drop-overlay'),
    canAccept: () => state.screen !== 'converting',
    onFile: openFile,
    onRejected: rejectFile,
});

byId('replace-button').addEventListener('click', () => dropzone.openPicker());
byId('result-replace-button').addEventListener('click', () => dropzone.openPicker());
byId('cancel-button').addEventListener('click', async () => (await editor()).cancel());
byId('adjust-button').addEventListener('click', async () => (await editor()).adjust());
// Has to reach play() within this tap, which waiting on a promise would lose. The button
// only shows once the editor is running, so it's always there to call directly.
byId('unblock-button').addEventListener('click', () => loadedEditor.unblock());

byId('error-dismiss').addEventListener('click', async () => {
    const previous = state.screen;
    hideError();
    if (previous !== 'error') {
        // The button is gone, so focus needs somewhere to go.
        byId(state.screen === 'empty' ? 'choose-file' : 'editor-heading').focus();
        return;
    }
    const returning = state.errorReturnsTo;
    state = reduce(state, 'dismiss');
    render(previous);
    if (returning === 'editing') (await editor()).resume();
    else byId('choose-file').focus();
});

window.addEventListener('beforeunload', (event) => {
    if (state.screen === 'converting') event.preventDefault();
});

// Ready before it's needed, without competing with the page's first load.
const loadEditorSoon = window.requestIdleCallback ?? ((task) => setTimeout(task, 1000));
loadEditorSoon(() => {
    // A failure here isn't worth reporting, since choosing a file tries again and says so.
    editor().catch(() => {});
});

render(null);
