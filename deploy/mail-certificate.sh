#!/bin/sh
set -u

hostname="${COURTSIDE_MAIL_HOSTNAME:?set COURTSIDE_MAIL_HOSTNAME in .env}"
store="${COURTSIDE_MAIL_CERTIFICATE_STORE:-/caddy/caddy/certificates}"
target="${COURTSIDE_MAIL_CERTIFICATE_TARGET:-/tls}"
watched="${COURTSIDE_MAIL_CERTIFICATE_WATCH:-/caddy}"

# The mail server runs as its own user and reads the pair through the group it shares with this
# helper, which no default umask would grant it.
umask 027

report() {
  printf '%s mail-certificate: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"
}

# A store Caddy is busy in wakes this helper many times over, and a state that has not changed has
# nothing to say a second time.
announce() {
  [ "$1" = "$announced" ] && return 0
  announced="$1"
  report "$1"
}

names() {
  tr -d ' \t\n' < "$1" | sed -n 's/.*"sans":\[\([^]]*\)\].*/\1/p'
}

# Caddy records beside each certificate the names it covers. One that also carried the web name is
# passed over rather than shared, so the mail server is only ever handed a pair that is its alone.
covering() {
  for metadata in "$store"/*/"$hostname"/"$hostname".json; do
    [ -f "$metadata" ] || continue
    [ "$(names "$metadata")" = "\"$hostname\"" ] || continue
    issued="$(dirname "$metadata")"
    [ -f "$issued/$hostname.crt" ] && [ -f "$issued/$hostname.key" ] || continue
    printf '%s\n' "$issued/$hostname.crt"
  done
}

newest() {
  covering | xargs -r ls -t 2>/dev/null | head -1
}

# Caddy is this deployment's certificate authority, so it is also what says whether a pair is one:
# it refuses a key that does not match the certificate and a PEM file that was cut short.
usable() {
  cat > /tmp/pair.caddy <<CADDY
{
	auto_https off
}
:2019 {
	tls $1/tls.crt $1/tls.key
}
CADDY
  caddy validate --adapter caddyfile --config /tmp/pair.caddy > /dev/null 2>&1
}

publish() {
  source="$(newest)"
  if [ -z "$source" ]; then
    announce "no certificate for $hostname in the proxy's store yet"
    return 1
  fi
  issued="$(dirname "$source")"
  version="$(cat "$issued/$hostname.crt" "$issued/$hostname.key" | sha256sum | cut -d' ' -f1)"
  if [ "$version" = "$(readlink "$target/current" 2>/dev/null | sed 's#versions/##')" ]; then
    return 1
  fi

  staging="$target/versions/.staging"
  rm -rf "$staging"
  mkdir -p "$staging" || { announce "cannot write into $target, so nothing can be handed over"; return 1; }
  # Copied through a new file rather than with cp, which would carry over the store's own mode and
  # hand the mail server a key its user cannot open.
  if ! cat "$issued/$hostname.crt" > "$staging/tls.crt" \
      || ! cat "$issued/$hostname.key" > "$staging/tls.key"; then
    rm -rf "$staging"
    announce "cannot copy the pair for $hostname out of the proxy's store"
    return 1
  fi
  if ! usable "$staging"; then
    rm -rf "$staging"
    announce "the pair for $hostname is incomplete or mismatched, so the published one stays"
    return 1
  fi

  rm -rf "$target/versions/$version"
  mv "$staging" "$target/versions/$version" \
    || { announce "cannot name the new version under $target"; return 1; }
  # Two files cannot be renamed together, so the pair is swapped by renaming the one link that
  # names both of them.
  if ! ln -sfn "versions/$version" "$target/.next" || ! mv -T "$target/.next" "$target/current"; then
    announce "cannot swap $target/current, so the mail server still reads the pair before this one"
    return 1
  fi
  announced=""
  report "published the certificate for $hostname as $version"
  discard "$version"
}

# The pair before this one survives a publish, so a mail server that has it open keeps reading a
# file that still exists.
discard() {
  for version in "$target"/versions/*; do
    [ -d "$version" ] || continue
    case "$(basename "$version")" in
      "$1" | "$previous" | .staging) continue ;;
    esac
    rm -rf "$version"
  done
  previous="$1"
}

# What was published before this run started, so a restart does not delete the pair a mail server
# may still have open.
previous="$(readlink "$target/current" 2>/dev/null | sed 's#versions/##')"
announced=""
mkdir -p "$target/versions" || report "cannot create $target/versions"
events=/tmp/events
[ -p "$events" ] || mkfifo "$events"
# Held open for both ends, so the watch is registered before the pass that follows it reads the
# store: a rotation between the two would otherwise be seen by neither.
exec 3<> "$events"
report "watching the proxy's store for $hostname"

# A finished write, an arrival, a rename into place and a removal. Reads are deliberately not among
# them: this helper reads the very files it watches, and would otherwise wake itself forever.
watches() {
  find "$watched" -type d 2>/dev/null | sed 's/$/:wynd/'
}

while true; do
  # Re-armed each round because an issuer's directory appears only with the first order it fills,
  # and inotify watches the directories that existed when it started.
  armed="$(watches)"
  inotifyd - $armed >&3 2>/dev/null &
  watcher=$!
  publish
  # A directory that appeared while this round was arming carries its events to nobody, so the round
  # ends here rather than on an event that will never arrive.
  [ "$armed" = "$(watches)" ] && read -r _ <&3
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
done
