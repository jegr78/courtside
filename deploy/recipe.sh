#!/usr/bin/env bash
set -euo pipefail

readonly schema_version=1
readonly overlay_order="database-identities database-tls database-tls-local app-tls"
readonly usage="usage: recipe.sh files <recipe> [--overlay <name>]... [--synthetic-mail] [--rootless-port-start <port>]"

refuse() {
  printf 'recipe: %s\n' "$1" >&2
  exit 2
}

contains() {
  case " $1 " in
    *" $2 "*) return 0 ;;
  esac
  return 1
}

read_recipe() {
  local file=$1 line key value seen="" number=0
  schema="" ingress="" database="" mail=""
  while IFS= read -r line || [ -n "$line" ]; do
    number=$((number + 1))
    case "$line" in
      "" | "#"*) continue ;;
    esac
    if ! [[ "$line" =~ ^([a-z]+)=([a-z0-9-]+)$ ]]; then
      refuse "$(basename "$file") line $number is malformed"
    fi
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    contains "$seen" "$key" && refuse "$(basename "$file"): $key is declared twice"
    seen="$seen $key"
    case "$key" in
      schema) schema=$value ;;
      ingress) ingress=$value ;;
      database) database=$value ;;
      mail) mail=$value ;;
      *) refuse "$(basename "$file"): unknown key $key" ;;
    esac
  done < "$file"

  [ -n "$schema" ] || refuse "$(basename "$file") declares no schema"
  [ "$schema" = "$schema_version" ] \
    || refuse "$(basename "$file") is schema $schema, and this resolver reads schema $schema_version"
  [ -n "$ingress" ] || refuse "$(basename "$file") declares no ingress"
  [ -n "$database" ] || refuse "$(basename "$file") declares no database"
  [ -n "$mail" ] || refuse "$(basename "$file") declares no mail"
  contains "caddy external funnel" "$ingress" || refuse "$(basename "$file"): unknown ingress $ingress"
  contains "bundled external" "$database" || refuse "$(basename "$file"): unknown database $database"
  contains "smtp-relay stalwart" "$mail" || refuse "$(basename "$file"): unknown mail $mail"
}

require_port() {
  local component=$1 port=$2
  if [ -n "$rootless_port_start" ] && [ "$port" -lt "$rootless_port_start" ]; then
    refuse "$component binds port $port, which rootless Docker cannot bind while unprivileged ports start at $rootless_port_start"
  fi
}

files() {
  [ $# -ge 1 ] || refuse "$usage"
  local name=$1 overlays="" synthetic="" overlay
  rootless_port_start=""
  shift
  [[ "$name" =~ ^[a-z][a-z-]*$ ]] || refuse "unknown recipe $name"

  while [ $# -gt 0 ]; do
    case "$1" in
      --overlay)
        [ $# -ge 2 ] || refuse "--overlay needs a name"
        contains "$overlay_order" "$2" || refuse "unknown overlay $2"
        contains "$overlays" "$2" && refuse "$2 is named twice"
        overlays="$overlays $2"
        shift 2
        ;;
      --synthetic-mail)
        [ -z "$synthetic" ] || refuse "--synthetic-mail is named twice"
        synthetic=yes
        shift
        ;;
      --rootless-port-start)
        [ $# -ge 2 ] && [[ "$2" =~ ^[0-9]{1,5}$ ]] && [ "$2" -le 65535 ] \
          || refuse "--rootless-port-start needs a port number"
        rootless_port_start=$2
        shift 2
        ;;
      *) refuse "unknown option $1" ;;
    esac
  done

  local recipe
  recipe="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recipes/$name.recipe"
  [ -f "$recipe" ] || refuse "unknown recipe $name"
  read_recipe "$recipe"

  if [ "$mail" = "stalwart" ] && [ "$ingress" != "caddy" ]; then
    refuse "$name runs Stalwart, which takes its certificate from the Caddy ingress, and has none"
  fi
  if [ -n "$synthetic" ] && [ "$mail" != "smtp-relay" ]; then
    refuse "synthetic mail replaces an external SMTP relay, and $name runs its own mail server"
  fi
  if contains "$overlays" app-tls && [ "$ingress" != "caddy" ]; then
    refuse "app-tls needs the Caddy ingress, and $name has none"
  fi
  for overlay in database-identities database-tls-local; do
    if contains "$overlays" "$overlay" && [ "$database" != "bundled" ]; then
      refuse "$overlay needs the bundled database, and $name uses an external one"
    fi
  done
  if contains "$overlays" database-tls-local && ! contains "$overlays" database-tls; then
    refuse "database-tls-local needs database-tls, or the application does not verify what the database serves"
  fi
  if contains "$overlays" database-tls && [ "$database" = "bundled" ] && ! contains "$overlays" database-tls-local; then
    refuse "database-tls with the bundled database needs database-tls-local, or the application verifies a database that serves no certificate"
  fi
  if [ "$ingress" = "caddy" ]; then
    require_port Caddy 80
  fi
  if [ "$mail" = "stalwart" ]; then
    require_port Stalwart 25
  fi

  echo compose.yaml
  # Compose applies a reset only against what earlier files set, so the identity overlay has to drop
  # the shared credential before any other component writes the same environment map.
  contains "$overlays" database-identities && echo compose.database-identities.yaml
  [ "$database" = "external" ] && echo compose.external-database.yaml
  [ "$ingress" = "caddy" ] && echo compose.caddy.yaml
  if [ -n "$synthetic" ]; then
    echo compose.mailpit.yaml
  else
    echo "compose.$mail.yaml"
  fi
  for overlay in $overlay_order; do
    if [ "$overlay" != database-identities ] && contains "$overlays" "$overlay"; then
      echo "compose.$overlay.yaml"
    fi
  done
  return 0
}

case "${1:-}" in
  files)
    shift
    files "$@"
    ;;
  *) refuse "$usage" ;;
esac
