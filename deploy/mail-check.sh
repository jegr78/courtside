#!/bin/sh
set -uf

domain="${COURTSIDE_MAIL_DOMAIN:?set COURTSIDE_MAIL_DOMAIN in .env}"
hostname="${COURTSIDE_MAIL_HOSTNAME:?set COURTSIDE_MAIL_HOSTNAME in .env}"
selector="${COURTSIDE_MAIL_DKIM_SELECTOR:?set COURTSIDE_MAIL_DKIM_SELECTOR in .env}"
probe="${COURTSIDE_MAIL_OUTBOUND_PROBE:-gmail-smtp-in.l.google.com}"
relay_probe="${COURTSIDE_MAIL_RELAY_PROBE:-relay-probe.example.com}"
# The service on the compose network, not the public name: a host rarely reaches its own
# published port from inside a container, and a hairpin failure is not an open relay.
relay_target="${COURTSIDE_MAIL_RELAY_TARGET:-mail}"

failures=0

# A record is somebody else's text: strip what a terminal would act on rather than print it.
readable() {
  tr -d '\000-\010\013\014\016-\037\177'
}

report() {
  if [ "$1" = ok ]; then
    printf 'ok    %s\n' "$2"
  else
    printf 'FAIL  %s\n' "$2"
    failures=$((failures + 1))
  fi
  if [ -n "${3:-}" ]; then
    printf '      %s\n' "$3" | readable
  fi
}

answers() {
  nslookup -type="$2" "$1" 2>/dev/null | sed -n 's/^.*\('"$3"'\) *= *//p'
}

# Every name a resolver hands back, with the root label removed so it compares as typed.
canonical() {
  sed 's/\.$//' | sed 's/^[0-9][0-9]* *//'
}

addresses=$(nslookup "$hostname" 2>/dev/null | sed -n '/^Name:/,$p' | sed -n 's/^Address: *//p')
if [ -z "$addresses" ]; then
  report fail "$hostname resolves to an address" "receivers cannot reach an MTA without one"
else
  report ok "$hostname resolves to $(echo "$addresses" | tr '\n' ' ' | sed 's/ *$//')"
fi

for address in $addresses; do
  pointer=$(nslookup "$address" 2>/dev/null | sed -n 's/^.*name = //p' | canonical)
  if [ "$pointer" = "$hostname" ]; then
    report ok "$address has a PTR record naming $hostname"
  else
    report fail "$address has no PTR record naming $hostname" \
      "found '${pointer:-nothing}'; large receivers reject mail from a host whose reverse name disagrees"
  fi
done

if answers "$domain" mx "mail exchanger" | canonical | grep -qxF "$hostname"; then
  report ok "$domain has an MX record naming $hostname"
else
  report fail "$domain has no MX record naming $hostname" \
    "without it no bounce and no DMARC report reaches this instance"
fi

spf=$(answers "$domain" txt text | grep 'v=spf1' | head -1)
if [ -z "$spf" ]; then
  report fail "$domain publishes no SPF record" "publish v=spf1 naming this host, ending in -all"
elif echo "$spf" | grep -qE "(^|[ \"])(a|mx)([ \";]|$)|a:$hostname|include:|ip4:|ip6:"; then
  report ok "$domain publishes SPF naming a sender" "$spf"
else
  report fail "$domain publishes SPF that names no sender" \
    "found $spf — an SPF record without a, mx, ip4, ip6 or include authorises nobody"
fi

dmarc=$(answers "_dmarc.$domain" txt text | grep 'v=DMARC1' | head -1)
if [ -n "$dmarc" ]; then
  report ok "$domain publishes DMARC" "$dmarc"
else
  report fail "$domain publishes no DMARC record" "publish v=DMARC1 at _dmarc.$domain"
fi

if [ -n "$(answers "$selector._domainkey.$domain" txt text | head -1)" ]; then
  report ok "$selector._domainkey.$domain publishes a DKIM key"
else
  report fail "$selector._domainkey.$domain publishes no DKIM key" \
    "copy the record the mail server generated for this selector into DNS"
fi

if nc -z -w 5 "$probe" 25 2>/dev/null; then
  report ok "outbound port 25 reaches $probe"
else
  report fail "outbound port 25 does not reach $probe" \
    "most hosting providers block it until asked; until they do, give the mail server a relay host under MTA > Outbound > Routes"
fi

relay=$(printf 'EHLO %s\r\nMAIL FROM:<probe@%s>\r\nRCPT TO:<probe@%s>\r\nQUIT\r\n' \
  "$hostname" "$domain" "$relay_probe" | nc -w 10 "$relay_target" 25 2>/dev/null | tr -d '\r')
# The greeting, the end of EHLO, the sender and the recipient, in that order. Continuation lines
# carry a hyphen instead of the space, so the fourth answer is the one about the recipient.
relay_answers=$(printf '%s\n' "$relay" | grep -E '^[0-9]{3} ')
relay_sender=$(printf '%s\n' "$relay_answers" | sed -n '3p')
relay_recipient=$(printf '%s\n' "$relay_answers" | sed -n '4p')
if [ -z "$relay" ]; then
  report fail "port 25 of $relay_target answered nothing" \
    "the relay probe needs the mail server running and reachable as $relay_target"
elif [ -z "$relay_recipient" ]; then
  report fail "$relay_target ended the probe before answering about the recipient" \
    "this says nothing either way about relaying, and a check that cannot tell must not say it can"
elif ! echo "$relay_sender" | grep -q '^2'; then
  report fail "$relay_target turned the probe's sender away, so it never decided about the recipient" \
    "what came back is a bad sequence and not a refusal to relay; the probe cannot answer this"
elif echo "$relay_recipient" | grep -q '^2'; then
  report fail "$relay_target accepts unauthenticated mail for $relay_probe" \
    "an open relay is the one state in which this instance harms people who are not its members"
else
  report ok "$relay_target refuses unauthenticated mail for a foreign domain"
fi

printf '\n%s check(s) failed\n' "$failures"
[ "$failures" -eq 0 ]
