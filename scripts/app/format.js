// Times and sizes as people read, type and hear them.

const SECONDS_PER_MINUTE = 60;
const BYTES_PER_UNIT = 1024;

function tenths(seconds) {
    return Math.round(seconds * 10);
}

// 63.24 becomes "1:03.2".
export function formatTime(seconds) {
    const total = tenths(Math.max(0, seconds));
    const minutes = Math.floor(total / (SECONDS_PER_MINUTE * 10));
    const rest = (total - minutes * SECONDS_PER_MINUTE * 10) / 10;
    return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

// Takes "1:03.2", "63.2" or "1:03", or with a comma as some keyboards offer, and returns
// null for anything else.
export function parseTime(text) {
    const match = /^\s*(?:(\d+):)?(\d+(?:\.\d*)?|\.\d+)\s*$/.exec(text.replace(',', '.'));
    if (!match) return null;
    const minutes = match[1] ? Number(match[1]) : 0;
    const seconds = Number(match[2]);
    if (match[1] && seconds >= SECONDS_PER_MINUTE) return null;
    return minutes * SECONDS_PER_MINUTE + seconds;
}

// For screen readers: "1 minute 3.2 seconds".
export function spokenTime(seconds) {
    const total = tenths(Math.max(0, seconds));
    const minutes = Math.floor(total / (SECONDS_PER_MINUTE * 10));
    const rest = (total - minutes * SECONDS_PER_MINUTE * 10) / 10;
    const parts = [];
    if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
    if (rest > 0 || minutes === 0) parts.push(`${rest} ${rest === 1 ? 'second' : 'seconds'}`);
    return parts.join(' ');
}

export function formatBytes(bytes) {
    if (Math.round(bytes) < BYTES_PER_UNIT) return `${Math.round(bytes)} B`;
    const kilobytes = Math.round(bytes / BYTES_PER_UNIT);
    if (kilobytes < BYTES_PER_UNIT) return `${kilobytes} KB`;
    return `${(bytes / BYTES_PER_UNIT ** 2).toFixed(1)} MB`;
}

// "1.4–1.9 MB", or "900 KB–1.2 MB" across units.
export function formatByteRange(low, high) {
    const lowText = formatBytes(low);
    const highText = formatBytes(high);
    const lowUnit = lowText.split(' ')[1];
    const highUnit = highText.split(' ')[1];
    return lowUnit === highUnit ? `${lowText.split(' ')[0]}–${highText}` : `${lowText}–${highText}`;
}

// "clip.final.mov" becomes "clip.final.gif".
export function gifFileName(sourceName) {
    const stem = sourceName.replace(/\.[^./\\]+$/, '') || 'video';
    return `${stem}.gif`;
}
