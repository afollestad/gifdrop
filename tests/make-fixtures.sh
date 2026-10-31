#!/bin/bash
# Generates the test videos into tests/fixtures/. The barcode clips encode each
# frame's number in 16 black or white cells across the width, least significant
# bit on the left, so a captured frame can be checked against the time it was
# asked for.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p fixtures
cd fixtures

barcode() {
    local size="$1" cell="$2" seconds="$3"
    echo "color=black:s=${size}:r=30:d=${seconds},format=yuv444p,geq=lum='255*mod(floor(N/pow(2\,floor(X/${cell})))\,2)':cb=128:cr=128"
}

encode() {
    ffmpeg -y -v error "$@"
}

X264=(-c:v libx264 -preset veryfast -crf 12 -pix_fmt yuv420p)

encode -f lavfi -i "$(barcode 640x360 40 4)" "${X264[@]}" -g 30 barcode.mp4
encode -f lavfi -i "$(barcode 640x360 40 20)" "${X264[@]}" -g 600 barcode-longgop.mp4
encode -f lavfi -i "$(barcode 640x360 40 4)" -c:v libvpx-vp9 -crf 12 -b:v 0 -deadline realtime -cpu-used 8 -pix_fmt yuv420p barcode.webm
encode -f lavfi -i "$(barcode 640x360 40 4)" -c:v libx265 -preset veryfast -crf 12 -pix_fmt yuv420p -tag:v hvc1 -x265-params log-level=error barcode-hevc.mp4

# 30fps for the first 2 seconds, then 10fps: frame n shows at n/30 up to frame
# 60, and at 2 + (n - 60)/10 after it.
encode -f lavfi -i "$(barcode 640x360 40 4)" -vf "select='lt(n,80)',setpts='if(lt(N,60),N/30,2+(N-60)/10)/TB'" -fps_mode passthrough "${X264[@]}" -g 30 barcode-vfr.mp4

# Displayed 360x640 through container metadata only; the stored frames are
# untouched, so the barcode reads along the height, its first bit at the bottom.
encode -display_rotation 90 -i barcode.mp4 -c copy barcode-rotated.mp4

# Stored 320x360 with 2:1 pixels, displayed 640x360.
encode -f lavfi -i "$(barcode 320x360 20 4),setsar=2/1" "${X264[@]}" -g 30 barcode-anamorphic.mp4

# Written to a pipe, so the WebM has no duration in its header.
encode -f lavfi -i "$(barcode 640x360 40 4)" -c:v libvpx-vp9 -crf 12 -b:v 0 -deadline realtime -cpu-used 8 -pix_fmt yuv420p -f webm - > barcode-noduration.webm

# Decoding failures.
encode -f lavfi -i "sine=frequency=440:duration=2" -c:a aac audio-only.m4a
head -c 4096 barcode.mp4 > truncated.mp4

echo "Fixtures written to $(pwd)"
