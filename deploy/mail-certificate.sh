#!/bin/sh
set -u

hostname="${COURTSIDE_MAIL_HOSTNAME:?set COURTSIDE_MAIL_HOSTNAME in .env}"
store="${COURTSIDE_MAIL_CERTIFICATE_STORE:-/caddy/caddy/certificates}"
target="${COURTSIDE_MAIL_CERTIFICATE_TARGET:-/tls}"
watched="${COURTSIDE_MAIL_CERTIFICATE_WATCH:-/caddy}"
health=/tmp/health

# The mail server runs as its own user and reads the pair through the group it shares with this
# helper, which no default umask would grant it.
umask 027

report() {
  printf '%s mail-certificate: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"
}

# A store Caddy is busy in wakes this helper many times over, and a state that has not changed has
# nothing to say a second time.
announce() {
  printf '%s\n' "$1" > "$health"
  [ "$1" = "$announced" ] && return 0
  announced="$1"
  report "${1#* }"
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

leaf_fingerprint() {
  encoded=/tmp/leaf-certificate.base64
  der=/tmp/leaf-certificate.der
  if ! awk '/BEGIN CERTIFICATE/{inside=1; next} /END CERTIFICATE/{exit} inside{print}' "$1" \
      > "$encoded" || ! base64 -d "$encoded" > "$der" || [ ! -s "$der" ]; then
    rm -f "$encoded" "$der"
    return 1
  fi
  sha256sum "$der" | cut -d' ' -f1
  rm -f "$encoded" "$der"
}

retain_fingerprint() {
  version="$1"
  certificate="$2"
  fingerprint="$(leaf_fingerprint "$certificate")"
  if ! printf '%s\n' "$fingerprint" | grep -q '^[a-f0-9]\{64\}$'; then
    return 1
  fi
  temporary="$target/fingerprints/.$version"
  printf '%s\n' "$fingerprint" > "$temporary" || return 1
  chmod 0644 "$temporary" || return 1
  mv "$temporary" "$target/fingerprints/$version"
}

publish() {
  source="$(newest)"
  if [ -z "$source" ]; then
    announce "failed no certificate for $hostname in the proxy's store yet"
    return 1
  fi
  issued="$(dirname "$source")"
  version="$(cat "$issued/$hostname.crt" "$issued/$hostname.key" | sha256sum | cut -d' ' -f1)"
  if [ "$version" = "$(readlink "$target/current" 2>/dev/null | sed 's#versions/##')" ]; then
    if [ ! -f "$target/fingerprints/$version" ]; then
      current="$(cat "$target/current/tls.crt" "$target/current/tls.key" 2>/dev/null \
        | sha256sum | cut -d' ' -f1)"
      if [ "$current" != "$version" ] || ! usable "$target/current" \
          || ! retain_fingerprint "$version" "$target/current/tls.crt"; then
        announce "failed the published version for $hostname no longer matches its contents"
        return 1
      fi
    fi
    announce "ok the mail server has the certificate the proxy issued for $hostname"
    return 1
  fi

  staging="$target/versions/.staging"
  rm -rf "$staging"
  mkdir -p "$staging" || { announce "failed cannot write into $target, so nothing can be handed over"; return 1; }
  # Copied through a new file rather than with cp, which would carry over the store's own mode and
  # hand the mail server a key its user cannot open.
  if ! cat "$issued/$hostname.crt" > "$staging/tls.crt" \
      || ! cat "$issued/$hostname.key" > "$staging/tls.key"; then
    rm -rf "$staging"
    announce "failed cannot copy the pair for $hostname out of the proxy's store"
    return 1
  fi
  if ! usable "$staging"; then
    rm -rf "$staging"
    announce "failed the pair for $hostname is incomplete or mismatched, so the published one stays"
    return 1
  fi

  rm -rf "$target/versions/$version"
  mv "$staging" "$target/versions/$version" \
    || { announce "failed cannot name the new version under $target"; return 1; }
  if ! retain_fingerprint "$version" "$target/versions/$version/tls.crt"; then
    rm -rf "$target/versions/$version"
    announce "failed cannot retain the public fingerprint for $hostname"
    return 1
  fi
  # Two files cannot be renamed together, so the pair is swapped by renaming the one link that
  # names both of them.
  if ! ln -sfn "versions/$version" "$target/.next" || ! mv -T "$target/.next" "$target/current"; then
    announce "failed cannot swap $target/current, so the mail server still reads the pair before this one"
    return 1
  fi
  announce "ok published the certificate for $hostname as $version"
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
    rm -f "$target/fingerprints/$(basename "$version")"
    rm -rf "$version"
  done
  previous="$1"
}

# What was published before this run started, so a restart does not delete the pair a mail server
# may still have open.
previous="$(readlink "$target/current" 2>/dev/null | sed 's#versions/##')"
announced=""
mkdir -p "$target/versions" "$target/fingerprints" || report "cannot create directories under $target"
chmod 0755 "$target/fingerprints" || report "cannot make fingerprint metadata readable"
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
  # Each newline-delimited path and event mask is one inotifyd argument.
  # shellcheck disable=SC2086
  inotifyd - $armed >&3 2>/dev/null &
  watcher=$!
  publish
  # A directory that appeared while this round was arming carries its events to nobody, so the round
  # ends here rather than on an event that will never arrive.
  [ "$armed" = "$(watches)" ] && read -r _ <&3
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
done
