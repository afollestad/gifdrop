// Crop rectangles are whole pixels of the video as displayed. `aspect` is width
// over height, or null when free.

export const MIN_CROP_SIZE = 16;

export function fullCrop(videoWidth, videoHeight) {
    return { x: 0, y: 0, width: videoWidth, height: videoHeight };
}

// The largest rectangle of that shape, centered.
export function centeredCrop(videoWidth, videoHeight, aspect) {
    if (!aspect) return fullCrop(videoWidth, videoHeight);
    const width = Math.min(videoWidth, Math.round(videoHeight * aspect));
    const height = Math.min(videoHeight, Math.round(width / aspect));
    return {
        x: Math.round((videoWidth - width) / 2),
        y: Math.round((videoHeight - height) / 2),
        width,
        height,
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// For numbers typed in: rounds them, then fits them inside the video.
export function clampCrop({ x, y, width, height }, videoWidth, videoHeight) {
    const fittedWidth = clamp(Math.round(width), Math.min(MIN_CROP_SIZE, videoWidth), videoWidth);
    const fittedHeight = clamp(Math.round(height), Math.min(MIN_CROP_SIZE, videoHeight), videoHeight);
    return {
        x: clamp(Math.round(x), 0, videoWidth - fittedWidth),
        y: clamp(Math.round(y), 0, videoHeight - fittedHeight),
        width: fittedWidth,
        height: fittedHeight,
    };
}

export function moveCrop(crop, dx, dy, videoWidth, videoHeight) {
    return {
        ...crop,
        x: clamp(Math.round(crop.x + dx), 0, videoWidth - crop.width),
        y: clamp(Math.round(crop.y + dy), 0, videoHeight - crop.height),
    };
}

// `handle` names the edges being dragged, such as 'n', 'e' or 'se'. The opposite
// edges stay put. With a side handle and a fixed aspect, the other dimension grows
// about its center.
export function resizeCrop(crop, handle, dx, dy, videoWidth, videoHeight, aspect = null) {
    const movesW = handle.includes('w');
    const movesE = handle.includes('e');
    const movesN = handle.includes('n');
    const movesS = handle.includes('s');
    const right = crop.x + crop.width;
    const bottom = crop.y + crop.height;

    const maxWidth = movesW ? right : videoWidth - crop.x;
    const maxHeight = movesN ? bottom : videoHeight - crop.y;
    let width = movesW ? crop.width - dx : movesE ? crop.width + dx : crop.width;
    let height = movesN ? crop.height - dy : movesS ? crop.height + dy : crop.height;

    if (!aspect) {
        width = clamp(Math.round(width), Math.min(MIN_CROP_SIZE, maxWidth), maxWidth);
        height = clamp(Math.round(height), Math.min(MIN_CROP_SIZE, maxHeight), maxHeight);
        return {
            x: movesW ? right - width : crop.x,
            y: movesN ? bottom - height : crop.y,
            width,
            height,
        };
    }

    const movesSide = movesW || movesE;
    const movesEnd = movesN || movesS;
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;

    // Room for each dimension: to the fixed edge when dragging that way, otherwise
    // to whichever side of the center is nearer the frame.
    const roomWidth = movesSide ? maxWidth : 2 * Math.min(centerX, videoWidth - centerX);
    const roomHeight = movesEnd ? maxHeight : 2 * Math.min(centerY, videoHeight - centerY);
    const scaleFromWidth = width / crop.width;
    const scaleFromHeight = height / crop.height;
    // A corner follows whichever way the pointer moved further, in or out.
    const widthLeads = Math.abs(scaleFromWidth - 1) >= Math.abs(scaleFromHeight - 1);
    const requested = movesSide && (!movesEnd || widthLeads) ? scaleFromWidth : scaleFromHeight;

    const largestWidth = Math.min(roomWidth, roomHeight * aspect);
    const smallestWidth = Math.min(largestWidth, Math.max(MIN_CROP_SIZE, MIN_CROP_SIZE * aspect));
    const fittedWidth = clamp(crop.width * requested, smallestWidth, largestWidth);
    // Rounded before placing, so the edge that's meant to stay put does.
    const finalWidth = Math.round(fittedWidth);
    const finalHeight = Math.round(fittedWidth / aspect);

    const x = movesW ? right - finalWidth : movesE ? crop.x : centerX - finalWidth / 2;
    const y = movesN ? bottom - finalHeight : movesS ? crop.y : centerY - finalHeight / 2;
    return clampCrop({ x, y, width: finalWidth, height: finalHeight }, videoWidth, videoHeight);
}
