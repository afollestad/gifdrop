// Drives the real page in a same-origin frame, the way someone would: picking and
// dropping files, using the controls and keyboard, and downloading the result. This
// avoids browser-specific automation, so it runs alike in every browser.

const reportName = new URLSearchParams(location.search).get('report') ?? 'ui';
const frame = document.getElementById('app');
const results = [];

function log(line) {
    document.getElementById('log').textContent += `${line}\n`;
}

async function post(name, ext, body) {
    await fetch(`/report?name=${encodeURIComponent(name)}&ext=${ext}`, { method: 'POST', body });
}

function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(condition, what, timeoutMs = 20000) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        if (condition()) return;
        await pause(25);
    }
    throw new Error(`Timed out waiting for ${what}`);
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function equal(actual, expected, what) {
    assert(actual === expected, `${what}: got ${actual}, expected ${expected}`);
}

async function openApp() {
    await new Promise((resolve) => {
        frame.onload = resolve;
        frame.src = '/index.html';
    });
    const { document: doc } = frame.contentWindow;
    await until(() => doc.body.dataset.view === 'empty', 'the page to start');
    return { win: frame.contentWindow, doc, byId: (id) => doc.getElementById(id) };
}

async function fixture(name, type = 'video/mp4') {
    const blob = await (await fetch(`/tests/fixtures/${name}`)).blob();
    return new File([blob], name, { type });
}

// Built in the frame's own realm, since browsers reject a DataTransfer from another.
function transferOf(win, files) {
    const transfer = new win.DataTransfer();
    for (const file of files) transfer.items.add(new win.File([file], file.name, { type: file.type }));
    return transfer;
}

function dragEvent(win, type, dataTransfer) {
    return new win.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
}

async function drop({ win, doc, byId }, files) {
    const dataTransfer = transferOf(win, files);
    const entered = dragEvent(win, 'dragenter', dataTransfer);
    win.dispatchEvent(entered);
    assert(entered.defaultPrevented, 'entering should claim the drag, or WebKit can navigate on a quick drop');
    assert(!byId('drop-overlay').hidden, 'the overlay should show during a drag');
    const dropped = dragEvent(win, 'drop', dataTransfer);
    byId('drop-overlay').dispatchEvent(dropped);
    assert(dropped.defaultPrevented, 'the drop should be handled, not left to navigate');
    assert(byId('drop-overlay').hidden, 'the overlay should hide after a drop');
    return doc;
}

function pick({ win, byId }, file) {
    const input = byId('file-input');
    input.files = transferOf(win, [file]).files;
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
}

function waitForEditing({ doc }) {
    return until(() => doc.body.dataset.screen === 'editing', 'the editor');
}

function waitForEstimate({ byId }) {
    return until(() => /^About/.test(byId('estimate-value').textContent), 'an estimate');
}

function setRange({ win }, input, value) {
    input.value = value;
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
}

// Dispatched by hand, since calling blur() fires nothing in a frame without focus.
function leave({ win }, input) {
    input.blur();
    input.dispatchEvent(new win.FocusEvent('blur'));
}

function setField(app, input, value) {
    input.focus();
    input.value = value;
    input.dispatchEvent(new app.win.Event('change', { bubbles: true }));
    leave(app, input);
}

function choose({ win, doc }, name, value) {
    const radio = doc.querySelector(`input[name="${name}"][value="${value}"]`);
    radio.checked = true;
    radio.dispatchEvent(new win.Event('change', { bubbles: true }));
}

function press({ win }, target, key, options = {}) {
    target.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
}

async function downloadBytes({ byId }) {
    const response = await fetch(byId('download-link').href);
    return response.blob();
}

const TESTS = {
    async 'starts on the picker, with the editor out of the way'(app) {
        assert(!app.byId('picker').hidden, 'picker visible');
        assert(app.byId('workspace').hidden, 'workspace hidden');
        equal(app.byId('choose-file').tagName, 'BUTTON', 'the dropzone is a button');
    },

    async 'picking a file opens it and offers the defaults'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        assert(app.byId('picker').hidden, 'picker hidden');
        assert(!app.byId('workspace').hidden, 'workspace visible');
        equal(app.byId('size-output').textContent, '480 × 270', 'default size');
        equal(app.byId('fps-select').value, '15', 'default FPS');
        equal(app.byId('trim-end-text').value, '0:04.0', 'trim of a clip shorter than the default');
        equal(app.doc.activeElement.id, 'editor-heading', 'focus moves to the editor');
        await waitForEstimate(app);
        assert(!app.byId('convert-button').disabled, 'can convert');
    },

    async 'dropping a file opens it'(app) {
        await drop(app, [await fixture('barcode.mp4')]);
        await waitForEditing(app);
    },

    async 'the same file can be picked twice'(app) {
        const file = await fixture('barcode.mp4');
        pick(app, file);
        await waitForEditing(app);
        equal(app.byId('file-input').value, '', 'the input resets');
        pick(app, file);
        await until(() => app.doc.body.dataset.screen === 'editing' && !app.byId('convert-button').disabled, 'the editor again');
    },

    async 'a portrait video gets a sensible default size'(app) {
        pick(app, await fixture('barcode-rotated.mp4'));
        await waitForEditing(app);
        equal(app.byId('size-output').textContent, '270 × 480', 'portrait default');
    },

    async 'rejects several files, wrong types and empty files, and says why'(app) {
        await drop(app, [await fixture('barcode.mp4'), await fixture('barcode.webm', 'video/webm')]);
        assert(!app.byId('error-panel').hidden, 'shows the error');
        assert(/one video at a time/.test(app.byId('error-message').textContent), 'names the problem');
        equal(app.doc.body.dataset.screen, 'empty', 'stays on the picker');
        assert(/one video/.test(app.byId('status-region').textContent), 'announces it');

        await drop(app, [new File(['text'], 'notes.txt', { type: 'text/plain' })]);
        assert(/notes\.txt isn't a video/.test(app.byId('error-message').textContent), 'rejects a text file');

        await drop(app, [new File([], 'empty.mp4', { type: 'video/mp4' })]);
        assert(/empty\.mp4 is empty/.test(app.byId('error-message').textContent), 'rejects an empty file');

        app.byId('error-dismiss').click();
        await until(() => app.byId('error-panel').hidden, 'the error to clear');
    },

    async 'a non-file drag is left alone'(app) {
        const dataTransfer = new app.win.DataTransfer();
        dataTransfer.setData('text/plain', 'hello');
        const entered = dragEvent(app.win, 'dragenter', dataTransfer);
        app.win.dispatchEvent(entered);
        assert(!entered.defaultPrevented, 'not claimed on entering');
        assert(app.byId('drop-overlay').hidden, 'no overlay for text');
        const over = dragEvent(app.win, 'dragover', dataTransfer);
        app.win.dispatchEvent(over);
        assert(!over.defaultPrevented, 'not claimed');
    },

    async 'leaving the page during a drag hides the overlay'(app) {
        const dataTransfer = transferOf(app.win, [new File(['x'], 'a.mp4', { type: 'video/mp4' })]);
        app.win.dispatchEvent(dragEvent(app.win, 'dragenter', dataTransfer));
        assert(!app.byId('drop-overlay').hidden, 'shows');
        app.byId('drop-overlay').dispatchEvent(dragEvent(app.win, 'dragleave', dataTransfer));
        assert(app.byId('drop-overlay').hidden, 'hides');
    },

    async 'a file with no video track fails clearly and can be dismissed'(app) {
        pick(app, await fixture('audio-only.m4a', 'video/mp4'));
        await until(() => app.doc.body.dataset.screen === 'error', 'the error');
        assert(/no video/.test(app.byId('error-message').textContent), 'says why');
        equal(app.doc.activeElement.id, 'error-panel', 'focus moves to the error');
        assert(!app.byId('picker').hidden, 'can pick again');
        app.byId('error-dismiss').click();
        await until(() => app.doc.body.dataset.screen === 'empty', 'the picker');
        equal(app.doc.activeElement.id, 'choose-file', 'focus returns to the picker');
    },

    async 'a file the browser cannot read fails clearly'(app) {
        pick(app, await fixture('truncated.mp4'));
        await until(() => app.doc.body.dataset.screen === 'error', 'the error');
        assert(/can't open/.test(app.byId('error-message').textContent), 'says why');
    },

    async 'trim handles stay apart and feed the text fields'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        const start = app.byId('trim-start');
        const end = app.byId('trim-end');
        setRange(app, start, 1);
        equal(app.byId('trim-start-text').value, '0:01.0', 'start text');
        assert(/1 second/.test(start.getAttribute('aria-valuetext')), 'spoken start');
        setRange(app, end, 0.5);
        assert(Number(start.value) < Number(end.value), `start ${start.value} stays before end ${end.value}`);
        equal(Number(end.value), 0.5, 'the dragged end wins');
    },

    async 'trim times can be typed, and bad ones are rejected'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        setField(app, app.byId('trim-start-text'), '0:01.5');
        equal(Number(app.byId('trim-start').value), 1.5, 'typed start');
        const before = app.byId('trim-end').value;
        const end = app.byId('trim-end-text');
        end.focus();
        end.value = 'nonsense';
        end.dispatchEvent(new app.win.Event('change', { bubbles: true }));
        equal(end.getAttribute('aria-invalid'), 'true', 'marked invalid');
        equal(app.byId('trim-end').value, before, 'unchanged');
        leave(app, end);
        equal(end.getAttribute('aria-invalid'), null, 'cleared on leaving');
        equal(end.value, '0:04.0', 'restored on leaving');
    },

    async 'choosing a shape shows the crop tools, which respond to the keyboard'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        assert(app.byId('crop-layer').hidden, 'no overlay until asked for');
        choose(app, 'aspect', '1');
        assert(!app.byId('crop-layer').hidden, 'overlay shows');
        equal(app.byId('crop-width').value, '360', 'square width');
        equal(app.byId('crop-x').value, '140', 'centered');
        equal(app.byId('size-output').textContent, '360 × 360', 'size follows the crop');

        const box = app.byId('crop-box');
        press(app, box, 'ArrowRight');
        equal(app.byId('crop-x').value, '141', 'arrow moves one');
        press(app, box, 'ArrowRight', { shiftKey: true });
        equal(app.byId('crop-x').value, '151', 'shift moves ten');
        press(app, box, 'ArrowLeft', { altKey: true });
        equal(app.byId('crop-width').value, app.byId('crop-height').value, 'alt resizes, keeping the shape');
        assert(Number(app.byId('crop-width').value) < 360, 'alt shrinks it');

        choose(app, 'aspect', 'original');
        assert(app.byId('crop-layer').hidden, 'overlay hides again');
        equal(app.byId('size-output').textContent, '480 × 270', 'back to the width asked for');
    },

    async 'trim arrow keys move a useful distance, and hold off during a conversion'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        const start = app.byId('trim-start');
        press(app, start, 'ArrowRight');
        equal(app.byId('trim-start-text').value, '0:00.1', 'a tenth of a second');
        press(app, start, 'ArrowRight', { shiftKey: true });
        equal(app.byId('trim-start-text').value, '0:01.1', 'shift moves a second');
        app.byId('convert-button').click();
        await until(() => app.doc.body.dataset.screen === 'converting', 'the conversion');
        assert(app.byId('trim-section').inert, 'trim is out of reach while converting');
        await until(() => app.doc.body.dataset.screen === 'done', 'the result', 60000);
        assert(!app.byId('trim-section').inert, 'trim is back afterward');
    },

    async 'the hero starts in its full size, before any script has run'(app) {
        const source = await (await fetch('/index.html')).text();
        assert(/<body[^>]*data-view="empty"/.test(source), 'the markup says so');
        assert(app.byId('overview').getBoundingClientRect().height > 200, 'it is full size');
    },

    async 'a crop can be dragged with a pointer'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        choose(app, 'aspect', 'free');
        const box = app.byId('crop-box');
        const handle = box.querySelector('[data-handle="se"]');
        const rect = app.byId('crop-layer').getBoundingClientRect();
        const fire = (target, type, x, y) => target.dispatchEvent(new app.win.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse' }));
        // Real pointer capture needs a real pointer, so a synthetic one is allowed to refuse.
        box.setPointerCapture = () => {};
        box.releasePointerCapture = () => {};
        box.hasPointerCapture = () => false;
        fire(handle, 'pointerdown', rect.right, rect.bottom);
        fire(box, 'pointermove', rect.right - rect.width / 2, rect.bottom - rect.height / 2);
        fire(box, 'pointerup', rect.right - rect.width / 2, rect.bottom - rect.height / 2);
        equal(app.byId('crop-width').value, '320', 'dragged to half the width');
        equal(app.byId('crop-height').value, '180', 'and half the height');
    },

    async 'an escape during a drag puts the crop back'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        choose(app, 'aspect', 'free');
        const box = app.byId('crop-box');
        const rect = app.byId('crop-layer').getBoundingClientRect();
        const fire = (type, x, y) => box.querySelector('[data-handle="e"]').dispatchEvent(new app.win.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse' }));
        box.setPointerCapture = () => {};
        box.releasePointerCapture = () => {};
        box.hasPointerCapture = () => false;
        fire('pointerdown', rect.right, rect.top + 10);
        box.dispatchEvent(new app.win.PointerEvent('pointermove', { bubbles: true, clientX: rect.left + 50, clientY: rect.top + 10, pointerId: 1 }));
        press(app, box, 'Escape');
        equal(app.byId('crop-width').value, '640', 'restored');
    },

    async 'typed crop numbers are fitted to the video'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        choose(app, 'aspect', 'free');
        setField(app, app.byId('crop-width'), '100');
        setField(app, app.byId('crop-x'), '9999');
        equal(app.byId('crop-x').value, '540', 'kept inside the frame');
        equal(app.byId('size-output').textContent, '100 × 360', 'size follows');
    },

    async 'settings over the limit say why and block converting'(app) {
        pick(app, await fixture('barcode-longgop.mp4'));
        await waitForEditing(app);
        setField(app, app.byId('trim-end-text'), '0:20');
        const fps = app.byId('fps-select');
        fps.value = '30';
        fps.dispatchEvent(new app.win.Event('change', { bubbles: true }));
        const speed = app.byId('speed-select');
        speed.value = '0.25';
        speed.dispatchEvent(new app.win.Event('change', { bubbles: true }));
        assert(/2400 frames/.test(app.byId('notice-messages').textContent), app.byId('notice-messages').textContent);
        assert(app.byId('convert-button').disabled, 'cannot convert');
        speed.value = '1';
        speed.dispatchEvent(new app.win.Event('change', { bubbles: true }));
        assert(!app.byId('convert-button').disabled, 'can convert again');
    },

    async 'converting shows progress, then the finished GIF to download'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        app.byId('convert-button').click();
        await until(() => app.doc.body.dataset.screen === 'converting', 'the conversion to start');
        equal(app.doc.activeElement.id, 'cancel-button', 'focus moves to cancel');
        assert(!app.byId('progress-panel').hidden, 'progress shows');
        await until(() => app.doc.body.dataset.screen === 'done', 'the result', 60000);
        equal(app.doc.activeElement.id, 'result-heading', 'focus moves to the result');
        assert(!app.byId('result-figure').hidden, 'GIF shows');
        assert(app.byId('stage-frame').hidden, 'stage steps aside');
        equal(app.byId('download-link').download, 'barcode.gif', 'download name');
        const blob = await downloadBytes(app);
        equal(blob.type, 'image/gif', 'download type');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        equal(String.fromCharCode(...bytes.subarray(0, 6)), 'GIF89a', 'a real GIF');
        assert(/KB/.test(app.byId('result-size').textContent), 'shows the size');
        equal(app.byId('result-frames').textContent, '60', 'shows the frames');
        equal(app.byId('result-dimensions').textContent, '480 × 270', 'shows the dimensions');
    },

    async 'the GIF can be paused and replayed'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        app.byId('convert-button').click();
        await until(() => app.doc.body.dataset.screen === 'done', 'the result', 60000);
        const toggle = app.byId('result-toggle');
        // Starts paused for anyone who has asked for reduced motion, as CI's macOS has.
        if (app.win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            equal(toggle.getAttribute('aria-label'), 'Play GIF', 'starts paused with reduced motion');
        } else {
            equal(toggle.getAttribute('aria-label'), 'Pause GIF', 'plays by default');
            toggle.click();
        }
        equal(toggle.getAttribute('aria-label'), 'Play GIF', 'pauses');
        assert(app.byId('result-image').hidden, 'GIF hides');
        assert(!app.byId('result-poster').hidden, 'still shows');
        toggle.click();
        assert(!app.byId('result-image').hidden, 'GIF returns');
        const blob = await downloadBytes(app);
        assert(blob.size > 0, 'the download still works after replaying');
    },

    async 'adjusting returns to the same video and settings, without picking it again'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        choose(app, 'loop', 'boomerang');
        app.byId('convert-button').click();
        await until(() => app.doc.body.dataset.screen === 'done', 'the result', 60000);
        app.byId('adjust-button').click();
        await until(() => app.doc.body.dataset.screen === 'editing', 'the editor');
        equal(app.doc.querySelector('input[name="loop"]:checked').value, 'boomerang', 'kept the setting');
        assert(!app.byId('stage-frame').hidden, 'stage returns');
        app.byId('convert-button').click();
        await until(() => app.doc.body.dataset.screen === 'done', 'a second result', 60000);
        equal(app.byId('result-frames').textContent, '118', 'converted again');
    },

    async 'cancelling returns to editing, ready to go again'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        app.byId('convert-button').click();
        await until(() => app.doc.body.dataset.screen === 'converting', 'the conversion');
        await until(() => Number(app.byId('progress-bar').value) > 0, 'some progress');
        app.byId('cancel-button').click();
        await until(() => app.doc.body.dataset.screen === 'editing', 'the editor');
        equal(app.doc.activeElement.id, 'convert-button', 'focus returns to convert');
        await pause(300);
        equal(app.doc.body.dataset.screen, 'editing', 'stays cancelled');
        app.byId('convert-button').click();
        await until(() => app.doc.body.dataset.screen === 'done', 'a result', 60000);
    },

    async 'a drop during a conversion is turned away, and the job carries on'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        app.byId('convert-button').click();
        await until(() => app.doc.body.dataset.screen === 'converting', 'the conversion');
        await drop(app, [await fixture('barcode.webm', 'video/webm')]);
        assert(/Finish or cancel/.test(app.byId('error-message').textContent), 'says why');
        equal(app.doc.body.dataset.screen, 'converting', 'still converting');
        await until(() => app.doc.body.dataset.screen === 'done', 'the result', 60000);
        equal(app.byId('download-link').download, 'barcode.gif', 'the original job finished');
    },

    async 'replacing a file clears the old crop and keeps the page working'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        choose(app, 'aspect', '1');
        const box = app.byId('crop-box');
        pick(app, await fixture('barcode-rotated.mp4'));
        await pause(0);
        assert(app.byId('crop-layer').hidden, 'the old crop goes straight away');
        press(app, box, 'ArrowRight');
        await until(() => app.byId('size-output').textContent === '270 × 480', 'the new video');
        equal(app.doc.querySelector('input[name="aspect"]:checked').value, 'original', 'starts over');
        equal(app.doc.querySelectorAll('video').length, 2, 'the old elements are gone');
    },

    async 'converting again from a failed conversion shows its progress and result'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        const RealWorker = app.win.Worker;
        app.win.Worker = class extends RealWorker {
            constructor(...args) {
                super(...args);
                queueMicrotask(() => this.onerror?.({ message: 'Forced', preventDefault() {} }));
            }
        };
        app.byId('convert-button').click();
        await until(() => app.doc.body.dataset.screen === 'error', 'the failure');
        assert(!app.byId('error-panel').hidden, 'says so');
        app.win.Worker = RealWorker;
        app.byId('convert-button').click();
        equal(app.doc.body.dataset.screen, 'converting', 'shows the conversion');
        assert(app.byId('error-panel').hidden, 'and clears the error');
        await until(() => app.doc.body.dataset.screen === 'done', 'the result', 60000);
    },

    async 'quick cancels and restarts leave only the latest job in charge'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        app.byId('convert-button').click();
        await pause(30);
        app.byId('cancel-button').click();
        app.byId('convert-button').click();
        await pause(60);
        app.byId('cancel-button').click();
        await until(() => app.doc.body.dataset.screen === 'editing', 'the editor');
        await pause(2500);
        equal(app.doc.body.dataset.screen, 'editing', 'the cancelled jobs stay cancelled');
    },

    async 'a dismissed rejection leaves focus somewhere useful'(app) {
        await drop(app, [new File(['text'], 'notes.txt', { type: 'text/plain' })]);
        app.byId('error-dismiss').focus();
        app.byId('error-dismiss').click();
        equal(app.doc.activeElement.id, 'choose-file', 'back on the picker');
    },

    async 'a new video replaces one already open'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        pick(app, await fixture('barcode-rotated.mp4'));
        await until(() => app.byId('size-output').textContent === '270 × 480', 'the new video');
        equal(app.doc.body.dataset.screen, 'editing', 'editing it');
    },

    async 'the theme toggle switches and reports its state'(app) {
        const toggle = app.byId('theme-toggle');
        const before = toggle.getAttribute('aria-pressed');
        toggle.click();
        assert(toggle.getAttribute('aria-pressed') !== before, 'pressed state flips');
        toggle.click();
        equal(toggle.getAttribute('aria-pressed'), before, 'and back');
        try {
            app.win.localStorage.removeItem('theme');
        } catch {
            // Nothing stored if storage is blocked.
        }
    },

    async 'every control has a name'(app) {
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        choose(app, 'aspect', 'free');
        const unnamed = [...app.doc.querySelectorAll('button, input, select, a[href]')].filter((element) => {
            if (element.id === 'file-input') return false;
            const labelled = element.labels?.length > 0 || element.getAttribute('aria-label') || element.getAttribute('aria-labelledby');
            return !labelled && !element.textContent.trim();
        });
        equal(unnamed.map((element) => element.id || element.name || element.tagName).join(), '', 'unnamed controls');
    },

    async 'nothing goes over the network once the page has loaded, other than page files'(app) {
        const entriesBefore = app.win.performance.getEntriesByType('resource').length;
        pick(app, await fixture('barcode.mp4'));
        await waitForEditing(app);
        app.byId('convert-button').click();
        await until(() => app.doc.body.dataset.screen === 'done', 'the result', 60000);
        const external = app.win.performance.getEntriesByType('resource').slice(entriesBefore)
            .filter((entry) => !entry.name.startsWith(app.win.location.origin) && !entry.name.startsWith('blob:'));
        equal(external.map((entry) => entry.name).join(), '', 'external requests');
        const uploads = app.win.performance.getEntriesByType('resource').slice(entriesBefore)
            .filter((entry) => entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest' || entry.initiatorType === 'beacon');
        equal(uploads.map((entry) => entry.name).join(), '', 'requests made by the app');
    },
};

const pageErrors = [];
for (const [name, run] of Object.entries(TESTS)) {
    log(`Running ${name}...`);
    const result = { name };
    const began = performance.now();
    try {
        const app = await openApp();
        app.win.addEventListener('error', (event) => pageErrors.push(`${name}: ${event.message}`));
        app.win.addEventListener('unhandledrejection', (event) => pageErrors.push(`${name}: ${event.reason}`));
        await run(app);
        result.status = 'pass';
        result.detail = `${Math.round(performance.now() - began)}ms`;
    } catch (error) {
        result.status = 'FAIL';
        result.error = error.message;
    }
    results.push(result);
    log(`  ${result.status} ${result.error ?? ''}`);
    await post(`${reportName}-progress`, 'json', JSON.stringify({ userAgent: navigator.userAgent, hidden: document.hidden, results }));
}

results.push({
    name: 'no uncaught errors in any test',
    status: pageErrors.length === 0 ? 'pass' : 'FAIL',
    error: pageErrors.length === 0 ? undefined : pageErrors.slice(0, 3).join(' | '),
    detail: pageErrors.length === 0 ? 'clean' : undefined,
});

await post(reportName, 'json', JSON.stringify({ userAgent: navigator.userAgent, hidden: document.hidden, results }));
log('Done.');
