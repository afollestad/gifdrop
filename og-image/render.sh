#!/bin/bash
# Renders images/og-image.png from og-image.html with headless Chrome. Keep it a PNG,
# since crawler support for WebP is patchy.
set -euo pipefail

cd "$(dirname "$0")"
CHROME="${CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if ! command -v "$CHROME" >/dev/null; then
    echo "Chrome not found at $CHROME; set CHROME_PATH." >&2
    exit 1
fi

# Deleted first, so a failed render shows up as a missing file, not a stale preview.
rm -f ../images/og-image.png
"$CHROME" --headless=new --force-device-scale-factor=1 --hide-scrollbars --window-size=1200,630 \
    --screenshot="$PWD/../images/og-image.png" "file://$PWD/og-image.html" 2>/dev/null

# Chrome exits 0 even when it can't write the screenshot, so check the file itself.
if [[ ! -s ../images/og-image.png ]]; then
    echo "Render failed: images/og-image.png was not written." >&2
    exit 1
fi
