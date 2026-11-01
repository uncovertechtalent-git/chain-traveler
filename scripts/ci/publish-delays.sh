#!/usr/bin/env bash
# Publish the live delays, data/delays.json, to the site bucket.
#
#   publish <dist-dir> <bucket>   dist-dir holds data/delays.json, as scripts/fetch-delays.sh lays it out
#
# In this order, stopping at the first failure:
#   1. verify the file about to be uploaded (build/realtime.py check: the format the app reads, under 1 MB, its stream
#      timestamp no older than 15 minutes and not in the future);
#   2. skip when the object in the bucket is from the same stream or a newer one (a late run never overwrites a fresher file);
#   3. upload it to data/delays.json with Cache-Control "public, max-age=30": the CDN follows it, so a delay is at most
#      about half a minute behind the file;
#   4. read it back and compare it byte for byte.
# This is the only key the script writes. It never lists, deletes, or touches latest.json or a dated build; the role behind
# it may only touch data/* in the bucket (site-infra). Unlike a timetable build the file is replaced in place: it is a
# few tens of KB, valid for minutes, and a failed run leaves the previous file to age out (the app ignores one older
# than 15 minutes).
#
# Needs AWS credentials in the environment (scripts/ci/aws-session.sh).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
realtime="$here/../../build/realtime.py"
key="data/delays.json"

summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; return 0; }
json_field() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }

publish() {
  local dist="${1:?dist dir}" bucket="${2:?bucket}" file tmp new old
  file="$dist/$key"
  [ -f "$file" ] || { echo "no $key in $dist" >&2; return 2; }
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  python3 -I "$realtime" check "$file" >/dev/null
  new="$(json_field "$file" feedTime)"

  if aws s3 cp "s3://$bucket/$key" "$tmp/current.json" --only-show-errors 2>/dev/null; then
    old="$(json_field "$tmp/current.json" feedTime 2>/dev/null || true)"
    # feedTime is a fixed-width UTC timestamp, so string order is time order
    if [ -n "$old" ] && [[ ! "$old" < "$new" ]]; then
      echo "the published delays are from $old, not older than $new; nothing to do"
      summary "### Delays publish" "" "Skipped: the published file (stream of \`$old\`) is not older than this one (\`$new\`)."
      return 0
    fi
  fi

  aws s3 cp "$file" "s3://$bucket/$key" --only-show-errors \
    --content-type "application/json; charset=utf-8" --cache-control "public, max-age=30"
  aws s3 cp "s3://$bucket/$key" "$tmp/readback.json" --only-show-errors \
    || { echo "::error::read-back of $key failed" >&2; return 1; }
  cmp -s "$file" "$tmp/readback.json" || { echo "::error::$key in the bucket differs from the file that was uploaded" >&2; return 1; }
  echo "published $key (stream of $new, $(wc -c < "$file" | tr -d ' ') bytes)"
  summary "### Delays publish" "" "- Published \`$key\`: stream of \`$new\`, $(wc -c < "$file" | tr -d ' ') bytes, for timetable build \`$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["timetable"]["date"])' "$file")\`."
}

case "${1:-}" in
  publish) shift; [ "$#" -eq 2 ] || { echo "usage: $0 publish <dist-dir> <bucket>" >&2; exit 2; }; publish "$@" ;;
  *) echo "usage: $0 publish <dist-dir> <bucket>" >&2; exit 2 ;;
esac
