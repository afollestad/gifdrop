// What to tell people when something goes wrong. Takes plain fields rather than error
// classes, so this has no dependency on what threw them.
import { formatTime } from './format.js';

const LOAD_MESSAGES = {
    undecodable: "This browser can't open that video. It may use a format it doesn't support, so try converting it to MP4, or using another browser.",
    'no-video': "That file has no video this browser can show. It may be audio only, or use a format it doesn't support.",
    timeout: "That video took too long to open. It may use a format this browser doesn't support.",
};

export function loadErrorMessage(reason) {
    return LOAD_MESSAGES[reason] ?? "Something went wrong opening that video. Please try again.";
}

const ENCODER_MESSAGES = {
    'too-large': 'That GIF got too large to finish. Try a smaller width, a lower frame rate or a shorter trim.',
    memory: 'Not enough memory to finish. Try a smaller width or a shorter trim.',
};

// `name` and `reason` are from the error, and `time` is in seconds, for seek errors.
export function convertErrorMessage({ name, reason, time }) {
    if (name === 'EncoderError' && ENCODER_MESSAGES[reason]) return ENCODER_MESSAGES[reason];
    if (name === 'SeekStalledError') return `The video stalled at ${formatTime(time)}. Try trimming to before that point.`;
    if (name === 'VideoDecodeError') return `The video couldn't be read at ${formatTime(time)}. Try trimming to before that point.`;
    return 'Something went wrong making that GIF. Please try again.';
}

export const HDR_NOTICE = 'This is an HDR video. GIFs can only show standard colors, so it may look flatter.';
export const UNREADABLE_END_NOTICE = "This browser can't read this video all the way through, so the GIF may freeze partway. If it does, try another browser.";
export const HIDDEN_TAB_MESSAGE = 'Paused while this tab is in the background. Come back to continue.';
