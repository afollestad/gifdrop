import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_STATE, reduce } from '../../scripts/app/state.js';

function run(...events) {
    return events.reduce(reduce, INITIAL_STATE);
}

test('the usual path runs from a file to a GIF', () => {
    assert.equal(run('fileChosen', 'loaded', 'convert', 'converted').screen, 'done');
});

test('adjusting a finished GIF keeps the video', () => {
    assert.equal(run('fileChosen', 'loaded', 'convert', 'converted', 'adjust').screen, 'editing');
    assert.equal(run('fileChosen', 'loaded', 'convert', 'converted', 'convert').screen, 'converting');
});

test('cancelling returns to editing', () => {
    assert.equal(run('fileChosen', 'loaded', 'convert', 'cancel').screen, 'editing');
});

test('a failed load has nothing to return to', () => {
    const state = run('fileChosen', 'loadFailed');
    assert.equal(state.screen, 'error');
    assert.equal(reduce(state, 'dismiss').screen, 'empty');
});

test('a failed conversion keeps the video', () => {
    const state = run('fileChosen', 'loaded', 'convert', 'convertFailed');
    assert.equal(state.screen, 'error');
    assert.equal(reduce(state, 'dismiss').screen, 'editing');
});

test('converting again straight from a failed conversion starts it properly', () => {
    const state = run('fileChosen', 'loaded', 'convert', 'convertFailed', 'convert');
    assert.equal(state.screen, 'converting');
    assert.equal(state.errorReturnsTo, null);
});

test('a new file can follow anything except a running conversion', () => {
    assert.equal(run('fileChosen', 'fileChosen').screen, 'loading');
    assert.equal(run('fileChosen', 'loaded', 'fileChosen').screen, 'loading');
    assert.equal(run('fileChosen', 'loadFailed', 'fileChosen').screen, 'loading');
    assert.equal(run('fileChosen', 'loaded', 'convert', 'fileChosen').screen, 'converting');
});

test('a late event from a finished job changes nothing', () => {
    const editing = run('fileChosen', 'loaded');
    assert.equal(reduce(editing, 'converted'), editing);
    assert.equal(reduce(editing, 'convertFailed'), editing);
    const cancelled = run('fileChosen', 'loaded', 'convert', 'cancel');
    assert.equal(reduce(cancelled, 'converted').screen, 'editing');
});
