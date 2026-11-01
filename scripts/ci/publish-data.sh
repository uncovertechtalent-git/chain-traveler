#!/usr/bin/env bash
# Publish a verified timetable build to the site bucket, or point the app back at an older one.
#
#   publish <dist-dir> <bucket>   dist-dir is the output of `build/manifest.py make`: data/<date>/ and data/latest.json
#   rollback <date> <bucket>      point data/latest.json at the kept build <date>, after verifying its files
#
# publish, in this order, stopping at the first failure:
#   1. skip when the feed behind the current latest.json is the feed of this build (nothing new);
#   2. refuse to overwrite data/<date>/ when it exists with other bytes (builds are immutable);
#   3. upload the build under data/<date>/ with a one-year immutable Cache-Control;
#   4. read it back and verify both files against the manifest;
#   5. only then write data/latest.json (not cached at the edge), which is what makes the build current;
#   6. delete all but the newest KEEP builds (default 3), never the one just published.
# The role behind this script may only touch data/* in the bucket (site-infra).
#
# Needs AWS credentials in the environment (scripts/ci/aws-session.sh).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
manifest="$here/../../build/manifest.py"
keep="${KEEP:-3}"
mode="${1:-}"

summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"; return 0; }
json_field() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }

upload_build_files() { # <dir> <bucket> <date>
  aws s3 cp "$1/timetable.bin.gz" "s3://$2/data/$3/timetable.bin.gz" --only-show-errors \
    --content-type "application/octet-stream" --cache-control "public, max-age=31536000, immutable"
  aws s3 cp "$1/meta.json" "s3://$2/data/$3/meta.json" --only-show-errors \
    --content-type "application/json; charset=utf-8" --cache-control "public, max-age=31536000, immutable"
}

write_pointer() { # <latest.json> <bucket>
  aws s3 cp "$1" "s3://$2/data/latest.json" --only-show-errors \
    --content-type "application/json; charset=utf-8" --cache-control "no-cache"
}

fetch_build() { # <bucket> <date> <dir>: returns 1 when the build is not there
  mkdir -p "$3"
  aws s3 cp "s3://$1/data/$2/timetable.bin.gz" "$3/timetable.bin.gz" --only-show-errors 2>/dev/null || return 1
  aws s3 cp "s3://$1/data/$2/meta.json" "$3/meta.json" --only-show-errors 2>/dev/null || return 1
}

prune_old() { # <bucket> <current date>
  local dates d
  dates=$(aws s3 ls "s3://$1/data/" | awk '$1 == "PRE" { sub(/\/$/, "", $2); print $2 }')
  # shellcheck disable=SC2086  # the dates are plain words
  for d in $(python3 -I "$manifest" prune "$keep" $dates); do
    [ "$d" = "$2" ] && continue
    aws s3 rm "s3://$1/data/$d/" --recursive --only-show-errors
    echo "removed build $d"
    summary "- Removed old build \`$d\`"
  done
}

publish() {
  local dist="${1:?dist dir}" bucket="${2:?bucket}" tmp date feed remote_feed
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  date="$(json_field "$dist/data/latest.json" date)"
  feed="$(json_field "$dist/data/latest.json" feedSha256)"
  python3 -I "$manifest" check "$dist/data/$date" "$dist/data/latest.json" >/dev/null

  if aws s3 cp "s3://$bucket/data/latest.json" "$tmp/remote-latest.json" --only-show-errors 2>/dev/null; then
    remote_feed="$(json_field "$tmp/remote-latest.json" feedSha256 || true)"
    if [ "$remote_feed" = "$feed" ]; then
      echo "the feed has not changed since the published build; nothing to do"
      summary "### Timetable publish" ""
      summary "Skipped: the gtfs.de feed (sha256 \`${feed:0:12}\`) is the one behind the current build."
      return 0
    fi
  fi

  if fetch_build "$bucket" "$date" "$tmp/existing"; then
    if ! cmp -s "$tmp/existing/timetable.bin.gz" "$dist/data/$date/timetable.bin.gz"; then
      echo "::error::data/$date/ exists with different bytes; builds are immutable. Run again tomorrow, or remove that build by hand first." >&2
      return 1
    fi
    echo "data/$date/ already holds this build; completing the publish"
  fi

  upload_build_files "$dist/data/$date" "$bucket" "$date"
  fetch_build "$bucket" "$date" "$tmp/readback" || { echo "::error::read-back of data/$date/ failed" >&2; return 1; }
  python3 -I "$manifest" check "$tmp/readback" "$dist/data/latest.json" >/dev/null
  write_pointer "$dist/data/latest.json" "$bucket"
  echo "published build $date"
  summary "### Timetable publish" "" "- Published build \`$date\` ($(json_field "$dist/data/latest.json" bytes) bytes, sha256 \`$(json_field "$dist/data/latest.json" sha256 | cut -c1-12)\`)"
  prune_old "$bucket" "$date"
}

rollback() {
  local date="${1:?date}" bucket="${2:?bucket}" tmp out
  case "$date" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) echo "date must be YYYY-MM-DD" >&2; return 2 ;; esac
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  fetch_build "$bucket" "$date" "$tmp/build" || { echo "::error::no build $date in the bucket" >&2; return 1; }
  out="$tmp/out"
  python3 -I "$manifest" make "$tmp/build" "$out" --date "$date" >/dev/null
  write_pointer "$out/data/latest.json" "$bucket"
  echo "latest.json now points at build $date"
  summary "### Timetable rollback" "" "- \`data/latest.json\` points at build \`$date\` again."
}

case "$mode" in
  publish) shift; [ "$#" -eq 2 ] || { echo "usage: $0 publish <dist-dir> <bucket>" >&2; exit 2; }; publish "$@" ;;
  rollback) shift; [ "$#" -eq 2 ] || { echo "usage: $0 rollback <date> <bucket>" >&2; exit 2; }; rollback "$@" ;;
  *) echo "usage: $0 publish <dist-dir> <bucket> | rollback <date> <bucket>" >&2; exit 2 ;;
esac
