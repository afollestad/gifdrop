// Which screen the app is on. Anything not listed for the current screen is
// ignored, so a late event from a finished or replaced job can't undo a newer one.

const TRANSITIONS = {
    empty: { fileChosen: 'loading' },
    loading: { loaded: 'editing', loadFailed: 'error', fileChosen: 'loading' },
    editing: { convert: 'converting', fileChosen: 'loading' },
    converting: { converted: 'done', cancel: 'editing', convertFailed: 'error' },
    done: { adjust: 'editing', convert: 'converting', fileChosen: 'loading' },
    error: { dismiss: null, fileChosen: 'loading', convert: 'converting' },
};

export const INITIAL_STATE = { screen: 'empty', errorReturnsTo: null };

export function reduce(state, event) {
    const next = TRANSITIONS[state.screen][event];
    if (next === undefined) return state;

    // An error goes back to wherever it can still be useful: a failed conversion
    // keeps the video, and a failed load has nothing to go back to.
    if (event === 'dismiss') return { screen: state.errorReturnsTo ?? 'empty', errorReturnsTo: null };
    if (event === 'loadFailed') return { screen: next, errorReturnsTo: 'empty' };
    if (event === 'convertFailed') return { screen: next, errorReturnsTo: 'editing' };
    return { screen: next, errorReturnsTo: null };
}
