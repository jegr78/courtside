#!/bin/sh
set -u

hostname="${COURTSIDE_MAIL_HOSTNAME:?set COURTSIDE_MAIL_HOSTNAME in .env}"
username="${COURTSIDE_MAIL_RELOAD_USERNAME:-certificate-reload}"
password="${COURTSIDE_MAIL_RELOAD_PASSWORD:?set COURTSIDE_MAIL_RELOAD_PASSWORD in .env}"
domain="${COURTSIDE_MAIL_DOMAIN:?set COURTSIDE_MAIL_DOMAIN in .env}"
endpoint="${COURTSIDE_MAIL_RELOAD_ENDPOINT:-http://mail:8080/jmap}"
watched="${COURTSIDE_MAIL_CERTIFICATE_TARGET:-/tls}"
# A certificate is stale once less than this share of its own lifetime is left. Caddy renews at a
# third, so a sixth means the renewal had a full window of its own to fail in first.
share="${COURTSIDE_MAIL_CERTIFICATE_REMAINING_SHARE:-6}"
health=/tmp/health

report() {
  printf '%s mail-reload: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"
}

# The reloader wakes on every swap and retries while it is failing, and a state that has not changed
# has nothing to say a second time.
announce() {
  printf '%s\n' "$1" > "$health"
  [ "$1" = "$announced" ] && return 0
  announced="$1"
  report "$1"
}

healthy() { announce "ok $1"; }
failed() { announce "failed $1"; }

ask() {
  wget -q -O - -T 20 \
    --header="authorization: Basic $credential" \
    --header="content-type: application/json" \
    --post-data="$1" "$endpoint" 2>/dev/null
}

# Every request is answered with 200, including a refused one, so what came back decides and the
# status never does.
refusal() {
  printf '%s' "$1" | sed -n 's/.*"type":"\([a-zA-Z]*\)".*/\1/p' | head -1
}

field() {
  printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1
}

seconds() {
  date -u -D '%Y-%m-%dT%H:%M:%SZ' -d "$1" '+%s' 2>/dev/null
}

reload='{"using":["urn:ietf:params:jmap:core","urn:stalwart:jmap"],"methodCalls":[["x:Action/set",{"create":{"n0":{"@type":"ReloadTlsCertificates"}}},"c0"]]}'
inspect='{"using":["urn:ietf:params:jmap:core","urn:stalwart:jmap"],"methodCalls":[["x:Certificate/get",{},"c0"]]}'

attempt() {
  version="$(readlink "$watched/current" 2>/dev/null)"
  if [ -z "$version" ]; then
    failed "the certificate helper has published no pair for $hostname yet"
    return 1
  fi

  answer="$(ask "$reload")"
  case "$answer" in
    "") failed "the mail server did not answer the reload request"; return 1 ;;
    *'"created"'*) ;;
    *) failed "the mail server refused the reload: $(refusal "$answer")"; return 1 ;;
  esac

  loaded="$(ask "$inspect")"
  case "$loaded" in
    *"\"$hostname\":true"*) ;;
    "") failed "the mail server did not say which certificate it loaded"; return 1 ;;
    *) failed "the mail server loaded a certificate that does not name $hostname"; return 1 ;;
  esac

  expires="$(seconds "$(field "$loaded" notValidAfter)")"
  issued="$(seconds "$(field "$loaded" notValidBefore)")"
  now="$(date -u '+%s')"
  if [ -z "$expires" ] || [ -z "$issued" ] || [ "$expires" -le "$issued" ]; then
    failed "the mail server did not say how long the certificate for $hostname is valid"
    return 1
  fi
  if [ $(( (expires - now) * share )) -lt $(( expires - issued )) ]; then
    failed "the certificate for $hostname is close to expiry, so the proxy stopped renewing it"
    return 1
  fi

  healthy "the mail server serves the certificate the proxy issued for $hostname"
}

credential="$(printf '%s' "$username@$domain:$password" | base64 | tr -d '\n')"
announced=""
events=/tmp/events
[ -p "$events" ] || mkfifo "$events"
# Held open for both ends, so a swap between arming the watch and reading the link is waiting in the
# pipe rather than lost.
exec 3<> "$events"
report "watching $watched for the certificate the helper publishes"

# A retry, not a schedule: the mail server may not have the reload account yet, and the next swap
# can be a renewal period away.
delay=5
while true; do
  inotifyd - "$watched:y" >&3 2>/dev/null &
  watcher=$!
  if attempt; then
    read -r _ <&3
    delay=5
  else
    read -t "$delay" -r _ <&3
    [ "$delay" -lt 30 ] && delay=$(( delay * 2 ))
  fi
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
done
