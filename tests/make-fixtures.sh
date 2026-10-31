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
encode -f lavfi -i "$(barcode 640x360 40 4)" -vf "select='lt(n,80)',setpts='if(lt(N,60),N,60+3*(N-60))'" -fps_mode passthrough "${X264[@]}" -g 30 barcode-vfr.mp4

# The reverse, 10fps then 30fps: frame n shows at n/10 up to frame 20, and at
# 2 + (n - 20)/30 after it. Seeks learn a slow rate first, then have to keep up.
encode -f lavfi -i "$(barcode 640x360 40 4)" -vf "select='lt(n,80)',setpts='if(lt(N,20),3*N,60+(N-20))'" -fps_mode passthrough "${X264[@]}" -g 30 barcode-vfr-faster.mp4

# Displayed 360x640 through container metadata only; the stored frames are
# untouched, so the barcode reads along the height, its first bit at the bottom.
encode -display_rotation 90 -i barcode.mp4 -c copy barcode-rotated.mp4

# Stored 320x360 with 2:1 pixels, displayed 640x360.
encode -f lavfi -i "$(barcode 320x360 20 4),setsar=2/1" "${X264[@]}" -g 30 barcode-anamorphic.mp4

# Written to a pipe, so the WebM has no duration in its header.
encode -f lavfi -i "$(barcode 640x360 40 4)" -c:v libvpx-vp9 -crf 12 -b:v 0 -deadline realtime -cpu-used 8 -pix_fmt yuv420p -f webm - > barcode-noduration.webm

# A barcode that takes real work to decode, with heavy noise in a higher bitrate and
# distant keyframes. The cells stay readable, but timing is closer to real video.
encode -f lavfi -i "$(barcode 1280x720 80 8),noise=c0s=30:c1s=10:c2s=10:allf=t" -c:v libx264 -preset veryfast -crf 16 -pix_fmt yuv420p -g 90 -bf 2 barcode-noisy.mp4

# Realistic busy footage with a barcode band across its middle, encoded just like
# motion.mp4, so frames can be checked exactly on content that's hard to decode.
encode -f lavfi -i "testsrc2=s=640x360:r=30:d=8,noise=alls=4:allf=t" -f lavfi -i "$(barcode 640x40 40 8)" -filter_complex "[0][1]overlay=0:160" "${X264[@]}" -g 30 barcode-busy.mp4

# Busy, slightly noisy footage, as a realistic test of estimated and actual sizes.
encode -f lavfi -i "testsrc2=s=640x360:r=30:d=8,noise=alls=4:allf=t" "${X264[@]}" -g 30 motion.mp4

# One unchanging picture.
encode -f lavfi -i "color=0x336699:s=320x180:r=30:d=2" "${X264[@]}" still.mp4

# Decoding failures.
encode -f lavfi -i "sine=frequency=440:duration=2" -c:a aac audio-only.m4a
head -c 4096 barcode.mp4 > truncated.mp4

# Its index comes first, so it loads, then runs out of frames halfway through.
encode -f lavfi -i "$(barcode 640x360 40 4)" "${X264[@]}" -g 30 -movflags +faststart barcode-whole.mp4
head -c "$(( $(wc -c < barcode-whole.mp4) / 2 ))" barcode-whole.mp4 > barcode-cutoff.mp4
rm barcode-whole.mp4

echo "Fixtures written to $(pwd)"
