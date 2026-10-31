#!/bin/bash
# Renders images/og-image.png from og-image.html with headless Chrome. Keep it a PNG,
# since crawler support for WebP is patchy.
set -euo pipefail

cd "$(dirname "$0")"
CHROME="${CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --force-device-scale-factor=1 --hide-scrollbars --window-size=1200,630 \
    --screenshot="$PWD/../images/og-image.png" "file://$PWD/og-image.html" 2>/dev/null
