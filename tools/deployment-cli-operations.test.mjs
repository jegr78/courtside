import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync,
  writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { executable } from "./deployment-archive.mjs";
import { writeRecoveryChecksums, fixture, releaseArchive, run, initialize } from "./deployment-cli-fixture.mjs";

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
    const systemDate = executable("date");
    // The CLI reads the system clock, which a shifted Node clock does not move.
    const systemEpoch = Number(spawnSync(systemDate, ["+%s"], { encoding: "utf8" }).stdout);
    assert.ok(Number.isInteger(systemEpoch), "the system clock must report whole seconds");
    utimesSync(recovery, systemEpoch - 60, systemEpoch - 60);
    const createdEpoch = systemEpoch - 5;
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

test("given an installed UAT instance, when booking seed is previewed and applied, then only apply backs up and writes", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const environmentFile = join(context.target, "config", ".env");
    writeFileSync(environmentFile, `${readFileSync(environmentFile, "utf8")}COURTSIDE_ENVIRONMENT="UAT"\n`);

    // when
    const preview = run(context.archive, context.target, ["seed-bookings"], context.environment);
    const apply = run(context.archive, context.target,
      ["seed-bookings", "--confirm", "seed bookings in example-club"], context.environment);

    // then
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(apply.status, 0, apply.stderr);
    const invocation = readFileSync(context.dockerLog, "utf8");
    assert.match(invocation, /compose\.booking-seed\.yaml .*run --rm --no-deps app/);
    assert.match(invocation, new RegExp(`COURTSIDE_BOOKING_SEED_IMAGE=ghcr.io/jegr78/courtside@sha256:${"b".repeat(64)}`));
    assert.match(invocation, /COURTSIDE_BOOKING_SEED_WRITE=false/);
    assert.match(invocation, /COURTSIDE_BOOKING_SEED_WRITE=true/);
    assert.equal((invocation.match(/ pg_dump /g) ?? []).length, 1);
  });
});

test("given a production installation or the wrong confirmation, when booking seed starts, then it writes nothing", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);

    // when
    const production = run(context.archive, context.target, ["seed-bookings"], context.environment);
    const environmentFile = join(context.target, "config", ".env");
    writeFileSync(environmentFile, `${readFileSync(environmentFile, "utf8")}COURTSIDE_ENVIRONMENT="UAT"\n`);
    const unconfirmed = run(context.archive, context.target,
      ["seed-bookings", "--confirm", "example-club"], context.environment);
    writeFileSync(join(context.target, "config", "local.override.yaml"), "services: {}\n");
    const overridden = run(context.archive, context.target,
      ["seed-bookings", "--confirm", "seed bookings in example-club"], context.environment);

    // then
    assert.equal(production.status, 2);
    assert.match(production.stderr, /only available when COURTSIDE_ENVIRONMENT is UAT/);
    assert.equal(unconfirmed.status, 2);
    assert.match(unconfirmed.stderr, /requires --confirm 'seed bookings in example-club'/);
    assert.equal(overridden.status, 2);
    assert.match(overridden.stderr, /refuses an installation with a local Compose override/);
    assert.ok(!existsSync(context.dockerLog)
      || !/compose\.booking-seed\.yaml| pg_dump /.test(readFileSync(context.dockerLog, "utf8")));
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

test("given a recovery unit, when restore-check runs, then it uses an empty PostgreSQL 18 target and probes restored behavior", () => {
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
      /postgres:18-alpine@sha256:/);
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
