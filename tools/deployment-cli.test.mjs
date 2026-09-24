import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { executable } from "./deployment-archive.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
const deploy = join(repository, "deploy");
const bash = "/bin/bash";
const digest = "a".repeat(64);
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

function writeRecoveryChecksums(root) {
  const inventory = fileInventory(root);
  delete inventory.SHA256SUMS;
  writeFileSync(join(root, "SHA256SUMS"), `${Object.entries(inventory)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `${hash}  ${path}`).join("\n")}\n`, { mode: 0o600 });
}

function fixture(use, releaseVersion = "0.1.0") {
  const root = mkdtempSync(join(tmpdir(), "courtside-cli-"));
  const archive = join(root, `courtside-deployment-${releaseVersion}`);
  cpSync(deploy, archive, { recursive: true });
  writeFileSync(join(archive, "manifest.json"), `${JSON.stringify({
    schema: 1,
    version: releaseVersion,
    revision,
    image: `ghcr.io/jegr78/courtside@sha256:${digest}`,
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
  fi
  previous=$argument
done
if [ -f "${join(root, "docker-fail-match")}" ]; then
  failure=$(cat "${join(root, "docker-fail-match")}")
  case "$*" in *"$failure"*) exit 9 ;; esac
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
  *'ps -a --filter label=com.docker.compose.project='*'{{.Label "com.docker.compose.service"}}|{{.Image}}'*) if [ -f "${join(root, "docker-adoption-containers")}" ]; then cat "${join(root, "docker-adoption-containers")}"; else printf '%s\n' 'app|ghcr.io/jegr78/courtside@sha256:${digest}' 'db|postgres:17-alpine' 'proxy|caddy:2'; fi ;;
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
  try {
    return use({ root, archive, target: join(root, "instance"), dockerLog, environment });
  } finally {
    spawnSync("chmod", ["-R", "u+w", root]);
    rmSync(root, { recursive: true, force: true });
  }
}

function releaseArchive(root, version, imageDigest = "b".repeat(64)) {
  const archive = join(root, `candidate-release-${version}`);
  cpSync(deploy, archive, { recursive: true });
  writeFileSync(join(archive, "manifest.json"), `${JSON.stringify({
    schema: 1,
    version,
    revision: "fedcba9876543210fedcba9876543210fedcba98",
    image: `ghcr.io/jegr78/courtside@sha256:${imageDigest}`,
    signer: manifestSigner(version),
    recipes: ["existing-infrastructure", "full-self-hosted", "funnel", "standard"],
    files: fileInventory(archive),
  }, null, 2)}\n`);
  return archive;
}

function answers(root, changes = {}) {
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

function run(archive, target, args, environment = {}, input) {
  return spawnSync(bash, [join(archive, "courtside"), "--directory", target, ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, ...environment },
  });
}

function initialize(context, changes = {}, environment = {}) {
  return run(context.archive, context.target,
    ["init", "--answers", answers(context.root, changes), "--yes"],
    { ...context.environment, ...environment });
}

test("given a release archive, when init is confirmed, then it publishes one private versioned installation", () => {
  fixture((context) => {
    // given
    const result = initialize(context);

    // when
    const release = join(context.target, "releases", "0.1.0");

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Plan: install release 0\.1\.0 with recipe standard/);
    assert.equal(realpathSync(join(context.target, "current")), realpathSync(release));
    assert.equal(statSync(context.target).mode & 0o777, 0o700);
    assert.equal(statSync(join(context.target, "config")).mode & 0o777, 0o700);
    assert.equal(statSync(join(context.target, "secrets")).mode & 0o777, 0o700);
    assert.equal(statSync(join(context.target, "backups")).mode & 0o777, 0o700);
    assert.equal(statSync(join(context.target, "config", ".env")).mode & 0o777, 0o600);
    assert.equal(statSync(join(context.target, "config", "installation.conf")).mode & 0o777, 0o600);
    assert.ok(statSync(join(release, "courtside")).mode & 0o111);
    assert.equal(statSync(join(release, "courtside")).mode & 0o222, 0);
    assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"),
      /^schema=1\nrelease=0\.1\.0\nrevision=0123456789abcdef/m);
    const env = readFileSync(join(context.target, "config", ".env"), "utf8");
    assert.match(env, new RegExp(`COURTSIDE_IMAGE_DIGEST="${digest}"`));
    assert.match(env, /POSTGRES_PASSWORD="[0-9a-f]{48}"/);
    assert.match(env, /COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD="[0-9a-f]{48}"/);
    assert.match(readFileSync(join(context.target, "secrets", "bootstrap-admin-password"), "utf8"),
      /^[0-9a-f]{48}\n$/);
    assert.equal(statSync(join(context.target, "secrets", "bootstrap-admin-password")).mode & 0o777, 0o600);
    assert.doesNotMatch(result.stdout + result.stderr, /POSTGRES_PASSWORD|BOOTSTRAP_ADMIN_PASSWORD|[0-9a-f]{48}/);
    assert.deepEqual(readdirSync(join(context.target, "releases")).filter((name) => name.includes("partial")), []);
  });
});

test("given a nonempty unmarked directory, when init starts, then it preserves and refuses foreign state", () => {
  fixture((context) => {
    mkdirSync(context.target);
    const sentinel = join(context.target, "..operator-owned.txt");
    writeFileSync(sentinel, "keep\n");

    const result = initialize(context);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /not an empty or recognized Courtside root/);
    assert.equal(readFileSync(sentinel, "utf8"), "keep\n");
    assert.ok(!existsSync(join(context.target, "config")));
  });
});

test("given every recipe, when init validates its decisions, then the stored model names a supported Compose chain", () => {
  for (const recipe of ["standard", "full-self-hosted", "funnel", "existing-infrastructure"]) {
    fixture((context) => {
      // given
      const changes = recipe === "existing-infrastructure"
        ? { recipe, database_url: "jdbc:postgresql://database.example.org:5432/courtside",
          database_username: "courtside" }
        : { recipe };
      const environment = recipe === "existing-infrastructure"
        ? { COURTSIDE_DATABASE_PASSWORD: "database-private-value" }
        : {};

      // when
      const result = initialize(context, changes, environment);

      // then
      assert.equal(result.status, 0, `${recipe}: ${result.stderr}`);
      assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"),
        new RegExp(`^recipe=${recipe}$`, "m"));
    });
  }
});

test("given invalid answer data, when init plans it, then it refuses before publishing state", () => {
  for (const [change, message] of [
    [{ schema: "2" }, /reads schema 1/],
    [{ recipe: "../../outside" }, /invalid recipe/],
    [{ project: "club; touch escaped" }, /invalid project/],
    [{ source_url: "file:///private/source" }, /source_url must be an absolute HTTP or HTTPS URL/],
    [{ rootless_port_start: "not-a-port" }, /rootless_port_start must be a port/],
  ]) {
    fixture((context) => {
      // when
      const result = initialize(context, change);

      // then
      assert.equal(result.status, 2);
      assert.match(result.stderr, message);
      assert.ok(!existsSync(join(context.target, "current")));
      assert.ok(!existsSync(join(context.target, "config", "installation.conf")));
    });
  }
  fixture((context) => {
    const target = `${context.root}/safe/../escaped`;
    const result = run(context.archive, target,
      ["init", "--answers", answers(context.root), "--yes"], context.environment);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /must not contain \.\./);
    assert.ok(!existsSync(join(context.root, "escaped")));
  });
});

test("given an answer file containing a secret or an unknown key, when init reads it, then it names and refuses it", () => {
  fixture((context) => {
    // given
    const secret = answers(context.root);
    writeFileSync(secret, `${readFileSync(secret, "utf8")}database_password=hunter2\n`);
    const unknown = answers(context.root);
    writeFileSync(unknown, `${readFileSync(unknown, "utf8")}future_choice=yes\n`);

    // when / then
    const secretResult = run(context.archive, context.target, ["init", "--answers", secret, "--yes"],
      context.environment);
    assert.equal(secretResult.status, 2);
    assert.match(secretResult.stderr, /answer files contain decisions, never secrets: database_password/);
    assert.doesNotMatch(secretResult.stderr, /hunter2/);
    const unknownResult = run(context.archive, context.target, ["init", "--answers", unknown, "--yes"],
      context.environment);
    assert.equal(unknownResult.status, 2);
    assert.match(unknownResult.stderr, /unknown answer key future_choice/);
  });
});

test("given installation state redirects through a symlink, when init applies, then it refuses the external path", () => {
  fixture((context) => {
    // given
    const external = join(context.root, "external");
    mkdirSync(context.target);
    mkdirSync(external);
    symlinkSync(external, join(context.target, "secrets"));

    // when
    const result = initialize(context);

    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /secrets must not be a symbolic link/);
    assert.deepEqual(readdirSync(external), []);
    assert.ok(!existsSync(join(context.target, "config")));
  });
});

test("given an existing or locked installation, when init repeats, then it is deterministic and concurrent work is refused", () => {
  fixture((context) => {
    // given
    const first = initialize(context);
    const configuration = readFileSync(join(context.target, "config", "installation.conf"), "utf8");
    const secrets = readFileSync(join(context.target, "config", ".env"), "utf8");

    // when
    const repeated = initialize(context);
    mkdirSync(join(context.target, ".courtside.lock"));
    const locked = initialize(context);
    rmSync(join(context.target, ".courtside.lock"), { recursive: true });
    mkdirSync(join(context.target, ".courtside.lock"));
    writeFileSync(join(context.target, ".courtside.lock", "owner"), "99999999\n");
    const recovered = initialize(context);

    // then
    assert.equal(first.status, 0, first.stderr);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(readFileSync(join(context.target, "config", "installation.conf"), "utf8"), configuration);
    assert.equal(readFileSync(join(context.target, "config", ".env"), "utf8"), secrets);
    assert.equal(locked.status, 2);
    assert.match(locked.stderr, /another Courtside command holds/);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.ok(!existsSync(join(context.target, ".courtside.lock")));
  });
});

test("given a release file changes after installation, when lifecycle commands read it, then its manifest blocks execution", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const recipe = join(context.target, "releases", "0.1.0", "recipe.sh");
    chmodSync(recipe, 0o644);
    writeFileSync(recipe, `${readFileSync(recipe, "utf8")}\nexit 0\n`);
    chmodSync(recipe, 0o444);

    // when
    const doctor = run(context.archive, context.target, ["doctor", "--json"], context.environment);
    const up = run(context.archive, context.target, ["up"], context.environment);
    const repeated = initialize(context);

    // then
    assert.equal(doctor.status, 2);
    assert.match(JSON.stringify(JSON.parse(doctor.stdout)), /manifest digest/);
    assert.equal(up.status, 2);
    assert.match(up.stderr, /release integrity check failed/);
    assert.equal(repeated.status, 2);
    assert.match(repeated.stderr, /release integrity check failed/);
    assert.ok(!existsSync(context.dockerLog));
  });
});

test("given an installed release, when reconfigure is confirmed, then configuration changes atomically and local state stays", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const envPath = join(context.target, "config", ".env");
    const secretBefore = readFileSync(envPath, "utf8").match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1];
    const override = join(context.target, "config", "local.override.yaml");
    writeFileSync(override, "services:\n  app:\n    environment:\n      COURTSIDE_MEMORY: 2g\n");

    // when
    const result = run(context.archive, context.target,
      ["reconfigure", "--answers", answers(context.root, { recipe: "funnel" }), "--yes"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Plan: reconfigure recipe standard to funnel/);
    assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"), /^recipe=funnel$/m);
    assert.equal(readFileSync(envPath, "utf8").match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1], secretBefore);
    assert.ok(existsSync(override));
    assert.deepEqual(readdirSync(join(context.target, "config")).filter((name) => name.includes("partial")), []);
  });
});

test("given reconfiguration holds the installation lock, when up starts, then it cannot observe mixed state", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const lock = join(context.target, ".courtside.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner"), `${process.pid}\n`);

    // when
    const result = run(context.archive, context.target, ["up"], context.environment);

    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /another Courtside command holds/);
    assert.ok(!existsSync(context.dockerLog));
  });
});

test("given a crash crosses a configuration publish boundary, when the next command starts, then it completes the transaction", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const transaction = join(context.target, ".courtside-transaction");
    mkdirSync(transaction, { mode: 0o700 });
    const envPath = join(context.target, "config", ".env");
    const finalized = readFileSync(envPath, "utf8")
      .split("\n").filter((line) => !line.startsWith("COURTSIDE_BOOTSTRAP_ADMIN_")).join("\n");
    writeFileSync(join(transaction, ".env"), finalized, { mode: 0o600 });
    const configurationPath = join(context.target, "config", "installation.conf");
    writeFileSync(join(transaction, "installation.conf"),
      readFileSync(configurationPath, "utf8").replace("recipe=standard", "recipe=funnel"), { mode: 0o600 });
    writeFileSync(join(transaction, "remove-bootstrap"), "", { mode: 0o600 });
    writeFileSync(envPath, finalized, { mode: 0o600 });

    // when
    const status = run(context.archive, context.target, ["status"], context.environment);

    // then
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /recipe=funnel/);
    assert.match(status.stdout, /bootstrap=finalized/);
    assert.match(readFileSync(configurationPath, "utf8"), /^recipe=funnel$/m);
    assert.ok(!existsSync(transaction));
    assert.ok(!existsSync(join(context.target, "secrets", "bootstrap-admin-password")));
  });
});

test("given a recipe change needs an external secret, when reconfigure plans it, then it validates and preserves the secret", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const credential = "database-$#'\"\\private\\";
    const external = answers(context.root, { recipe: "existing-infrastructure",
      database_url: "jdbc:postgresql://database.example.org:5432/courtside",
      database_username: "courtside" });

    // when
    const refused = run(context.archive, context.target,
      ["reconfigure", "--answers", external, "--yes"], context.environment);
    const changed = run(context.archive, context.target,
      ["reconfigure", "--answers", external, "--yes"],
      { ...context.environment, COURTSIDE_DATABASE_PASSWORD: credential });
    const stored = readFileSync(join(context.target, "config", ".env"), "utf8")
      .match(/^COURTSIDE_DATABASE_PASSWORD=(.+)$/m)?.[1];
    const bundled = run(context.archive, context.target,
      ["reconfigure", "--answers", answers(context.root, { recipe: "funnel" }), "--yes"],
      context.environment);
    const model = join(context.root, "credential-compose.yaml");
    writeFileSync(model, "services:\n  probe:\n    image: scratch\n");
    const rendered = spawnSync(executable("docker"), ["compose", "--project-directory", context.root,
      "--env-file", join(context.target, "config", ".env"), "-f", model, "config", "--environment"],
    { encoding: "utf8" });

    // then
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /COURTSIDE_DATABASE_PASSWORD must be supplied/);
    assert.equal(changed.status, 0, changed.stderr);
    assert.equal(bundled.status, 0, bundled.stderr);
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.equal(rendered.stdout.split("\n").find((line) => line.startsWith("COURTSIDE_DATABASE_PASSWORD="))
      ?.slice("COURTSIDE_DATABASE_PASSWORD=".length), credential);
    const env = readFileSync(join(context.target, "config", ".env"), "utf8");
    assert.equal(env.match(/^COURTSIDE_DATABASE_PASSWORD=(.+)$/m)?.[1], stored);
    assert.notEqual(stored, credential);
    assert.doesNotMatch(refused.stdout + refused.stderr + changed.stdout + changed.stderr + bundled.stdout + bundled.stderr,
      /database-\$#/);
  });
});

test("given installation evidence, when doctor emits JSON, then warnings and failures have distinct states and exits", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recipe: "funnel" }).status, 0);

    // when
    const healthy = run(context.archive, context.target, ["doctor", "--json"], context.environment);
    writeFileSync(join(context.root, "curl-fail"), "yes\n");
    const unreachable = run(context.archive, context.target, ["doctor", "--json"], context.environment);
    rmSync(join(context.root, "curl-fail"));
    writeFileSync(join(context.target, "config", "local.override.yaml"), "services: {}\n");
    const warning = run(context.archive, context.target, ["doctor", "--json"], context.environment);
    chmodSync(join(context.target, "config", "local.override.yaml"), 0o666);
    const unsafeOverride = run(context.archive, context.target, ["doctor", "--json"], context.environment);
    chmodSync(join(context.target, "config", "local.override.yaml"), 0o644);
    const configurationPath = join(context.target, "config", "installation.conf");
    const configuration = readFileSync(configurationPath, "utf8");
    writeFileSync(configurationPath, configuration.replace("domain=courts.example.org", "domain=courts.example.org\tbad"));
    const malformed = run(context.archive, context.target, ["doctor", "--json"], context.environment);
    writeFileSync(configurationPath, configuration);
    chmodSync(join(context.target, "config", ".env"), 0o644);
    const unsafe = run(context.archive, context.target, ["doctor", "--json"], context.environment);
    lstatSync(join(context.target, "current"));
    const broken = run(context.archive, join(context.root, "missing"), ["doctor", "--json"], context.environment);

    // then
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.equal(JSON.parse(healthy.stdout).result, "PASS");
    assert.match(JSON.stringify(JSON.parse(healthy.stdout)), /local-listener/);
    assert.equal(unreachable.status, 2);
    assert.match(JSON.stringify(JSON.parse(unreachable.stdout)), /local-listener/);
    assert.equal(warning.status, 1, warning.stderr);
    const warningBody = JSON.parse(warning.stdout);
    assert.equal(warningBody.result, "WARN");
    assert.match(JSON.stringify(warningBody), /local\.override\.yaml/);
    assert.equal(unsafeOverride.status, 2);
    assert.equal(JSON.parse(unsafeOverride.stdout).result, "FAIL");
    assert.equal(malformed.status, 2);
    assert.equal(JSON.parse(malformed.stdout).result, "FAIL");
    assert.equal(unsafe.status, 2);
    assert.equal(JSON.parse(unsafe.stdout).result, "FAIL");
    assert.equal(broken.status, 2);
    assert.equal(JSON.parse(broken.stdout).result, "FAIL");
  });
});

test("given a forwarded-ingress installation with a stopped proxy, when doctor runs, then it reports the missing listener", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recipe: "funnel" }).status, 0);
    writeFileSync(join(context.root, "docker-components"), "app=healthy\nproxy=exited\n");

    // when
    const result = run(context.archive, context.target, ["doctor", "--json"], context.environment);

    // then
    assert.equal(result.status, 2);
    const body = JSON.parse(result.stdout);
    assert.equal(body.result, "FAIL");
    assert.match(JSON.stringify(body), /local-listener/);
    assert.doesNotMatch(JSON.stringify(body), /no runtime listener exists to probe/);
  });
});

test("given rootless Docker, when topology is selected, then only forwarded ingress is accepted", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { rootless_port_start: "1024" }).status, 2,
      "init must refuse the unsupported topology before doctor can inherit it");
  });
  for (const recipe of ["funnel", "existing-infrastructure"]) {
    fixture((context) => {
      const decisions = recipe === "existing-infrastructure"
        ? { recipe, rootless_port_start: "1024",
          database_url: "jdbc:postgresql://database.example.org:5432/courtside",
          database_username: "courtside" }
        : { recipe, rootless_port_start: "1024" };
      const environment = recipe === "existing-infrastructure"
        ? { COURTSIDE_DATABASE_PASSWORD: "database-private-value" }
        : {};
      assert.equal(initialize(context, decisions, environment).status, 0);
    });
  }
});

test("given an installation and local override, when up runs, then Docker receives only the selected files in order", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    writeFileSync(join(context.target, "config", "local.override.yaml"), "services: {}\n");

    // when
    const result = run(context.archive, context.target, ["up"], {
      ...context.environment,
      COURTSIDE_IMAGE_DIGEST: "b".repeat(64),
      POSTGRES_PASSWORD: "host-secret-must-not-win",
    });

    // then
    assert.equal(result.status, 0, result.stderr);
    const invocation = readFileSync(context.dockerLog, "utf8");
    assert.match(invocation, /compose --project-name example-club --project-directory .*\/current --env-file .*\/config\/\.env/);
    assert.match(invocation, /-f .*\/current\/compose\.yaml -f .*\/current\/compose\.caddy\.yaml/);
    assert.match(invocation, /-f .*\/config\/local\.override\.yaml up -d$/m);
    assert.doesNotMatch(invocation, /leaked|host-secret-must-not-win/);
  });
});

test("given the stored image digest drifts, when lifecycle validation runs, then Compose never receives it", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const envPath = join(context.target, "config", ".env");
    writeFileSync(envPath, readFileSync(envPath, "utf8").replace(digest, "b".repeat(64)));

    // when
    const up = run(context.archive, context.target, ["up"], context.environment);
    const doctor = run(context.archive, context.target, ["doctor", "--json"], context.environment);

    // then
    assert.equal(up.status, 2);
    assert.match(up.stderr, /image digest does not match installation\.conf/);
    assert.ok(!existsSync(context.dockerLog));
    assert.equal(doctor.status, 2);
    assert.equal(JSON.parse(doctor.stdout).result, "FAIL");
  });
});

test("given alternate Compose dotenv syntax shadows an image key, when up validates it, then parser differences fail closed", () => {
  for (const shadow of [
    `  COURTSIDE_IMAGE_DIGEST="${"b".repeat(64)}"`,
    `export COURTSIDE_IMAGE_DIGEST="${"b".repeat(64)}"`,
    `COURTSIDE_IMAGE_DIGEST: "${"b".repeat(64)}"`,
    `COURTSIDE_IMAGE_DIGEST = "${"b".repeat(64)}"`,
  ]) {
    fixture((context) => {
      // given
      assert.equal(initialize(context).status, 0);
      const envPath = join(context.target, "config", ".env");
      writeFileSync(envPath, `${readFileSync(envPath, "utf8")}${shadow}\n`);

      // when
      const result = run(context.archive, context.target, ["up"], context.environment);

      // then
      assert.equal(result.status, 2);
      assert.match(result.stderr, /not in canonical/);
      assert.ok(!existsSync(context.dockerLog));
    });
  }
});

test("given a running installation, when status and diagnose run, then operational states are separate and private data stays out", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    writeFileSync(join(context.target, "backups", "courtside.dump"), "private database rows\n");

    // when
    const status = run(context.archive, context.target, ["status"], context.environment);
    const diagnose = run(context.archive, context.target, ["diagnose"], context.environment);

    // then
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /infrastructure=healthy/);
    assert.match(status.stdout, /bootstrap=pending/);
    assert.match(status.stdout, /club_setup=unknown/);
    assert.match(status.stdout, /migration=application-startup/);
    assert.match(status.stdout, /component_health=app=healthy,mail=healthy/);
    assert.match(status.stdout, /mail_handover=running/);
    assert.match(status.stdout, /backup_age_seconds=/);
    assert.match(status.stdout, /free_storage_kib=/);
    assert.equal(diagnose.status, 0, diagnose.stderr);
    assert.match(diagnose.stdout, /release=0\.1\.0/);
    assert.doesNotMatch(diagnose.stdout + diagnose.stderr,
      /POSTGRES_PASSWORD|BOOTSTRAP_ADMIN_PASSWORD|member-private-value|private database rows|board@example\.org/);
  });
});

test("given verified recovery units and unrelated entries, when status and diagnose report backup age, then they use creation metadata", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    mkdirSync(join(context.target, "backups", "unrelated"));
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))
      .find((entry) => entry.startsWith("recovery-")));
    const oldDirectoryTime = new Date(Date.now() - 60_000);
    utimesSync(recovery, oldDirectoryTime, oldDirectoryTime);
    const systemDate = executable("date");
    const createdEpoch = Math.floor(Date.now() / 1000) - 5;
    writeFileSync(join(context.root, "bin", "date"), `#!/bin/sh
if [ "$1 $2" = '-u -d' ]; then
  case "$3" in
    ????-??-??T??:??:??Z) echo ${createdEpoch}; exit 0 ;;
    *) exit 1 ;;
  esac
fi
exec '${systemDate}' "$@"
`, { mode: 0o755 });

    // when
    const status = run(context.archive, context.target, ["status"], context.environment);
    const diagnose = run(context.archive, context.target, ["diagnose"], context.environment);

    // then
    const statusAge = Number(status.stdout.match(/backup_age_seconds=([0-9]+)/)?.[1]);
    const diagnoseAge = Number(diagnose.stdout.match(/backup_age_seconds=([0-9]+)/)?.[1]);
    assert.ok(statusAge < 30, `expected creation metadata age, received ${statusAge}`);
    assert.doesNotMatch(status.stdout, /backup_age_seconds=unknown/);
    assert.ok(diagnoseAge < 30, `expected creation metadata age, received ${diagnoseAge}`);
    assert.doesNotMatch(diagnose.stdout, /backup_age_seconds=unknown/);
  });
});

test("given corrupt and future-dated recovery units, when status reports backup age, then it ignores both", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))
      .find((entry) => entry.startsWith("recovery-")));
    writeFileSync(join(recovery, "database.dump"), "corrupt\n");
    const future = join(context.target, "backups", "recovery-future");
    cpSync(recovery, future, { recursive: true });
    const recoveryConfiguration = join(future, "recovery.conf");
    writeFileSync(recoveryConfiguration, readFileSync(recoveryConfiguration, "utf8")
      .replace(/^created_at=.*$/m, "created_at=29990101T000000Z"));
    writeRecoveryChecksums(future);

    // when
    const result = run(context.archive, context.target, ["status"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /backup_age_seconds=unknown/);
  });
});

test("given a replaced bootstrap password, when finalization is confirmed, then bootstrap secrets disappear atomically", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const envPath = join(context.target, "config", ".env");

    // when
    const refused = run(context.archive, context.target, ["finalize-bootstrap"], context.environment);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const result = run(context.archive, context.target, ["finalize-bootstrap", "--yes"], context.environment);

    // then
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /requires --yes/);
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf8");
    assert.doesNotMatch(env, /COURTSIDE_BOOTSTRAP_ADMIN_/);
    assert.ok(!existsSync(join(context.target, "secrets", "bootstrap-admin-password")));
    assert.match(env, /POSTGRES_PASSWORD=/);
    assert.equal(statSync(envPath).mode & 0o777, 0o600);
  });
});

test("given an installed instance, when uninstall keeps data, then no volume or local file is removed", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);

    // when
    const result = run(context.archive, context.target, ["uninstall", "--keep-data", "--yes"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    const invocation = readFileSync(context.dockerLog, "utf8");
    assert.match(invocation, / down$/m);
    assert.doesNotMatch(invocation, /--volumes|-v(?:\s|$)/);
    assert.ok(existsSync(join(context.target, "current")));
    assert.ok(existsSync(join(context.target, "config", ".env")));
    assert.ok(existsSync(join(context.target, "backups")));
  });
});

test("given an installed instance, when backup succeeds, then one private verified recovery unit is published", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    writeFileSync(join(context.target, "config", "local.override.yaml"), "services: {}\n");

    // when
    const result = run(context.archive, context.target, ["backup", "--retain", "2"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    const units = readdirSync(join(context.target, "backups"));
    assert.equal(units.length, 1);
    const recovery = join(context.target, "backups", units[0]);
    assert.equal(statSync(recovery).mode & 0o777, 0o700);
    assert.ok(existsSync(join(recovery, "database.dump")));
    assert.ok(existsSync(join(recovery, "configuration", "installation.conf")));
    assert.ok(existsSync(join(recovery, "configuration", ".env")));
    assert.ok(existsSync(join(recovery, "configuration", "local.override.yaml")));
    assert.ok(existsSync(join(recovery, "release", "manifest.json")));
    assert.ok(existsSync(join(recovery, "SHA256SUMS")));
    assert.match(readFileSync(join(recovery, "recovery.conf"), "utf8"), /^schema=1$/m);
    assert.match(readFileSync(join(recovery, "recovery.conf"), "utf8"), /^release=0\.1\.0$/m);
    assert.match(readFileSync(context.dockerLog, "utf8"), /pg_dump/);
    assert.match(readFileSync(context.dockerLog, "utf8"), /pg_restore --list/);
    assert.doesNotMatch(result.stdout + result.stderr, /POSTGRES_PASSWORD|member-private-value/);
  });
});

test("given self-hosted mail, when backup runs, then both Stalwart stores share one controlled interruption", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recipe: "full-self-hosted", mail_relay_host: "" }).status, 0);

    // when
    const result = run(context.archive, context.target, ["backup"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    assert.ok(existsSync(join(recovery, "mail-config.tar")));
    assert.ok(existsSync(join(recovery, "mail-data.tar")));
    assert.match(readFileSync(join(context.target, "config", ".env"), "utf8"),
      /^COURTSIDE_MAIL_PASSWORD="[0-9a-f]{48}"$/m);
    const invocations = readFileSync(context.dockerLog, "utf8");
    assert.match(invocations, / stop mail[\s\S]*mail-config[\s\S]*mail-data[\s\S]* up -d --wait mail/);
  });
});

test("given an interrupted mail backup marker, when the next managed command runs, then Stalwart is recovered", () => {
  fixture((context) => {
    assert.equal(initialize(context, { recipe: "full-self-hosted", mail_relay_host: "" }).status, 0);
    const marker = join(context.target, ".courtside-mail-backup-interrupted");
    writeFileSync(marker, "schema=1\n", { mode: 0o600 });
    rmSync(context.dockerLog, { force: true });

    const result = run(context.archive, context.target, ["status"], context.environment);

    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(marker));
    assert.match(readFileSync(context.dockerLog, "utf8"), / up -d --wait mail/);
  });
});

test("given external secret recovery and retention, when backups repeat, then secrets and foreign targets stay untouched", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recovery_material: "external-verified" }).status, 0);
    const sentinel = join(context.target, "backups", "operator-note");
    writeFileSync(sentinel, "keep\n");

    // when
    const first = run(context.archive, context.target, ["backup", "--retain", "1"], context.environment);
    const second = run(context.archive, context.target, ["backup", "--retain", "1"], context.environment);

    // then
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    const units = readdirSync(join(context.target, "backups")).filter((name) => name.startsWith("recovery-"));
    assert.equal(units.length, 1);
    const recovery = join(context.target, "backups", units[0]);
    assert.ok(!existsSync(join(recovery, "configuration", ".env")));
    assert.deepEqual(readdirSync(join(recovery, "secrets")), []);
    assert.equal(readFileSync(sentinel, "utf8"), "keep\n");
  });
});

test("given a custom image installation, when backup and restore-check run, then they use that exact image", () => {
  fixture((context) => {
    const customDigest = "c".repeat(64);
    const customImage = `registry.example.org/club/courtside@sha256:${customDigest}`;
    assert.equal(initialize(context, {
      overlays: "custom-image",
      custom_image_repository: "registry.example.org/club/courtside",
      custom_image_digest: customDigest,
    }).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    rmSync(context.dockerLog, { force: true });

    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment,
      COURTSIDE_RESTORE_USERNAME: "doe.jane",
      COURTSIDE_RESTORE_PASSWORD: "restore-private-value",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(readFileSync(join(recovery, "recovery.conf"), "utf8")
      .includes(`image=${customImage}\nimage_trust=custom\n`));
    assert.match(readFileSync(context.dockerLog, "utf8"), new RegExp(customDigest));
  });
});

test("given a backup command owns the installation lock, when another lifecycle command starts, then it does nothing", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    mkdirSync(join(context.target, ".courtside.lock"));
    writeFileSync(join(context.target, ".courtside.lock", "owner"), `${process.pid}\n`);

    // when
    const backup = run(context.archive, context.target, ["backup"], context.environment);
    const update = run(context.archive, context.target,
      ["update", "--archive", releaseArchive(context.root, "0.1.1"), "--yes"], context.environment);

    // then
    assert.equal(backup.status, 2);
    assert.equal(update.status, 2);
    assert.match(backup.stderr + update.stderr, /another Courtside command holds/);
    assert.ok(!existsSync(context.dockerLog));
  });
});

test("given a recovery unit, when restore-check runs, then it uses an empty PostgreSQL 17 target and probes restored behavior", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);

    // when
    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment,
      COURTSIDE_RESTORE_USERNAME: "doe.jane",
      COURTSIDE_RESTORE_PASSWORD: "restore-private-value",
      HTTP_PROXY: "http://attacker.invalid:8080",
      HTTPS_PROXY: "http://attacker.invalid:8080",
      ALL_PROXY: "socks5://attacker.invalid:1080",
      CURL_HOME: join(context.root, "hostile-curl-home"),
      HOME: join(context.root, "hostile-home"),
    });

    // then
    assert.equal(result.status, 0, result.stderr);
    const invocations = readFileSync(context.dockerLog, "utf8");
    assert.match(invocations, /ps -a --format json/);
    assert.match(readFileSync(join(recovery, "release", "compose.recovery-check.yaml"), "utf8"),
      /postgres:17-alpine@sha256:/);
    assert.match(invocations, /pg_restore .*--exit-on-error/);
    assert.match(invocations, / up -d --wait app/);
    const curlLog = readFileSync(join(context.root, "curl.log"), "utf8");
    assert.match(curlLog, /-q --noproxy \*.*api\/session[\s\S]*api\/public\/courts/);
    assert.doesNotMatch(curlLog, /leaked/);
    assert.doesNotMatch(result.stdout + result.stderr, /restore-private-value/);
  });
});

test("given a colliding restore volume, when restore-check starts, then it refuses without deleting it", () => {
  fixture((context) => {
    assert.equal(initialize(context).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    writeFileSync(join(context.root, "docker-volume-exists"), "yes\n");
    rmSync(context.dockerLog, { force: true });

    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment,
      COURTSIDE_RESTORE_USERNAME: "doe.jane",
      COURTSIDE_RESTORE_PASSWORD: "restore-private-value",
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /already has a database volume/);
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), / up | down /);
    assert.ok(existsSync(join(context.root, "docker-volume-exists")));
  });
});

test("given self-consistent modified backup code, when restore-check runs, then only the trusted installed release executes", () => {
  fixture((context) => {
    assert.equal(initialize(context).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    const copiedModel = join(recovery, "release", "compose.recovery-check.yaml");
    chmodSync(copiedModel, 0o600);
    writeFileSync(copiedModel, "services: {}\n");
    writeRecoveryChecksums(recovery);
    rmSync(context.dockerLog, { force: true });

    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment,
      COURTSIDE_RESTORE_USERNAME: "doe.jane",
      COURTSIDE_RESTORE_PASSWORD: "restore-private-value",
    });

    assert.equal(result.status, 0, result.stderr);
    const invocations = readFileSync(context.dockerLog, "utf8");
    assert.doesNotMatch(invocations, new RegExp(recovery.replaceAll("/", "\\/")));
    assert.match(invocations, new RegExp(join(context.target, "releases", "0.1.0").replaceAll("/", "\\/")));
  });
});

test("given restore failure after target creation, when restore-check exits, then it removes the isolated target", () => {
  fixture((context) => {
    assert.equal(initialize(context).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    writeFileSync(join(context.root, "docker-fail-match"), "pg_restore --clean");
    rmSync(context.dockerLog, { force: true });

    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment,
      COURTSIDE_RESTORE_USERNAME: "doe.jane",
      COURTSIDE_RESTORE_PASSWORD: "restore-private-value",
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /could not be restored transactionally/);
    assert.match(readFileSync(context.dockerLog, "utf8"), / down --volumes --remove-orphans/);
  });
});

test("given a corrupt recovery unit, when restore-check starts, then it refuses before creating a target", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    writeFileSync(join(recovery, "database.dump"), "changed\n");
    rmSync(context.dockerLog, { force: true });

    // when
    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment,
      COURTSIDE_RESTORE_USERNAME: "doe.jane",
      COURTSIDE_RESTORE_PASSWORD: "restore-private-value",
    });

    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /recovery checksum/);
    assert.ok(!existsSync(context.dockerLog));
  });
});

test("given a newer exact release, when update becomes healthy, then it selects only that verified release", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const next = releaseArchive(context.root, "0.1.1");

    // when
    const result = run(context.archive, context.target,
      ["update", "--archive", next, "--yes"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.equal(realpathSync(join(context.target, "current")),
      realpathSync(join(context.target, "releases", "0.1.1")));
    assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"), /^release=0\.1\.1$/m);
    assert.match(readFileSync(join(context.target, "config", ".env"), "utf8"),
      new RegExp(`^COURTSIDE_IMAGE_DIGEST="${"b".repeat(64)}"$`, "m"));
    assert.equal(readdirSync(join(context.target, "backups")).length, 1);
    const invocations = readFileSync(context.dockerLog, "utf8");
    assert.match(invocations, /image pull ghcr\.io\/jegr78\/courtside@sha256:/);
    assert.match(invocations, / stop app/);
    assert.match(invocations, / up -d --wait/);
    assert.doesNotMatch(invocations, / down .*--volumes| down --volumes/);
  });
});

test("given update pull or health failure, when update runs, then it reports the recoverable state without database rollback", () => {
  for (const [failure, expectedRelease] of [["image pull", "0.1.0"], ["up -d --wait", "0.1.1"]]) {
    fixture((context) => {
      // given
      assert.equal(initialize(context).status, 0);
      const next = releaseArchive(context.root, "0.1.1");
      writeFileSync(join(context.root, "docker-fail-match"), failure);

      // when
      const result = run(context.archive, context.target, ["update", "--archive", next, "--yes"],
        context.environment);

      // then
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /recovery unit/);
      assert.match(result.stderr, /database rollback was not attempted/);
      assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"),
        new RegExp(`^release=${expectedRelease.replaceAll(".", "\\.")}$`, "m"));
    });
  }
});

test("given the same or an older release, when update is requested, then Docker never runs it against the current schema", () => {
  for (const version of ["0.1.0", "0.0.9", "0.1.0-rc.9"]) {
    fixture((context) => {
      // given
      assert.equal(initialize(context).status, 0);
      const candidate = releaseArchive(context.root, version);

      // when
      const result = run(context.archive, context.target,
        ["update", "--archive", candidate, "--yes"], context.environment);

      // then
      assert.equal(result.status, 2);
      assert.match(result.stderr, /downgrade needs a complete recovery-unit restore/);
      assert.ok(!existsSync(context.dockerLog));
      assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"), /^release=0\.1\.0$/m);
    });
  }
});

test("given numeric release candidates, when update compares them, then semantic identifier order wins", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const older = releaseArchive(context.root, "0.1.0-rc.9");

    // when
    const result = run(context.archive, context.target,
      ["update", "--archive", older, "--yes"], context.environment);

    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /downgrade needs a complete recovery-unit restore/);
  }, "0.1.0-rc.10");

  fixture((context) => {
    assert.equal(initialize(context).status, 0);
    const newer = releaseArchive(context.root, "0.1.0-rc.11");
    const result = run(context.archive, context.target,
      ["update", "--archive", newer, "--yes"], context.environment);
    assert.equal(result.status, 0, result.stderr);
  }, "0.1.0-rc.10");
});

test("given consecutive nightly archives, when update compares their run identifiers, then the later run is newer", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const newer = releaseArchive(context.root, "0.1.0-nightly.101");

    // when
    const result = run(context.archive, context.target,
      ["update-check", "--archive", newer], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /update=available/);
  }, "0.1.0-nightly.100");
});

test("given a branch nightly manifest, when init reads its claimed signer, then it refuses the unofficial archive", () => {
  fixture((context) => {
    // given
    const manifest = join(context.archive, "manifest.json");
    const body = JSON.parse(readFileSync(manifest, "utf8"));
    body.signer = "https://github.com/jegr78/courtside/.github/workflows/nightly-image.yml@refs/heads/feature";
    writeFileSync(manifest, `${JSON.stringify(body, null, 2)}\n`);

    // when
    const result = initialize(context);

    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /does not bind nightly/);
  }, "0.1.0-nightly.100");
});

test("given a recovery unit from the prior release, when the installation has updated, then its own image validates it", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const next = releaseArchive(context.root, "0.1.1");
    assert.equal(run(context.archive, context.target,
      ["update", "--archive", next, "--yes"], context.environment).status, 0);
    const recovery = join(context.target, "backups",
      readdirSync(join(context.target, "backups")).find((name) => name.includes("-0.1.0-")));

    // when
    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment,
      COURTSIDE_RESTORE_USERNAME: "doe.jane",
      COURTSIDE_RESTORE_PASSWORD: "restore-private-value",
    });

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Recovery unit .*0\.1\.0.* passed login and domain-data probes/);
  });
});

test("given configuration from before recovery material was explicit, when update runs, then it migrates to included recovery", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const configuration = join(context.target, "config", "installation.conf");
    writeFileSync(configuration, readFileSync(configuration, "utf8")
      .split("\n").filter((line) => !line.startsWith("recovery_material=")).join("\n"));
    const next = releaseArchive(context.root, "0.1.1");

    // when
    const result = run(context.archive, context.target,
      ["update", "--archive", next, "--yes"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(configuration, "utf8"), /^recovery_material=included$/m);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    assert.ok(existsSync(join(recovery, "configuration", ".env")));
  });
});

test("given an existing Compose project, when adopt analyses it, then analysis is read-only and ambiguity is refused", () => {
  fixture((context) => {
    // given
    const source = join(context.root, "existing.env");
    writeFileSync(source, 'COURTSIDE_IMAGE_DIGEST="' + digest + '"\n');
    writeFileSync(join(context.root, "docker-compose-list"),
      '[{"Name":"example-club","Status":"running(2)"}]\n');
    writeFileSync(join(context.root, "docker-volumes"), "example-club_db\n");

    // when
    const result = run(context.archive, context.target,
      ["adopt", "--analyze", "--project", "example-club", "--environment", source], context.environment);
    writeFileSync(join(context.root, "docker-compose-list"),
      '[{"Name":"example-club"},{"Name":"example-club-old"}]\n');
    const ambiguous = run(context.archive, context.target,
      ["adopt", "--analyze", "--project", "example-club", "--environment", source], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /analysis=adoptable/);
    assert.ok(!existsSync(join(context.target, "config")));
    assert.equal(ambiguous.status, 2);
    assert.match(ambiguous.stderr, /ambiguous ownership/);
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), / down| rm| stop| up/);
  });
});

test("given unambiguous ownership, when adoption is applied, then existing identities are recorded without resource changes", () => {
  fixture((context) => {
    // given
    const sourceTarget = join(context.root, "source-instance");
    assert.equal(run(context.archive, sourceTarget,
      ["init", "--answers", answers(context.root), "--yes"], context.environment).status, 0);
    const environment = join(sourceTarget, "config", ".env");
    const before = readFileSync(environment, "utf8");
    writeFileSync(join(context.root, "docker-compose-list"), '[{"Name":"example-club"}]\n');
    writeFileSync(join(context.root, "docker-volumes"), "example-club_db\n");
    rmSync(context.dockerLog, { force: true });

    // when
    const result = run(context.archive, context.target,
      ["adopt", "--apply", "--project", "example-club", "--environment", environment,
        "--answers", answers(context.root), "--yes"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(context.target, "config", ".env"), "utf8"), before);
    assert.equal(realpathSync(join(context.target, "current")),
      realpathSync(join(context.target, "releases", "0.1.0")));
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), / down| rm| stop| up/);
  });
});

test("given the adoption source changes during validation, when apply publishes, then it uses the validated snapshot", () => {
  fixture((context) => {
    const sourceTarget = join(context.root, "source-instance");
    assert.equal(run(context.archive, sourceTarget,
      ["init", "--answers", answers(context.root), "--yes"], context.environment).status, 0);
    const environment = join(sourceTarget, "config", ".env");
    const before = readFileSync(environment, "utf8");
    writeFileSync(join(context.root, "docker-compose-list"), '[{"Name":"example-club"}]\n');
    writeFileSync(join(context.root, "docker-volumes"), "example-club_db\n");
    writeFileSync(join(context.root, "docker-mutate-adoption-source"), environment);

    const result = run(context.archive, context.target,
      ["adopt", "--apply", "--project", "example-club", "--environment", environment,
        "--answers", answers(context.root), "--yes"], context.environment);

    assert.equal(result.status, 0, result.stderr);
    assert.notEqual(readFileSync(environment, "utf8"), before);
    assert.equal(readFileSync(join(context.target, "config", ".env"), "utf8"), before);
  });
});

test("given an unsafe adopted bundled database password, when apply starts, then it refuses SQL-capable input", () => {
  fixture((context) => {
    const sourceTarget = join(context.root, "source-instance");
    assert.equal(run(context.archive, sourceTarget,
      ["init", "--answers", answers(context.root), "--yes"], context.environment).status, 0);
    const environment = join(sourceTarget, "config", ".env");
    writeFileSync(environment, readFileSync(environment, "utf8").replace(/^POSTGRES_PASSWORD=.*$/m,
      'POSTGRES_PASSWORD="a\'; SELECT pg_sleep(10); --"'));
    writeFileSync(join(context.root, "docker-compose-list"), '[{"Name":"example-club"}]\n');
    writeFileSync(join(context.root, "docker-volumes"), "example-club_db\n");

    const result = run(context.archive, context.target,
      ["adopt", "--apply", "--project", "example-club", "--environment", environment,
        "--answers", answers(context.root), "--yes"], context.environment);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /generated 48-character hexadecimal password/);
    assert.ok(!existsSync(context.target));
  });
});

test("given misleading Compose ownership labels, when adoption is analysed, then it refuses the project", () => {
  fixture((context) => {
    const source = join(context.root, "existing.env");
    writeFileSync(source, 'COURTSIDE_IMAGE_DIGEST="' + digest + '"\n');
    writeFileSync(join(context.root, "docker-compose-list"), '[{"Name":"example-club"}]\n');
    writeFileSync(join(context.root, "docker-volumes"), "example-club_db\n");
    writeFileSync(join(context.root, "docker-adoption-containers"),
      "app|ghcr.io/foreign/application@sha256:" + digest + "\n");

    const result = run(context.archive, context.target,
      ["adopt", "--analyze", "--project", "example-club", "--environment", source], context.environment);
    rmSync(join(context.root, "docker-adoption-containers"));
    writeFileSync(join(context.root, "docker-volume-labels"), "foreign-project|db\n");
    const foreignStorage = run(context.archive, context.target,
      ["adopt", "--analyze", "--project", "example-club", "--environment", source], context.environment);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /does not run the selected immutable image/);
    assert.equal(foreignStorage.status, 2);
    assert.match(foreignStorage.stderr, /inconsistent Compose labels/);
    assert.ok(!existsSync(context.target));
  });
});

test("given an adopted environment cannot render, when apply is requested, then no local state or resource changes occur", () => {
  fixture((context) => {
    // given
    const sourceTarget = join(context.root, "source-instance");
    assert.equal(run(context.archive, sourceTarget,
      ["init", "--answers", answers(context.root), "--yes"], context.environment).status, 0);
    writeFileSync(join(context.root, "docker-compose-list"), '[{"Name":"example-club"}]\n');
    writeFileSync(join(context.root, "docker-volumes"), "example-club_db\n");
    writeFileSync(join(context.root, "docker-fail-match"), "config --quiet");

    // when
    const result = run(context.archive, context.target,
      ["adopt", "--apply", "--project", "example-club",
        "--environment", join(sourceTarget, "config", ".env"),
        "--answers", answers(context.root), "--yes"], context.environment);

    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /does not render/);
    assert.ok(!existsSync(context.target));
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), / down| rm| stop| up/);
  });
});

test("given matching adoption services but foreign storage topology, when apply is requested, then it publishes nothing", () => {
  fixture((context) => {
    const sourceTarget = join(context.root, "source-instance");
    assert.equal(run(context.archive, sourceTarget,
      ["init", "--answers", answers(context.root), "--yes"], context.environment).status, 0);
    writeFileSync(join(context.root, "docker-compose-list"), '[{"Name":"example-club"}]\n');
    writeFileSync(join(context.root, "docker-volumes"), "example-club_foreign\n");
    writeFileSync(join(context.root, "docker-volume-labels"), "example-club|foreign\n");

    const result = run(context.archive, context.target,
      ["adopt", "--apply", "--project", "example-club",
        "--environment", join(sourceTarget, "config", ".env"),
        "--answers", answers(context.root), "--yes"], context.environment);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /volume set does not match/);
    assert.ok(!existsSync(context.target));
  });
});

test("given an installed secret, when one identity rotates, then unrelated identities stay byte-identical", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recipe: "full-self-hosted", mail_relay_host: "" }).status, 0);
    const envPath = join(context.target, "config", ".env");
    const before = readFileSync(envPath, "utf8");

    // when
    const result = run(context.archive, context.target,
      ["rotate-secret", "mail-reload", "--yes"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    const after = readFileSync(envPath, "utf8");
    assert.notEqual(after.match(/^COURTSIDE_MAIL_RELOAD_PASSWORD=(.+)$/m)?.[1],
      before.match(/^COURTSIDE_MAIL_RELOAD_PASSWORD=(.+)$/m)?.[1]);
    for (const key of ["POSTGRES_PASSWORD", "COURTSIDE_MAIL_ADMIN_PASSWORD", "COURTSIDE_MAIL_SETUP_PASSWORD"]) {
      assert.equal(after.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1],
        before.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]);
    }
    assert.match(readFileSync(context.dockerLog, "utf8"), / up -d --wait mail-reload/);
    assert.doesNotMatch(result.stdout + result.stderr, /[0-9a-f]{48}/);
  });
});

test("given separate database identities, when the runtime identity rotates, then owner and migration stay unchanged", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { overlays: "database-identities" }).status, 0);
    const paths = Object.fromEntries(["owner", "migration", "runtime"].map((name) =>
      [name, join(context.target, "secrets", `database-${name}-password`)]));
    const before = Object.fromEntries(Object.entries(paths).map(([name, path]) =>
      [name, readFileSync(path, "utf8")]));

    // when
    const result = run(context.archive, context.target,
      ["rotate-secret", "database-runtime", "--yes"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(paths.owner, "utf8"), before.owner);
    assert.equal(readFileSync(paths.migration, "utf8"), before.migration);
    assert.notEqual(readFileSync(paths.runtime, "utf8"), before.runtime);
    assert.match(readFileSync(context.dockerLog, "utf8"), /psql .*courtside_owner[\s\S]*up -d --wait app/);
  });
});

test("given a durable interrupted rotation, when that identity is retried, then old state is recovered first", () => {
  fixture((context) => {
    assert.equal(initialize(context).status, 0);
    const environmentPath = join(context.target, "config", ".env");
    const oldEnvironment = readFileSync(environmentPath, "utf8");
    const newEnvironment = oldEnvironment.replace(/^POSTGRES_PASSWORD=.*$/m,
      'POSTGRES_PASSWORD="' + "b".repeat(48) + '"');
    writeFileSync(environmentPath, newEnvironment, { mode: 0o600 });
    const journal = join(context.target, ".courtside-rotation");
    mkdirSync(journal, { mode: 0o700 });
    writeFileSync(join(journal, "meta"), "name=postgres\nkind=env\n", { mode: 0o600 });
    writeFileSync(join(journal, "old.env"), oldEnvironment, { mode: 0o600 });
    writeFileSync(join(journal, "new.env"), newEnvironment, { mode: 0o600 });

    const result = run(context.archive, context.target,
      ["rotate-secret", "postgres", "--yes"], context.environment);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Recovered interrupted postgres rotation/);
    assert.ok(!existsSync(journal));
    assert.doesNotMatch(readFileSync(environmentPath, "utf8"), new RegExp("b{48}"));
  });
});

test("given an atomically retired rotation journal, when the next command starts, then it discards the tombstone", () => {
  fixture((context) => {
    assert.equal(initialize(context).status, 0);
    const tombstone = join(context.target, ".rotation.complete.interrupted");
    mkdirSync(tombstone, { mode: 0o700 });
    writeFileSync(join(tombstone, "old.env"), "discard\n", { mode: 0o600 });

    const result = run(context.archive, context.target, ["status"], context.environment);

    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(tombstone));
  });
});

test("given local and external mail, when mail-check runs, then only the local service is asserted", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recipe: "full-self-hosted", mail_relay_host: "" }).status, 0);

    // when
    const local = run(context.archive, context.target, ["mail-check"], context.environment);

    // then
    assert.equal(local.status, 0, local.stderr);
    assert.match(readFileSync(context.dockerLog, "utf8"), /--profile mail-check run --rm mail-check/);
  });
  fixture((context) => {
    assert.equal(initialize(context).status, 0);
    const external = run(context.archive, context.target, ["mail-check"], context.environment);
    assert.equal(external.status, 1);
    assert.match(external.stdout, /external-relay-is-operator-owned/);
  });
});

test("given synthetic Mailpit, when status and mail-check run, then the controlled handover is reported", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recipe: "funnel", synthetic_mail: "true" }).status, 0);
    writeFileSync(join(context.root, "docker-ps-json"),
      '[{"Service":"app","State":"running","Health":"healthy"},{"Service":"mailpit","State":"running","Health":"healthy"},{"Service":"proxy","State":"running","Health":""}]\n');
    writeFileSync(join(context.root, "docker-components"), "app=healthy\nmailpit=healthy\nproxy=running\n");

    // when
    const status = run(context.archive, context.target, ["status"], context.environment);
    const checked = run(context.archive, context.target, ["mail-check"], context.environment);

    // then
    assert.match(status.stdout, /mail_handover=synthetic/);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /mail_check=pass/);
    assert.match(checked.stdout, /synthetic-mailpit-running/);
  });
});

test("given bootstrap is still live, when finalization has no verified backup, then it keeps the credential", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);

    // when
    const refused = run(context.archive, context.target, ["finalize-bootstrap", "--yes"], context.environment);
    const backup = run(context.archive, context.target, ["backup"], context.environment);
    const completed = run(context.archive, context.target, ["finalize-bootstrap", "--yes"], context.environment);

    // then
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /verified backup/);
    assert.equal(backup.status, 0, backup.stderr);
    assert.equal(completed.status, 0, completed.stderr);
    assert.ok(!existsSync(join(context.target, "secrets", "bootstrap-admin-password")));
  });
});

test("given destructive removal, when the exact installation phrase is confirmed, then only its project and path are removed", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const phrase = `delete example-club at ${realpathSync(context.target)}`;

    // when
    const refused = run(context.archive, context.target,
      ["uninstall", "--destroy", "--confirm", "delete example-club"], context.environment);
    assert.equal(refused.status, 2);
    assert.ok(existsSync(context.target));
    const removed = run(context.archive, context.target,
      ["uninstall", "--destroy", "--confirm", phrase], context.environment);

    // then
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!existsSync(context.target));
    assert.match(readFileSync(context.dockerLog, "utf8"), / down --volumes --remove-orphans/);
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), /system prune|volume prune/);
  });
});

test("given current becomes a dangling symlink, when destructive removal runs, then it does not chmod the symlink", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const phrase = `delete example-club at ${realpathSync(context.target)}`;
    const systemChmod = executable("chmod");
    writeFileSync(join(context.root, "bin", "chmod"), `#!/bin/sh
last=''
for argument in "$@"; do last=$argument; done
if [ -L "$last" ]; then
  printf '%s\n' 'refusing chmod on symbolic link' >&2
  exit 91
fi
exec '${systemChmod}' "$@"
`, { mode: 0o755 });

    // when
    const removed = run(context.archive, context.target,
      ["uninstall", "--destroy", "--confirm", phrase], context.environment);

    // then
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!existsSync(context.target));
  });
});

test("given a protected parent directory, when destructive removal empties the installation, then it reports the privileged final rmdir without failing", () => {
  fixture((context) => {
    // given
    const protectedParent = join(context.root, "protected");
    const target = join(protectedParent, "instance");
    mkdirSync(protectedParent);
    assert.equal(run(context.archive, target,
      ["init", "--answers", answers(context.root), "--yes"], context.environment).status, 0);
    const phrase = `delete example-club at ${realpathSync(target)}`;
    chmodSync(protectedParent, 0o500);

    // when
    let removed;
    try {
      removed = run(context.archive, target,
        ["uninstall", "--destroy", "--confirm", phrase], context.environment);
    } finally {
      chmodSync(protectedParent, 0o700);
    }

    // then
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(existsSync(target));
    assert.deepEqual(readdirSync(target), []);
    assert.match(removed.stdout, /sudo rmdir --/);
  });
});

test("given a writable parent and an unexpected rmdir failure, when destructive removal finishes, then it reports failure", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const phrase = `delete example-club at ${realpathSync(context.target)}`;
    const systemRmdir = executable("rmdir");
    writeFileSync(join(context.root, "bin", "rmdir"), `#!/bin/sh
case "$*" in
  *'/instance') exit 1 ;;
  *) exec '${systemRmdir}' "$@" ;;
esac
`, { mode: 0o755 });

    // when
    const removed = run(context.archive, context.target,
      ["uninstall", "--destroy", "--confirm", phrase], context.environment);

    // then
    assert.equal(removed.status, 2);
    assert.match(removed.stderr, /could not remove the empty installation path/);
  });
});

test("given an unknown installation entry, when destructive removal is confirmed, then it preserves the root", () => {
  fixture((context) => {
    assert.equal(initialize(context).status, 0);
    const sentinel = join(context.target, "..operator-owned.txt");
    writeFileSync(sentinel, "keep\n");
    const phrase = `delete example-club at ${realpathSync(context.target)}`;

    const result = run(context.archive, context.target,
      ["uninstall", "--destroy", "--confirm", phrase], context.environment);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /unowned installation entry/);
    assert.equal(readFileSync(sentinel, "utf8"), "keep\n");
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), / down --volumes/);
  });
});

test("given scheduler examples, when the archive is inspected, then they install or enable nothing", () => {
  for (const file of ["examples/courtside-backup.service", "examples/courtside-backup.timer",
    "examples/courtside-maintenance.cron"]) {
    const path = join(deploy, file);
    assert.ok(existsSync(path), `${file} is missing`);
    const content = readFileSync(path, "utf8");
    assert.doesNotMatch(content, /systemctl\s+(?:enable|start)|apt(?:-get)?|dnf|yum|crontab\s/);
    if (!file.endsWith(".timer")) assert.match(content, /\/srv\/courtside\/current\/courtside/);
  }
});

test("given no answer file, when init is used interactively, then it plans and confirms before writing", () => {
  fixture((context) => {
    // given
    const input = ["standard", "example-club", "courts.example.org", "admin", "Jane Doe",
      "https://github.com/example/courtside", "courts.example.org", "board@example.org",
      "smtp.example.org", "", "yes"].join("\n") + "\n";

    // when
    const result = run(context.archive, context.target, ["init"], context.environment, input);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Plan: install release 0\.1\.0 with recipe standard/);
    assert.ok(existsSync(join(context.target, "config", "installation.conf")));
  });
});
