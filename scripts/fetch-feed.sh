#!/bin/sh
# Download the gtfs.de regional rail feed (all German regional rail, CC BY 4.0, data provided by DELFI e.V.)
# and build the app timetable from it. The feed holds a rolling 31-day window and is regenerated daily,
# so run this again to refresh. The build is written to app/data/ (git-ignored).
# Usage: scripts/fetch-feed.sh [work-dir [out-dir]]
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$HERE/../.feed}"
OUT="${2:-$HERE/../app/data}"
mkdir -p "$WORK" "$OUT"
curl --fail --silent --show-error --location --proto '=https' --retry 3 --max-time 600 \
  -D "$WORK/headers.txt" -o "$WORK/latest.zip" https://download.gtfs.de/germany/rv_free/latest.zip
unzip -tq "$WORK/latest.zip" > /dev/null
rm -rf "$WORK/feed" && mkdir "$WORK/feed"
unzip -o -q "$WORK/latest.zip" -d "$WORK/feed"
grep -i '^last-modified:' "$WORK/headers.txt" | tail -n 1 | tr -d '\r' || true
python3 -I "$HERE/../build/build_timetable.py" "$WORK/feed" "$OUT"
