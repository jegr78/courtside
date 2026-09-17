import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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

function fileInventory(root, relative = "") {
  return Object.fromEntries(readdirSync(join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return Object.entries(fileInventory(root, path));
      return [[path, createHash("sha256").update(readFileSync(join(root, path))).digest("hex")]];
    }));
}

function fixture(use) {
  const root = mkdtempSync(join(tmpdir(), "courtside-cli-"));
  const archive = join(root, "courtside-deployment-0.1.0");
  cpSync(deploy, archive, { recursive: true });
  writeFileSync(join(archive, "manifest.json"), `${JSON.stringify({
    schema: 1,
    version: "0.1.0",
    revision,
    image: `ghcr.io/jegr78/courtside@sha256:${digest}`,
    signer: "https://github.com/jegr78/courtside/.github/workflows/release.yml@refs/tags/v0.1.0",
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
[ "\${COURTSIDE_IMAGE_DIGEST+x}" != x ] || printf '%s\\n' 'leaked COURTSIDE_IMAGE_DIGEST' >> "${dockerLog}"
[ "\${POSTGRES_PASSWORD+x}" != x ] || printf '%s\\n' 'leaked POSTGRES_PASSWORD' >> "${dockerLog}"
case "$*" in
  *' ps --format json') printf '%s\\n' '[{"Service":"app","State":"running","Health":"healthy"},{"Service":"mail","State":"running","Health":"healthy"}]' ;;
  *' ps --format {{.Service}}='*) printf '%s\\n' 'app=healthy' 'mail=healthy' ;;
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
    assert.equal(initialize(context).status, 0);

    // when
    const healthy = run(context.archive, context.target, ["doctor", "--json"], context.environment);
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

test("given a replaced bootstrap password, when finalization is confirmed, then bootstrap secrets disappear atomically", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const envPath = join(context.target, "config", ".env");

    // when
    const refused = run(context.archive, context.target, ["finalize-bootstrap"], context.environment);
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
