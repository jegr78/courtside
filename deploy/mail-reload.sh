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
# A swap can be a renewal period away, and a certificate nobody renews expires in silence between
# two of them, so what the mail server holds is read back on its own as well.
interval="${COURTSIDE_MAIL_CERTIFICATE_CHECK_INTERVAL:-3600}"
# 400 days, the longest any authority issues for. The mail server's own fallback runs to the year
# 4096, so outliving this is what tells one apart from a certificate the proxy obtained.
ceiling="${COURTSIDE_MAIL_CERTIFICATE_MAXIMUM_LIFETIME:-34560000}"
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
  answer="$(wget -S -O - -T 20 \
    --header="authorization: Basic $credential" \
    --header="content-type: application/json" \
    --post-data="$1" "$endpoint" 2>"$trace")"
  status="$(sed -n 's|.*HTTP/1\.[01] \([0-9][0-9]*\).*|\1|p' "$trace" | head -1)"
  [ -n "$answer" ]
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

  if ! ask "$reload"; then
    failed "the mail server answered the reload request with ${status:-nothing}"
    return 1
  fi
  case "$answer" in
    *'"created"'*) ;;
    *) failed "the mail server refused the reload: $(refusal "$answer")"; return 1 ;;
  esac

  verify
}

verify() {
  if ! ask "$inspect"; then
    failed "the mail server answered with ${status:-nothing} when asked what it loaded"
    return 1
  fi
  loaded="$answer"
  # Read without an id, so the answer holds every certificate and the fields below would be taken
  # from whichever came last.
  if [ "$(printf '%s' "$loaded" | grep -o '"notValidAfter"' | wc -l)" -ne 1 ]; then
    failed "the mail server holds more than one certificate, so this cannot say which it checked"
    return 1
  fi
  case "$loaded" in
    *"\"$hostname\":true"*) ;;
    *) failed "the mail server loaded a certificate that does not name $hostname"; return 1 ;;
  esac

  expires="$(seconds "$(field "$loaded" notValidAfter)")"
  issued="$(seconds "$(field "$loaded" notValidBefore)")"
  now="$(date -u '+%s')"
  if [ -z "$expires" ] || [ -z "$issued" ] || [ "$expires" -le "$issued" ]; then
    failed "the mail server did not say how long the certificate for $hostname is valid"
    return 1
  fi
  if [ $(( expires - issued )) -gt "$ceiling" ]; then
    failed "the mail server serves a certificate it made itself and not the one the proxy issued"
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
answer=""
status=""
trace=/tmp/trace
events=/tmp/events
[ -p "$events" ] || mkfifo "$events"
# Held open for both ends, so a swap between arming the watch and reading the link is waiting in the
# pipe rather than lost.
exec 3<> "$events"
report "watching $watched for the certificate the helper publishes"

# A rotation the mail server slept through is loaded on the first round. The reload stays owed until
# one is accepted, so a refused one is retried and no read-back reports over it.
owed=yes
delay=5
while true; do
  inotifyd - "$watched:y" >&3 2>/dev/null &
  watcher=$!
  if [ "$owed" = yes ]; then attempt && owed=no; else verify; fi
  if [ $? -eq 0 ]; then
    waiting="$interval"
    delay=5
  else
    waiting="$delay"
    [ "$delay" -lt 30 ] && delay=$(( delay * 2 ))
  fi
  read -t "$waiting" -r _ <&3 && owed=yes
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
done
