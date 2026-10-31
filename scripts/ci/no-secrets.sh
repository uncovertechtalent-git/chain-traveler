#!/usr/bin/env bash
# Fail when a tracked file looks like it carries a credential or an AWS account id. The repository is public:
# nothing private belongs in it. Cheap patterns only; the real control is that no secret exists to leak
# (deploys are keyless, see README). Usage: scripts/ci/no-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

patterns=(
  'AKIA[0-9A-Z]{16}'                                  # AWS access key id
  'ASIA[0-9A-Z]{16}'                                  # AWS temporary access key id
  'aws_secret_access_key'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'gh[pousr]_[A-Za-z0-9]{30,}'                        # GitHub tokens
  'github_pat_[A-Za-z0-9_]{30,}'
  'arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:[0-9]{12}:'   # an ARN with an account id
)
# This file lists the patterns, so it is not scanned.
list="$(mktemp)"
trap 'rm -f "$list"' EXIT
git ls-files | grep -v -e '^scripts/ci/no-secrets.sh$' -e '^LICENSE$' > "$list"
count=$(wc -l < "$list" | tr -d ' ')
status=0
for p in "${patterns[@]}"; do
  if hits=$(tr '\n' '\0' < "$list" | xargs -0 grep -nE -e "$p" 2>/dev/null); then
    echo "::error::possible credential or account id (pattern: $p):"
    echo "$hits" | cut -c1-120
    status=1
  fi
done
[ "$status" -eq 0 ] && echo "no credential patterns in $count tracked files"
exit "$status"
