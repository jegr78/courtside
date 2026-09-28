import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync,
  writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { executable } from "./deployment-archive.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
export const deploy = join(repository, "deploy");
const bash = "/bin/bash";
export const digest = "a".repeat(64);
const revision = "0123456789abcdef0123456789abcdef01234567";

function manifestSigner(version) {
  return version.includes("-nightly.")
    ? "https://github.com/jegr78/courtside/.github/workflows/nightly-image.yml@refs/heads/main"
    : `https://github.com/jegr78/courtside/.github/workflows/release.yml@refs/tags/v${version}`;
}

function fileInventory(root, relative = "") {
  return Object.fromEntries(readdirSync(join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return Object.entries(fileInventory(root, path));
      return [[path, createHash("sha256").update(readFileSync(join(root, path))).digest("hex")]];
    }));
}

export function writeRecoveryChecksums(root) {
  const inventory = fileInventory(root);
  delete inventory.SHA256SUMS;
  writeFileSync(join(root, "SHA256SUMS"), `${Object.entries(inventory)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `${hash}  ${path}`).join("\n")}\n`, { mode: 0o600 });
}

export function fixture(use, releaseVersion = "0.1.0") {
  const root = mkdtempSync(join(tmpdir(), "courtside-cli-"));
  const archive = join(root, `courtside-deployment-${releaseVersion}`);
  cpSync(deploy, archive, { recursive: true });
  writeFileSync(join(archive, "manifest.json"), `${JSON.stringify({
    schema: 1,
    version: releaseVersion,
    revision,
    image: `ghcr.io/jegr78/courtside@sha256:${digest}`,
    bookingSeedImage: `ghcr.io/jegr78/courtside@sha256:${"b".repeat(64)}`,
    signer: manifestSigner(releaseVersion),
    recipes: ["existing-infrastructure", "full-self-hosted", "funnel", "standard"],
    files: fileInventory(archive),
  }, null, 2)}\n`);
  const bin = join(root, "bin");
  const dockerLog = join(root, "docker.log");
  mkdirSync(bin);
  writeFileSync(join(bin, "docker"), `#!/bin/sh
if [ "$1 $2" = "compose version" ]; then echo 'Docker Compose version v2.33.1'; exit 0; fi
if [ "$1" = "info" ]; then printf '%s\\n' "\${FAKE_DOCKER_SECURITY:-[]}"; exit 0; fi
printf '%s\\n' "$*" >> "${dockerLog}"
previous=''
for argument in "$@"; do
  if [ "$previous" = '--env-file' ] && [ -f "$argument" ]; then
    sed -n 's/^COURTSIDE_RECOVERY_IMAGE_//p' "$argument" | sed 's/^/recovery-image=/' >> "${dockerLog}"
    sed -n '/^COURTSIDE_BOOKING_SEED_/p' "$argument" >> "${dockerLog}"
  fi
  previous=$argument
done
if [ -f "${join(root, "docker-fail-match")}" ]; then
  failure=$(cat "${join(root, "docker-fail-match")}")
  case "$*" in *"$failure"*) exit 9 ;; esac
fi
if [ -f "${join(root, "docker-fail-target-health")}" ]; then
  case "$*" in
    *'compose.database-upgrade.yaml'*) ;;
    *' up -d --wait'*) rm -f "${join(root, "docker-fail-target-health")}"; exit 9 ;;
  esac
fi
case "$*" in
  *' config --hash '*)
    if [ -f "${join(root, "docker-mutate-adoption-source")}" ]; then
      source=$(cat "${join(root, "docker-mutate-adoption-source")}")
      printf '%s\n' 'COURTSIDE_MAIL_REPLY_TO="changed@example.org"' >> "$source"
      rm -f "${join(root, "docker-mutate-adoption-source")}"
    fi
    ;;
esac
[ "\${COURTSIDE_IMAGE_DIGEST+x}" != x ] || printf '%s\\n' 'leaked COURTSIDE_IMAGE_DIGEST' >> "${dockerLog}"
[ "\${POSTGRES_PASSWORD+x}" != x ] || printf '%s\\n' 'leaked POSTGRES_PASSWORD' >> "${dockerLog}"
case "$*" in
  *' pg_dump '*) printf '%s\\n' 'PGDMP courtside fixture' ;;
  *' pg_restore --list'*) cat >/dev/null ;;
  *"select count(*) from pg_tables where schemaname = 'public'"*) printf '%s\\n' '0' ;;
  *' tar -C /source -cf - .'*) printf '%s\\n' 'TAR courtside fixture' ;;
  *'compose ls --format json') [ ! -f "${join(root, "docker-compose-list")}" ] || cat "${join(root, "docker-compose-list")}" ;;
  *'volume ls --filter label=com.docker.compose.project='*) [ ! -f "${join(root, "docker-volumes")}" ] || cat "${join(root, "docker-volumes")}" ;;
  *'volume inspect '*'--format'*) if [ -f "${join(root, "docker-volume-labels")}" ]; then cat "${join(root, "docker-volume-labels")}"; else printf '%s\n' 'example-club|db'; fi ;;
  *'volume inspect '*) [ -f "${join(root, "docker-volume-exists")}" ] && exit 0 || exit 1 ;;
  *'network ls --filter label=com.docker.compose.project='*) printf '%s\n' 'example-club_default' ;;
  *'network inspect '*'--format'*) printf '%s\n' 'example-club|default' ;;
  *'ps -a --filter label=com.docker.compose.project='*'{{.Label "com.docker.compose.service"}}|{{.Image}}'*) if [ -f "${join(root, "docker-adoption-containers")}" ]; then cat "${join(root, "docker-adoption-containers")}"; else printf '%s\n' 'app|ghcr.io/jegr78/courtside@sha256:${digest}' 'db|postgres:18-alpine' 'proxy|caddy:2'; fi ;;
  *'ps -a --filter label=com.docker.compose.project='*'com.docker.compose.config-hash'*) printf '%s\n' 'app hash-app' 'db hash-db' 'proxy hash-proxy' ;;
  *'ps -a --filter label=com.docker.compose.project='*'{{.Label "com.docker.compose.service"}}'*) if [ -f "${join(root, "docker-adoption-services")}" ]; then cat "${join(root, "docker-adoption-services")}"; else printf '%s\n' 'app' 'db' 'proxy'; fi ;;
  *' config --services') if [ -f "${join(root, "docker-expected-services")}" ]; then cat "${join(root, "docker-expected-services")}"; else printf '%s\n' 'app' 'db' 'proxy'; fi ;;
  *' config --hash *') printf '%s\n' 'app hash-app' 'db hash-db' 'proxy hash-proxy' ;;
  *' config --volumes') printf '%s\n' 'db' ;;
  *' config --networks') printf '%s\n' 'default' ;;
  *' ps -a --format json') printf '%s\\n' '[]' ;;
  *' port app 8080') printf '%s\\n' '127.0.0.1:49152' ;;
  *' ps --format json') if [ -f "${join(root, "docker-ps-json")}" ]; then cat "${join(root, "docker-ps-json")}"; else printf '%s\\n' '[{"Service":"app","State":"running","Health":"healthy"},{"Service":"mail","State":"running","Health":"healthy"},{"Service":"proxy","State":"running","Health":""}]'; fi ;;
  *' ps --format {{.Service}}='*) if [ -f "${join(root, "docker-components")}" ]; then cat "${join(root, "docker-components")}"; else printf '%s\\n' 'app=healthy' 'mail=healthy' 'proxy=running'; fi ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(bin, "curl"), `#!/bin/sh
printf '%s\\n' "$*" >> "${join(root, "curl.log")}"
[ ! -f "${join(root, "curl-fail")}" ] || exit 22
[ "\${HTTP_PROXY+x}" != x ] || printf '%s\\n' 'leaked HTTP_PROXY' >> "${join(root, "curl.log")}"
[ "\${HTTPS_PROXY+x}" != x ] || printf '%s\\n' 'leaked HTTPS_PROXY' >> "${join(root, "curl.log")}"
[ "\${ALL_PROXY+x}" != x ] || printf '%s\\n' 'leaked ALL_PROXY' >> "${join(root, "curl.log")}"
[ "\${CURL_HOME+x}" != x ] || printf '%s\\n' 'leaked CURL_HOME' >> "${join(root, "curl.log")}"
[ "\${HOME+x}" != x ] || printf '%s\\n' 'leaked HOME' >> "${join(root, "curl.log")}"
previous=''
for argument in "$@"; do
  if [ "$previous" = '-c' ]; then
    printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' '127.0.0.1' 'FALSE' '/' 'FALSE' '0' 'XSRF-TOKEN' 'restore-xsrf' > "$argument"
  fi
  previous=$argument
done
case "$*" in
  *'/api/session'*) printf '%s\\n' '{"authenticated":true}' ;;
  *'/api/public/courts'*) printf '%s\\n' '[{"id":"court-1"}]' ;;
esac
`, { mode: 0o755 });
  const environment = {
    PATH: `${bin}:${process.env.PATH}`,
    COURTSIDE_TEST_SECRET: "member-private-value",
  };
  const chmod = executable("chmod");
  try {
    return use({ root, archive, target: join(root, "instance"), dockerLog, environment });
  } finally {
    spawnSync(chmod, ["-R", "u+w", root]);
    rmSync(root, { recursive: true, force: true });
  }
}

export function releaseArchive(root, version, imageDigest = "b".repeat(64)) {
  const archive = join(root, `candidate-release-${version}`);
  cpSync(deploy, archive, { recursive: true });
  writeFileSync(join(archive, "manifest.json"), `${JSON.stringify({
    schema: 1,
    version,
    revision: "fedcba9876543210fedcba9876543210fedcba98",
    image: `ghcr.io/jegr78/courtside@sha256:${imageDigest}`,
    bookingSeedImage: `ghcr.io/jegr78/courtside@sha256:${"c".repeat(64)}`,
    signer: manifestSigner(version),
    recipes: ["existing-infrastructure", "full-self-hosted", "funnel", "standard"],
    files: fileInventory(archive),
  }, null, 2)}\n`);
  return archive;
}

export function usePostgres17(archive) {
  const compose = join(archive, "compose.yaml");
  writeFileSync(compose, readFileSync(compose, "utf8")
    .replace(/postgres:18-alpine@sha256:[a-f0-9]{64}/,
      `postgres:17-alpine@sha256:${"1".repeat(64)}`)
    .replace("db:/var/lib/postgresql", "db:/var/lib/postgresql/data")
    .replace(/^\s+name: \$\{COURTSIDE_DATABASE_VOLUME[^\n]*\}\n/m, ""));
  const manifest = join(archive, "manifest.json");
  const body = JSON.parse(readFileSync(manifest, "utf8"));
  rmSync(manifest);
  body.files = fileInventory(archive);
  writeFileSync(manifest, `${JSON.stringify(body, null, 2)}\n`);
}

export function useLegacyPostgres18(archive) {
  const compose = join(archive, "compose.yaml");
  writeFileSync(compose, readFileSync(compose, "utf8")
    .replace(/^\s+name: \$\{COURTSIDE_DATABASE_VOLUME[^\n]*\}\n/m, ""));
  const manifest = join(archive, "manifest.json");
  const body = JSON.parse(readFileSync(manifest, "utf8"));
  rmSync(manifest);
  body.files = fileInventory(archive);
  writeFileSync(manifest, `${JSON.stringify(body, null, 2)}\n`);
}

export function answers(root, changes = {}) {
  const values = {
    schema: "1",
    recipe: "standard",
    overlays: "",
    synthetic_mail: "false",
    rootless_port_start: "",
    project: "example-club",
    domain: "courts.example.org",
    bootstrap_username: "admin",
    bootstrap_display_name: "Jane Doe",
    source_url: "https://github.com/example/courtside",
    mail_domain: "courts.example.org",
    mail_reply_to: "board@example.org",
    mail_relay_host: "smtp.example.org",
    mail_relay_username: "",
    database_url: "",
    database_username: "",
    ...changes,
  };
  const file = join(root, `answers-${Math.random().toString(16).slice(2)}.conf`);
  writeFileSync(file, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
  return file;
}

export function run(archive, target, args, environment = {}, input) {
  return spawnSync(bash, [join(archive, "courtside"), "--directory", target, ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, ...environment },
  });
}

export function initialize(context, changes = {}, environment = {}) {
  return run(context.archive, context.target,
    ["init", "--answers", answers(context.root, changes), "--yes"],
    { ...context.environment, ...environment });
}

export function makeInstalledManifestLegacy(target) {
  const release = realpathSync(join(target, "current"));
  const manifest = join(release, "manifest.json");
  const body = JSON.parse(readFileSync(manifest, "utf8"));
  delete body.bookingSeedImage;
  chmodSync(manifest, 0o600);
  writeFileSync(manifest, `${JSON.stringify(body, null, 2)}\n`);
  chmodSync(manifest, 0o400);
  const digest = createHash("sha256").update(readFileSync(manifest)).digest("hex");
  const configuration = join(target, "config", "installation.conf");
  writeFileSync(configuration, readFileSync(configuration, "utf8")
    .replace(/^release_manifest_sha256=.*$/m, `release_manifest_sha256=${digest}`));
}
