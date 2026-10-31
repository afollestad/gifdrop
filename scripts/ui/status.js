// Tells screen readers what's happening, at a pace they can follow. Steady progress is
// announced in occasional steps, and anything else right away.

const PROGRESS_STEP = 0.1;
const PROGRESS_INTERVAL_MS = 5000;

export function createStatus(region) {
    let lastShare = -1;
    let lastTime = 0;

    function say(message) {
        region.textContent = message;
    }

    return {
        say,

        // Announces when progress has moved far enough, or enough time has passed.
        progress(share, message) {
            const now = performance.now();
            if (share - lastShare < PROGRESS_STEP && now - lastTime < PROGRESS_INTERVAL_MS) return;
            lastShare = share;
            lastTime = now;
            say(message);
        },

        resetProgress() {
            lastShare = -1;
            lastTime = 0;
        },
    };
}
