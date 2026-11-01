#!/bin/sh
# Cut the gtfs.de realtime stream (GTFS-Realtime, beta, CC BY-SA 4.0) down to the delays the app shows, and lay the
# result out the way the CDN serves it:
#   <site-dir>/data/delays.json
# The published timetable build says which trip is which: this reads <site-url>/data/latest.json and the
# trip-ids.txt.gz that manifest names from the CDN, as the app would; build/realtime.py checks it against the manifest.
# Nothing here holds a credential. Default site-dir is app/, so ./serve.sh serves the same layout as production
# (app/data/ is git-ignored).
# Exit status 3 means there is nothing worth publishing right now (the stream or the manifest could not be downloaded,
# the stream is stale or unreadable, the published build has no trip ids yet); the reason is printed. Any other failure
# is a real error.
# Usage: scripts/fetch-delays.sh <site-url> [work-dir [site-dir]]
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
SITE_URL="${1:?usage: scripts/fetch-delays.sh <site-url> [work-dir [site-dir]]}"
WORK="${2:-$HERE/../.feed-rt}"
SITE="${3:-$HERE/../app}"
STREAM=https://realtime.gtfs.de/realtime-free.pb
rm -rf "$WORK/map" "$WORK/stream.pb" && mkdir -p "$WORK/map"

# --compressed: the stream server sends gzip when asked (13 MB becomes 5 MB), and curl hands over the decoded bytes.
get() { # <url> <file>: status 1 when the download fails
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 2 --max-time 120 \
    --max-filesize 67108864 --compressed -o "$2" "$1"
}
field() { python3 -I -c 'import json,sys; v=json.load(open(sys.argv[1])).get(sys.argv[2]); print("" if v is None else v)' "$1" "$2"; }

get "$STREAM" "$WORK/stream.pb" || { echo "nothing to publish: the stream could not be downloaded"; exit 3; }
get "$SITE_URL/data/latest.json" "$WORK/map/latest.json" || { echo "nothing to publish: the manifest of the published build could not be downloaded"; exit 3; }
date="$(field "$WORK/map/latest.json" date)"
case "$date" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) echo "error: the manifest has no date" >&2; exit 1 ;; esac
# A build made before trip ids existed has none; build/realtime.py then says so and exits with status 3.
if [ -n "$(field "$WORK/map/latest.json" tripIdsSha256)" ]; then
  get "$SITE_URL/data/$date/trip-ids.txt.gz" "$WORK/map/trip-ids.txt.gz" || { echo "error: the manifest names trip-ids.txt.gz but the site does not serve it" >&2; exit 1; }
fi
exec python3 -I "$HERE/../build/realtime.py" make "$WORK/stream.pb" "$WORK/map" "$SITE/data/delays.json"
