#!/bin/sh
# Download the gtfs.de regional rail feed (all German regional rail, CC BY 4.0, data provided by DELFI e.V.),
# build the timetable from it, and lay the result out the way the CDN serves it:
#   <site-dir>/data/<date>/timetable.bin.gz and meta.json   (one dated build)
#   <site-dir>/data/latest.json                             (the manifest the app checks)
# The feed holds a rolling 31-day window and is regenerated daily, so run this again to refresh.
# Default site-dir is app/, so ./serve.sh serves the same layout as production (app/data/ is git-ignored).
# Usage: scripts/fetch-feed.sh [work-dir [site-dir]]
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$HERE/../.feed}"
SITE="${2:-$HERE/../app}"
mkdir -p "$WORK" "$SITE"
curl --fail --silent --show-error --location --proto '=https' --retry 3 --max-time 600 \
  -D "$WORK/headers.txt" -o "$WORK/latest.zip" https://download.gtfs.de/germany/rv_free/latest.zip
unzip -tq "$WORK/latest.zip" > /dev/null
rm -rf "$WORK/feed" "$WORK/build" && mkdir "$WORK/feed" "$WORK/build"
unzip -o -q "$WORK/latest.zip" -d "$WORK/feed"
grep -i '^last-modified:' "$WORK/headers.txt" | tail -n 1 | tr -d '\r' || true
python3 -I "$HERE/../build/build_timetable.py" "$WORK/feed" "$WORK/build"
# The build is named by the date of the feed (its Last-Modified, UTC), not by the day it was built; no header: the build day.
FEED_DATE="$(python3 -I "$HERE/../build/manifest.py" feed-date "$WORK/headers.txt")"
python3 -I "$HERE/../build/manifest.py" make "$WORK/build" "$SITE" ${FEED_DATE:+--date "$FEED_DATE"} > /dev/null
echo "published layout in $SITE/data: $(python3 -I -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["date"], m["bytes"], "bytes")' "$SITE/data/latest.json")"
