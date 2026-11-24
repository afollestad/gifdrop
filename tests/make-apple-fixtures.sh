#!/bin/bash
# Makes the fixture only macOS can: HEVC with alpha, written by Apple's own exporter as
# its tools would, from the ProRes 4444 that make-fixtures.sh leaves. make-fixtures.sh
# runs this on a Mac, and CI runs it on its macOS runners, since it makes fixtures on
# Linux.
set -euo pipefail

cd "$(dirname "$0")/fixtures"
avconvert --source barcode-alpha-prores.mov --preset PresetHEVCHighestQualityWithAlpha --output barcode-alpha.mov --replace
