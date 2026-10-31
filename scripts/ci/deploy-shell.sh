#!/usr/bin/env bash
# Publish the app shell (everything in app/ except data/) to the site bucket, then invalidate its paths.
# The timetable under data/ belongs to the timetable workflow: this script never writes, lists for deletion
# or invalidates it, and its role is denied write access to data/* besides (site-infra).
#
# Cache-Control is set per object and matches what the CDN enforces at the edge: the shell is revalidated on
# every use (no-cache plus ETag), so a deploy is visible at once and the service worker always sees fresh files.
#
# Usage: scripts/ci/deploy-shell.sh <app-dir> <bucket> <distribution-id>
# Needs AWS credentials in the environment (scripts/ci/aws-session.sh).
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <app-dir> <bucket> <distribution-id>" >&2
  exit 2
fi
src="${1%/}" bucket="$2" distribution="$3"
[ -f "$src/index.html" ] || { echo "no index.html in $src" >&2; exit 2; }
[ -f "$src/sw.js" ] || { echo "no sw.js in $src" >&2; exit 2; }

content_type() {
  case "$1" in
    *.html) echo "text/html; charset=utf-8" ;;
    *.css) echo "text/css; charset=utf-8" ;;
    *.js | *.mjs) echo "text/javascript; charset=utf-8" ;;
    *.json) echo "application/json; charset=utf-8" ;;
    *.webmanifest) echo "application/manifest+json; charset=utf-8" ;;
    *.svg) echo "image/svg+xml" ;;
    *.png) echo "image/png" ;;
    *.txt) echo "text/plain; charset=utf-8" ;;
    *) echo "unknown file type: $1" >&2; return 1 ;;
  esac
}

# The shell files: everything under the app directory except data/ and dot-directories other than .well-known.
files="$(mktemp)"
trap 'rm -f "$files"' EXIT
(cd "$src" && find . -type f ! -path './data/*' ! -name '.DS_Store' | sed 's|^\./||' | LC_ALL=C sort) > "$files"
[ -s "$files" ] || { echo "no shell files found" >&2; exit 2; }

# Check every file has a known type before the first upload, so a new file type cannot leave a half-published shell.
while IFS= read -r key; do
  content_type "$key" > /dev/null
done < "$files"

while IFS= read -r key; do
  ctype="$(content_type "$key")"
  aws s3 cp "$src/$key" "s3://$bucket/$key" --only-show-errors --content-type "$ctype" --cache-control "no-cache"
done < "$files"

# Remove shell files that the app no longer has. Keys under data/ are never listed for deletion.
stale=0
while IFS= read -r key; do
  case "$key" in data/*) continue ;; esac
  if ! grep -qxF -- "$key" "$files"; then
    aws s3 rm "s3://$bucket/$key" --only-show-errors
    stale=$((stale + 1))
  fi
done < <(aws s3 ls "s3://$bucket/" --recursive | awk '{ $1 = $2 = $3 = ""; sub(/^ +/, ""); print }')

# Invalidate the shell: the root and every shell file. data/ is not invalidated: dated builds are new paths
# and data/latest.json is not cached at the edge.
paths=("/")
while IFS= read -r key; do paths+=("/$key"); done < "$files"
invalidation=$(aws cloudfront create-invalidation --distribution-id "$distribution" \
  --paths "${paths[@]}" --query "Invalidation.Id" --output text)

count=$(wc -l < "$files" | tr -d ' ')
echo "deployed $count shell files, removed $stale stale; invalidation $invalidation"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Shell deploy"
    echo
    echo "- Files published: $count"
    echo "- Stale files removed: $stale"
    echo "- CloudFront invalidation: \`$invalidation\` (${#paths[@]} paths)"
  } >> "$GITHUB_STEP_SUMMARY"
fi
