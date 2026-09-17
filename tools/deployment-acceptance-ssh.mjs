import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const supportedRecipes = new Set(["standard", "full-self-hosted", "existing-infrastructure", "funnel"]);

export function validateAcceptanceRequest(request) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:@[A-Za-z0-9][A-Za-z0-9.-]*)?$/.test(request.host ?? "")) {
    throw new Error("acceptance host is invalid");
  }
  if (!/^courtside-[a-z0-9]+(?:-[a-z0-9]+)+$/.test(request.namespace ?? "")) {
    throw new Error("acceptance namespace is invalid");
  }
  if (!supportedRecipes.has(request.recipe)) throw new Error("acceptance recipe is invalid");
  if (!/^\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.zip$/.test(request.archive ?? "")
      || request.archive.includes("/../")) {
    throw new Error("acceptance archive path must be an absolute zip path");
  }
  if (!/^\/(?:[A-Za-z0-9._-]+\/)+courtside-[a-z0-9-]+$/.test(request.remoteRoot ?? "")
      || !request.remoteRoot.endsWith(`/${request.namespace}`) || request.remoteRoot.includes("/../")) {
    throw new Error("acceptance root path must end in the confirmed namespace");
  }
  if (!/^[0-9a-f]{64}$/.test(request.archiveSha256 ?? "")) {
    throw new Error("acceptance archive digest is invalid");
  }
  if (!/^[0-9a-f]{40}$/.test(request.revision ?? "")) throw new Error("acceptance revision is invalid");
  if (!/^[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/.test(request.image ?? "")) {
    throw new Error("acceptance image is invalid");
  }
  const expected = `qualify ${request.namespace} at ${request.remoteRoot}`;
  if (request.confirm !== expected) throw new Error(`acceptance needs exact confirmation: ${expected}`);
}

export function acceptanceInvocation(request) {
  validateAcceptanceRequest(request);
  const script = `set -euo pipefail
decode() { printf '%s' "$1" | base64 --decode; }
namespace=$(decode "$1")
root=$(decode "$2")
source_archive=$(decode "$3")
recipe=$(decode "$4")
archive_sha256=$(decode "$5")
revision=$(decode "$6")
image=$(decode "$7")
installation="$root/installation"
release="$root/release"
input="$root/qualification-input"
case "$root" in
  */"$namespace") ;;
  *) printf 'remote root does not match namespace\\n' >&2; exit 2 ;;
esac
test "$root" != / && test "$root" != /srv && test "$root" != /tmp
test -f "$source_archive"
test -d "$root"
test ! -L "$root"
test "$(realpath "$root")" = "$root"
test -O "$root"
test "$(stat -c '%a' "$root")" = 700
test -f "$root/answers.conf"
test ! -L "$root/answers.conf"
test -O "$root/answers.conf"
test "$(stat -c '%a' "$root/answers.conf")" = 600
test "$(find "$root" -mindepth 1 -maxdepth 1 -printf '%f\n')" = answers.conf
test ! -e "$installation"
test ! -e "$release"
test ! -e "$input"
install -d -m 0700 "$input"
install -m 0600 "$source_archive" "$input/candidate.zip"
archive="$input/candidate.zip"
entries=$(unzip -Z1 "$archive")
test -n "$entries"
if printf '%s\\n' "$entries" | awk '
  /^\// || /\\\\/ { exit 1 }
  { count = split($0, parts, "/"); if (parts[1] !~ /^courtside-deployment-[A-Za-z0-9.+-]+$/) exit 1 }
  { for (part = 1; part <= count; part++) if (parts[part] == "..") exit 1 }
'; then :; else printf 'archive contains an unsafe path\n' >&2; exit 2; fi
test "$(printf '%s\\n' "$entries" | cut -d/ -f1 | LC_ALL=C sort -u | wc -l | tr -d ' ')" = 1
test -z "$(printf '%s\\n' "$entries" | LC_ALL=C sort | uniq -d)"
if zipinfo -l "$archive" | awk '$1 ~ /^[lbcps]/ { unsafe = 1 } END { exit unsafe }'; then :;
else printf 'archive contains an unsafe file type\n' >&2; exit 2; fi
printf '%s  %s\\n' "$archive_sha256" "$archive" | sha256sum -c -
archive_prefix=$(printf '%s\\n' "$entries" | cut -d/ -f1 | LC_ALL=C sort -u)
manifest=$(unzip -p "$archive" "$archive_prefix/manifest.json")
printf '%s\\n' "$manifest" | grep -Fqx "  \\"revision\\": \\"$revision\\","
printf '%s\\n' "$manifest" | grep -Fqx "  \\"image\\": \\"$image\\","
install -d -m 0700 "$release"
unzip -q "$archive" -d "$release"
archive_root=$(find "$release" -mindepth 1 -maxdepth 1 -type d -name 'courtside-deployment-*' -print -quit)
test -n "$archive_root"
grep -qx "recipe=$recipe" "$root/answers.conf"
"$archive_root/courtside" --directory "$installation" init --answers "$root/answers.conf" --yes
"$installation/current/courtside" doctor --json
"$installation/current/courtside" up
"$installation/current/courtside" status
"$installation/current/courtside" backup --retain 2
recovery=$(find "$installation/backups" -mindepth 1 -maxdepth 1 -type d -name 'recovery-*' -print | sort | tail -n 1)
test -n "$recovery"
"$installation/current/courtside" restore-check --recovery "$recovery"
"$installation/current/courtside" up
"$installation/current/courtside" status
`;
  return {
    executable: "ssh",
    args: ["--", request.host, "bash", "-s", "--", ...[request.namespace, request.remoteRoot,
      request.archive, request.recipe, request.archiveSha256, request.revision, request.image]
      .map((value) => Buffer.from(value).toString("base64"))],
    script,
  };
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`deployment-acceptance-ssh needs --${name}`);
  return process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const request = { host: option("host"), archive: option("archive"), namespace: option("namespace"),
    remoteRoot: option("remote-root"), recipe: option("recipe"), confirm: option("confirm"),
    archiveSha256: option("archive-sha256"), revision: option("revision"), image: option("image") };
  const invocation = acceptanceInvocation(request);
  const result = spawnSync(invocation.executable, invocation.args, {
    input: invocation.script,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
