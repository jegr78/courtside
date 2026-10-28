#!/bin/bash
set -euo pipefail

archive=${1:?a key archive is required}
[ -f "$archive" ] && [ ! -L "$archive" ] || { echo 'MFA key archive must be a regular file' >&2; exit 2; }
entries=$(tar -tf "$archive") || exit 2
provided=false
standard=false
while IFS= read -r entry; do
  case "$entry" in
    ./ | . | "") ;;
    ./provided/ | ./provided/mfa.keys) provided=true ;;
    *)
      [[ "$entry" =~ ^\./[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(mfa\.keys)?$ ]] \
        || { echo 'MFA key archive contains an unexpected path' >&2; exit 2; }
      standard=true
      ;;
  esac
done <<< "$entries"
if [ "$provided" = true ] && [ "$standard" = true ]; then
  echo 'MFA key archive must not mix operator-provided and installation keyrings' >&2
  exit 2
fi
types=$(tar -tvf "$archive" | cut -c1 | sort -u)
while IFS= read -r type; do
  [ -z "$type" ] || [ "$type" = - ] || [ "$type" = d ] \
    || { echo 'MFA key archive may contain only regular files and directories' >&2; exit 2; }
done <<< "$types"

if [ "${2:-}" = --mode ]; then
  if [[ "$entries" == *'./provided/mfa.keys'* ]]; then
    printf 'provided\n'
  else
    printf 'standard\n'
  fi
fi
