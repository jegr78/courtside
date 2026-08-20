#!/bin/sh
set -eu

source_directory="${COURTSIDE_MAIL_PLAN_SOURCE:-/mail}"
target_directory="${COURTSIDE_MAIL_PLAN_TARGET:-/plan}"

# Every value lands in a JSON string inside a sed replacement, so it is escaped for both: an
# unescaped & stands for the whole match and would silently substitute a password nobody chose.
escape() {
  if [ "$(printf '%s' "$2" | wc -l)" -ne 0 ]; then
    printf '%s holds a line break, which no plan value may\n' "$1" >&2
    exit 1
  fi
  printf '%s' "$2" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | sed -e 's/[\\&|]/\\&/g'
}

hostname=$(escape COURTSIDE_MAIL_HOSTNAME \
  "${COURTSIDE_MAIL_HOSTNAME:?set COURTSIDE_MAIL_HOSTNAME in .env}")
domain=$(escape COURTSIDE_MAIL_DOMAIN "${COURTSIDE_MAIL_DOMAIN:?set COURTSIDE_MAIL_DOMAIN in .env}")
sink=$(escape COURTSIDE_MAIL_SINK "${COURTSIDE_MAIL_SINK:-}")
adminuser=$(escape COURTSIDE_MAIL_ADMIN_USERNAME "${COURTSIDE_MAIL_ADMIN_USERNAME:-postmaster}")
adminpassword=$(escape COURTSIDE_MAIL_ADMIN_PASSWORD \
  "${COURTSIDE_MAIL_ADMIN_PASSWORD:?set COURTSIDE_MAIL_ADMIN_PASSWORD in .env}")

for plan in "$@"; do
  sed -e "s|{{hostname}}|${hostname}|g" -e "s|{{domain}}|${domain}|g" -e "s|{{sink}}|${sink}|g" \
    -e "s|{{adminuser}}|${adminuser}|g" -e "s|{{adminpassword}}|${adminpassword}|g" \
    "${source_directory}/${plan}.ndjson" > "${target_directory}/${plan}.ndjson"
  printf 'rendered %s for %s\n' "$plan" "$hostname"
done
