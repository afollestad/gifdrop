// Decides whether something picked or dropped could be a video, without opening it.
// Decoding has the final say, so this only turns away what obviously isn't one, and
// gives the benefit of the doubt when a browser doesn't report a type.

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', 'ogg', 'avi', '3gp', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', 'wmv', 'flv']);
const UNKNOWN_TYPES = new Set(['', 'application/octet-stream']);

function extensionOf(name) {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function looksLikeVideo({ name, type }) {
    if (type.startsWith('video/')) return true;
    return UNKNOWN_TYPES.has(type) && VIDEO_EXTENSIONS.has(extensionOf(name));
}

// Takes what a drop or the picker supplied, as `{ name, type, isDirectory }`. Returns
// the file to use as `file`, or `error` saying why not.
export function checkFiles(files) {
    if (files.length === 0) return { error: "That didn't include a file. Try dropping a video." };
    if (files.length > 1) return { error: 'Drop one video at a time.' };
    const [file] = files;
    if (file.isDirectory) return { error: "That's a folder. Drop a single video." };
    if (file.size === 0) return { error: `${file.name} is empty.` };
    if (!looksLikeVideo(file)) return { error: `${file.name} isn't a video.` };
    return { file };
}
