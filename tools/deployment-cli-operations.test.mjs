import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync,
  realpathSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { executable } from "./deployment-archive.mjs";
import { writeRecoveryChecksums, fixture, releaseArchive, run, initialize } from "./deployment-cli-fixture.mjs";

test("given a retained mail transition recovery unit, when backups are pruned, then its original release remains recoverable", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const backups = join(context.target, "backups");
    const original = join(backups, readdirSync(backups)[0]);
    const history = join(backups, "mail-transition-test");
    mkdirSync(history, { mode: 0o700 });
    writeFileSync(join(history, "state"), `recovery=${realpathSync(original)}\n`, { mode: 0o600 });
    const newer = original.replace(/-[0-9]+$/, "-999999");
    cpSync(original, newer, { recursive: true });
    // when
    const result = run(context.archive, context.target, ["prune", "--retain", "1"], context.environment);
    // then
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(original), true, "the original mail store format needs its complete recovery unit");
    assert.equal(existsSync(newer), true, result.stdout);
  });
});

test("given explicitly selected mail stores, when backup runs, then it captures the selected pair", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recipe: "full-self-hosted", mail_relay_host: "" }).status, 0);
    const file = join(context.target, "config", ".env");
    writeFileSync(file, `${readFileSync(file, "utf8")}COURTSIDE_MAIL_CONFIG_VOLUME="example-club_mail-config-stalwart1-test"\nCOURTSIDE_MAIL_DATA_VOLUME="example-club_mail-data-stalwart1-test"\n`);
    writeFileSync(context.dockerLog, "");
    // when
    const result = run(context.archive, context.target, ["backup"], context.environment);
    // then
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(context.dockerLog, "utf8");
    assert.match(calls, /example-club_mail-config-stalwart1-test:\/source:ro/);
    assert.match(calls, /example-club_mail-data-stalwart1-test:\/source:ro/);
    assert.doesNotMatch(calls, /example-club_mail-(config|data):\/source/);
  });
});

for (const values of [
  'COURTSIDE_MAIL_CONFIG_VOLUME="example-club_mail-config-test"\n',
  'COURTSIDE_MAIL_CONFIG_VOLUME="foreign_config"\nCOURTSIDE_MAIL_DATA_VOLUME="foreign_data"\n',
  'COURTSIDE_MAIL_CONFIG_VOLUME="example-club_mail-config-a"\nCOURTSIDE_MAIL_DATA_VOLUME="example-club_mail-data-b"\n',
  'COURTSIDE_MAIL_CONFIG_VOLUME="example-club_mail-config-../bad"\nCOURTSIDE_MAIL_DATA_VOLUME="example-club_mail-data-../bad"\n',
]) {
  test(`given an unsafe mail store pair ${JSON.stringify(values)}, when up runs, then it refuses before Docker`, () => {
    fixture((context) => {
      // given
      assert.equal(initialize(context, { recipe: "full-self-hosted", mail_relay_host: "" }).status, 0);
      const file = join(context.target, "config", ".env");
      writeFileSync(file, readFileSync(file, "utf8") + values);
      writeFileSync(context.dockerLog, "");
      // when
      const result = run(context.archive, context.target, ["up"], context.environment);
      // then
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /mail store/);
      assert.equal(readFileSync(context.dockerLog, "utf8"), "");
    });
  });
}

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
    assert.match(readFileSync(context.dockerLog, "utf8"), / down --remove-orphans/);
    assert.match(readFileSync(context.dockerLog, "utf8"), /volume rm .*_mfa-keys/);
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

function updatedTwice(context) {
  assert.equal(initialize(context).status, 0);
  for (const version of ["0.1.1", "0.1.2"]) {
    const result = run(context.archive, context.target,
      ["update", "--archive", releaseArchive(context.root, version), "--yes"], context.environment);
    assert.equal(result.status, 0, result.stderr);
  }
  const units = readdirSync(join(context.target, "backups")).filter((name) => name.startsWith("recovery-")).sort();
  assert.deepEqual(units.map((unit) => readFileSync(join(context.target, "backups", unit, "recovery.conf"), "utf8")
    .match(/^release=(.*)$/m)[1]), ["0.1.0", "0.1.1"], "each update keeps a unit of the release it replaced");
  return units;
}

test("given three releases and two recovery units, when prune keeps one unit, then only the current release and "
  + "the release that unit restores remain", () => {
  fixture((context) => {
    // given
    const units = updatedTwice(context);

    // when
    const result = run(context.archive, context.target, ["prune", "--retain", "1"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(join(context.target, "backups")).filter((name) => name.startsWith("recovery-")),
      [units[1]]);
    assert.deepEqual(readdirSync(join(context.target, "releases")).sort(), ["0.1.1", "0.1.2"],
      "restore-check needs the installed release a kept unit names");
    assert.match(result.stdout, new RegExp(`^Removed recovery unit .*${units[0]}$`, "m"));
    assert.match(result.stdout, /^Removed release 0\.1\.0$/m);
  });
});

test("given recovery units within the retention, when prune runs, then every release a unit restores is kept", () => {
  fixture((context) => {
    // given
    const units = updatedTwice(context);

    // when
    const result = run(context.archive, context.target, ["prune"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readdirSync(join(context.target, "backups")).filter((name) => name.startsWith("recovery-")).length,
      units.length, "the default keeps seven units, as backup does");
    assert.deepEqual(readdirSync(join(context.target, "releases")).sort(), ["0.1.0", "0.1.1", "0.1.2"]);
    assert.match(result.stdout, /^Nothing to remove$/m);
  });
});

test("given a dry run, when prune runs, then it names what it would remove and removes nothing", () => {
  fixture((context) => {
    // given
    const units = updatedTwice(context);

    // when
    const result = run(context.archive, context.target, ["prune", "--retain", "1", "--dry-run"],
      context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^Would remove recovery unit .*${units[0]}$`, "m"));
    assert.match(result.stdout, /^Would remove release 0\.1\.0$/m);
    assert.equal(readdirSync(join(context.target, "backups")).filter((name) => name.startsWith("recovery-")).length, 2);
    assert.deepEqual(readdirSync(join(context.target, "releases")).sort(), ["0.1.0", "0.1.1", "0.1.2"]);
  });
});

test("given a retention that is not a positive count, when prune starts, then it removes nothing", () => {
  fixture((context) => {
    // given
    updatedTwice(context);

    // when
    const results = ["0", "-1", "two"].map((retain) =>
      run(context.archive, context.target, ["prune", "--retain", retain], context.environment));

    // then
    for (const result of results) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /prune retention must be a positive count/);
    }
    assert.deepEqual(readdirSync(join(context.target, "releases")).sort(), ["0.1.0", "0.1.1", "0.1.2"]);
    assert.equal(readdirSync(join(context.target, "backups")).filter((name) => name.startsWith("recovery-")).length, 2);
  });
});

test("given an operator's own copy and a stray file beside the recovery units, when prune keeps one unit, then "
  + "neither counts against retention and the release the copy restores stays", () => {
  fixture((context) => {
    // given
    const units = updatedTwice(context);
    const backups = join(context.target, "backups");
    cpSync(join(backups, units[0]), join(backups, "recovery-keep-before-pg18"), { recursive: true });
    writeFileSync(join(backups, "recovery-notes"), "operator notes\n");

    // when
    const result = run(context.archive, context.target, ["prune", "--retain", "1"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(backups).sort(), [units[1], "recovery-keep-before-pg18", "recovery-notes"].sort(),
      "a name prune did not write is the operator's, and sorting it as newest would delete the real newest unit");
    assert.deepEqual(readdirSync(join(context.target, "releases")).sort(), ["0.1.0", "0.1.1", "0.1.2"],
      "the copy still restores 0.1.0");
  });
});

test("given backups that rotated away the update's unit, when prune runs, then the release the last update "
  + "replaced stays beside the current one", () => {
  fixture((context) => {
    // given
    updatedTwice(context);
    for (const [release, seconds] of [["0.1.0", 1000], ["0.1.1", 2000], ["0.1.2", 3000]]) {
      utimesSync(join(context.target, "releases", release), seconds, seconds);
    }
    for (let backup = 0; backup < 2; backup += 1) {
      const result = run(context.archive, context.target, ["backup", "--retain", "1"], context.environment);
      assert.equal(result.status, 0, result.stderr);
    }

    // when
    const result = run(context.archive, context.target, ["prune", "--retain", "1"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(join(context.target, "releases")).sort(), ["0.1.1", "0.1.2"],
      "going back to the previous release, or to its PostgreSQL volume, needs that release installed");
  });
});

test("given entries in releases that are not installed releases, when prune runs, then it leaves them alone",
  () => {
    fixture((context) => {
      // given
      updatedTwice(context);
      const releases = join(context.target, "releases");
      chmodSync(releases, 0o700);
      mkdirSync(join(releases, "operator notes"));
      mkdirSync(join(releases, "0.0.9"));
      symlinkSync(join(context.root), join(releases, "0.0.8"));

      // when
      const result = run(context.archive, context.target, ["prune", "--retain", "1"], context.environment);

      // then
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(readdirSync(releases).sort(), ["0.0.8", "0.0.9", "0.1.1", "0.1.2", "operator notes"],
        "only a directory with a release name and a manifest is a release prune may remove");
      assert.ok(existsSync(context.root), "a link's target is never touched");
    });
  });

test("given current selecting another release than the configuration names, when prune starts, then it removes "
  + "nothing", () => {
  fixture((context) => {
    // given
    updatedTwice(context);
    rmSync(join(context.target, "current"));
    symlinkSync("releases/0.1.0", join(context.target, "current"));

    // when
    const result = run(context.archive, context.target, ["prune", "--retain", "1"], context.environment);

    // then
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /current does not select releases\/0\.1\.2/);
    assert.deepEqual(readdirSync(join(context.target, "releases")).sort(), ["0.1.0", "0.1.1", "0.1.2"]);
    assert.equal(readdirSync(join(context.target, "backups")).filter((name) => name.startsWith("recovery-")).length, 2);
  });
});

test("given included recovery material, when backup and restore-check run, then MFA keys accompany the database before application validation", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    // when
    const backup = run(context.archive, context.target, ["backup"], context.environment);
    assert.equal(backup.status, 0, backup.stderr);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    const restored = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment, COURTSIDE_RESTORE_USERNAME: "doe.jane", COURTSIDE_RESTORE_PASSWORD: "private-restore-password"
    });
    // then
    assert.equal(backup.status, 0, backup.stderr);
    assert.ok(existsSync(join(recovery, "mfa-keys.tar")));
    assert.match(readFileSync(join(recovery, "recovery.conf"), "utf8"), /^mfa_keys=included$/m);
    assert.equal(restored.status, 0, restored.stderr);
    assert.match(readFileSync(context.dockerLog, "utf8"), /mfa-keys.*-xf[\s\S]*up -d --wait app/);
  });
});

test("given an application that logs to syslog, when backup exports MFA keys, then the archive leaves through a run without a log driver", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    writeFileSync(join(context.target, "config", "local.override.yaml"), "services: {}\n");
    // when
    const result = run(context.archive, context.target, ["backup"], context.environment);
    // then
    assert.equal(result.status, 0, result.stderr);
    const exportRun = readFileSync(context.dockerLog, "utf8").split("\n")
      .find((line) => line.includes(" run --rm --no-deps -T --entrypoint /bin/sh app -ec"));
    assert.ok(exportRun, "backup never exported the MFA key volume");
    assert.match(exportRun, /local\.override\.yaml -f \S+\/compose\.key-export\.yaml run /,
      "the key export must apply the log-free override after every other compose file");
    assert.match(readFileSync(join(context.archive, "compose.key-export.yaml"), "utf8"),
      /app:\s+logging:\s+driver: none/, "the export override must disable the application's log driver");
  });
});

test("given external recovery material, when backup runs, then the matching MFA key prerequisite is explicit and keys are excluded", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recovery_material: "external-verified" }).status, 0);
    // when
    const result = run(context.archive, context.target, ["backup"], context.environment);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    // then
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(join(recovery, "mfa-keys.tar")));
    assert.match(readFileSync(join(recovery, "recovery.conf"), "utf8"), /^mfa_keys=external-required$/m);
    assert.match(readFileSync(join(recovery, "restore-instructions.txt"), "utf8"), /matching MFA key archive/);
  });
});

test("given external recovery material without encrypted TOTP enrollments, when restore-check runs without keys, then it proves the unit", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recovery_material: "external-verified" }).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    rmSync(context.dockerLog, { force: true });
    // when
    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment, COURTSIDE_RESTORE_USERNAME: "doe.jane", COURTSIDE_RESTORE_PASSWORD: "private-restore-password"
    });
    // then
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(context.dockerLog, "utf8");
    assert.match(calls, /from account_mfa where totp_secret is not null/, "the restored database was never asked for encrypted enrollments");
    assert.doesNotMatch(calls, /-xf/, "no key archive was supplied, so none may be extracted");
    assert.match(calls, / up -d --wait app/);
  });
});

test("given external recovery material with encrypted TOTP enrollments, when restore-check runs without keys, then it fails naming the reason", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recovery_material: "external-verified" }).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    writeFileSync(join(context.root, "docker-encrypted-totp"), "2\n");
    rmSync(context.dockerLog, { force: true });
    // when
    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment, COURTSIDE_RESTORE_USERNAME: "doe.jane", COURTSIDE_RESTORE_PASSWORD: "private-restore-password"
    });
    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /2 encrypted TOTP enrollments.*--mfa-keys/);
    const calls = readFileSync(context.dockerLog, "utf8");
    assert.doesNotMatch(calls, / up -d --wait app/, "the application must not start without its keys");
    assert.match(calls, /volume rm .*_db/);
    assert.match(calls, /volume rm .*_mfa-keys/);
  });
});

test("given external recovery material, when the operator exports MFA keys, then restore-check accepts that archive", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recovery_material: "external-verified" }).status, 0);
    const vault = join(context.root, "vault");
    mkdirSync(vault, { mode: 0o700 });
    const archive = join(vault, "mfa-keys.tar");
    // when
    const exported = run(context.archive, context.target, ["mfa-export-keys", "--output", archive], context.environment);
    // then
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal(statSync(archive).mode & 0o777, 0o600, "the exported key archive is private");
    assert.deepEqual(readdirSync(vault), ["mfa-keys.tar"], "no partial export remains beside the archive");
    assert.match(readFileSync(context.dockerLog, "utf8"), /compose\.key-export\.yaml run --rm --no-deps -T --entrypoint \/bin\/sh app/);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    const restored = run(context.archive, context.target, ["restore-check", "--recovery", recovery, "--mfa-keys", archive], {
      ...context.environment, COURTSIDE_RESTORE_USERNAME: "doe.jane", COURTSIDE_RESTORE_PASSWORD: "private-restore-password"
    });
    assert.equal(restored.status, 0, restored.stderr);
  });
});

test("given an existing file or a shared directory, when the operator exports MFA keys, then nothing is written", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context, { recovery_material: "external-verified" }).status, 0);
    const vault = join(context.root, "vault");
    mkdirSync(vault, { mode: 0o700 });
    const existing = join(vault, "mfa-keys.tar");
    writeFileSync(existing, "retained archive\n", { mode: 0o600 });
    const shared = join(context.root, "shared");
    mkdirSync(shared, { mode: 0o755 });
    chmodSync(shared, 0o755);
    // when
    const overwrite = run(context.archive, context.target, ["mfa-export-keys", "--output", existing], context.environment);
    const exposed = run(context.archive, context.target, ["mfa-export-keys", "--output", join(shared, "mfa-keys.tar")],
      context.environment);
    // then
    assert.equal(overwrite.status, 2);
    assert.match(overwrite.stderr, /already exists/);
    assert.equal(readFileSync(existing, "utf8"), "retained archive\n");
    assert.equal(exposed.status, 2);
    assert.match(exposed.stderr, /mode-0700 directory/);
    assert.deepEqual(readdirSync(shared), []);
  });
});

test("given an MFA-enabled restored account, when the recovery login probe receives a second factor, then it completes MFA without logging the code", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    writeFileSync(join(context.root, "curl-mfa-required"), "required");
    const proofFile = join(context.root, "mfa-code");
    writeFileSync(proofFile, "123456", { mode: 0o600 });
    // when
    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment, COURTSIDE_RESTORE_USERNAME: "doe.jane", COURTSIDE_RESTORE_PASSWORD: "private-restore-password", COURTSIDE_RESTORE_MFA_CODE_FILE: proofFile
    });
    // then
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(join(context.root, "curl.log"), "utf8");
    assert.match(calls, /--data-binary @.*mfa-proof.*\/api\/session\/mfa/);
    assert.doesNotMatch(result.stdout + result.stderr + calls, /123456|private-restore-password/);
  });
});

test("given a restored member account without administrator role, when the login probe runs, then any authenticated account proves the recovery", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    writeFileSync(join(context.root, "curl-member-role"), "member");
    // when
    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment, COURTSIDE_RESTORE_USERNAME: "doe.jane", COURTSIDE_RESTORE_PASSWORD: "private-restore-password"
    });
    // then
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(join(context.root, "curl.log"), "utf8"), /api\/public\/courts/);
  });
});

test("given an existing restore key volume, when restore-check starts, then neither extraction nor cleanup may touch it", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    writeFileSync(join(context.root, "docker-mfa-volume-exists"), "foreign keys\n");
    rmSync(context.dockerLog, { force: true });
    // when
    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment, COURTSIDE_RESTORE_USERNAME: "doe.jane", COURTSIDE_RESTORE_PASSWORD: "private-password"
    });
    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /already has an MFA key volume/);
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), /volume create| up | down | -xf/);
    assert.equal(readFileSync(join(context.root, "docker-mfa-volume-exists"), "utf8"), "foreign keys\n");
  });
});

test("given ownership changes after restore reservation, when restore-check fails, then cleanup retains the foreign key volume", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    writeFileSync(join(context.root, "docker-steal-restore-keys"), "yes\n");
    rmSync(context.dockerLog, { force: true });
    // when
    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment, COURTSIDE_RESTORE_USERNAME: "doe.jane", COURTSIDE_RESTORE_PASSWORD: "private-password"
    });
    // then
    assert.equal(result.status, 2);
    const calls = readFileSync(context.dockerLog, "utf8");
    assert.doesNotMatch(calls, /down --volumes|volume rm .*_mfa-keys/);
    const retained = readdirSync(context.root).filter((name) => /^restore-owner-.*_mfa-keys$/.test(name));
    assert.equal(retained.length, 1);
    assert.equal(readFileSync(join(context.root, retained[0]), "utf8"), "foreign\n");
  });
});

test("given a key volume appears during restore reservation, when its owner differs, then only the already reserved database volume is removed", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
    const recovery = join(context.target, "backups", readdirSync(join(context.target, "backups"))[0]);
    writeFileSync(join(context.root, "docker-race-restore-keys"), "yes\n");
    rmSync(context.dockerLog, { force: true });
    // when
    const result = run(context.archive, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment, COURTSIDE_RESTORE_USERNAME: "doe.jane", COURTSIDE_RESTORE_PASSWORD: "private-password"
    });
    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /belongs to another run/);
    const calls = readFileSync(context.dockerLog, "utf8");
    assert.match(calls, /volume rm .*_db/);
    assert.doesNotMatch(calls, /volume rm .*_mfa-keys| up | down | -xf/);
    const retained = readdirSync(context.root).filter((name) => /^restore-owner-.*_mfa-keys$/.test(name));
    assert.equal(retained.length, 1);
    assert.equal(readFileSync(join(context.root, retained[0]), "utf8"), "foreign\n");
  });
});
