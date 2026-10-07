#!/bin/sh
set -eu
umask 077
/bin/mkdir /tmp/courtside-browser-runtime
/bin/cp /scripts/chromium-headless.sh /tmp/courtside-browser-runtime/chromium
/bin/chmod 700 /tmp/courtside-browser-runtime/chromium
exec /usr/bin/k6 "$@"
