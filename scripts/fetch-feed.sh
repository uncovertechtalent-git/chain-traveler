#!/bin/sh
# Download the gtfs.de regional rail feed (all German regional rail, CC BY 4.0, DELFI e.V. via gtfs.de)
# and build the app timetable from it. The feed holds a rolling 31-day window and is regenerated daily,
# so run this again to refresh. Usage: scripts/fetch-feed.sh [work-dir]
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$HERE/../.feed}"
mkdir -p "$WORK"
curl -sS -L -o "$WORK/latest.zip" https://download.gtfs.de/germany/rv_free/latest.zip
rm -rf "$WORK/feed" && mkdir "$WORK/feed"
unzip -o -q "$WORK/latest.zip" -d "$WORK/feed"
python3 -I "$HERE/../build/build_timetable.py" "$WORK/feed" "$HERE/../app/data"
