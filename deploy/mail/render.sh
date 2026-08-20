#!/bin/sh
set -eu

hostname="${COURTSIDE_MAIL_HOSTNAME:?set COURTSIDE_MAIL_HOSTNAME in .env}"
domain="${COURTSIDE_MAIL_DOMAIN:?set COURTSIDE_MAIL_DOMAIN in .env}"
sink="${COURTSIDE_MAIL_SINK:-}"
adminuser="${COURTSIDE_MAIL_ADMIN_USERNAME:-postmaster}"
adminpassword="${COURTSIDE_MAIL_ADMIN_PASSWORD:?set COURTSIDE_MAIL_ADMIN_PASSWORD in .env}"

for plan in "$@"; do
  sed -e "s|{{hostname}}|${hostname}|g" -e "s|{{domain}}|${domain}|g" -e "s|{{sink}}|${sink}|g" \
    -e "s|{{adminuser}}|${adminuser}|g" -e "s|{{adminpassword}}|${adminpassword}|g" \
    "/mail/${plan}.ndjson" > "/plan/${plan}.ndjson"
  printf 'rendered %s for %s\n' "$plan" "$hostname"
done
