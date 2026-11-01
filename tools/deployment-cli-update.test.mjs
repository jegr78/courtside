import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { executable } from "./deployment-archive.mjs";

import { fixture, releaseArchive, usePostgres17, useLegacyPostgres18, run, initialize,
  makeInstalledManifestLegacy } from "./deployment-cli-fixture.mjs";

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

test("given an installed PostgreSQL 17 release, when the candidate launcher updates to PostgreSQL 18, then it restores into an isolated volume before switching", () => {
  fixture((context) => {
    // given
    usePostgres17(context.archive);
    const initialized = initialize(context);
    assert.equal(initialized.status, 0, initialized.stderr);
    const next = releaseArchive(context.root, "0.1.1");
    rmSync(context.dockerLog, { force: true });

    // when
    const result = run(next, context.target,
      ["update", "--archive", next, "--yes"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.equal(realpathSync(join(context.target, "current")),
      realpathSync(join(context.target, "releases", "0.1.1")));
    assert.match(readFileSync(join(context.target, "config", ".env"), "utf8"),
      /^COURTSIDE_DATABASE_VOLUME="example-club_db-pg18-0\.1\.1"$/m);
    const invocations = readFileSync(context.dockerLog, "utf8");
    assert.match(invocations, /compose\.database-upgrade\.yaml.* up -d --wait db/);
    assert.match(invocations, /compose\.database-upgrade\.yaml.* pg_restore .*--single-transaction/);
    assert.ok(invocations.indexOf("pg_restore") < invocations.lastIndexOf(" stop app"));
  });
});

test("given a legacy PostgreSQL 18 installation without an explicit volume, when it updates, then it adopts its existing volume", () => {
  fixture((context) => {
    // given
    useLegacyPostgres18(context.archive);
    const initialized = initialize(context);
    assert.equal(initialized.status, 0, initialized.stderr);
    const environmentFile = join(context.target, "config", ".env");
    writeFileSync(environmentFile, readFileSync(environmentFile, "utf8")
      .replace(/^COURTSIDE_DATABASE_VOLUME=.*\n/m, ""));
    const next = releaseArchive(context.root, "0.1.1");

    // when
    const result = run(next, context.target,
      ["update", "--archive", next, "--yes"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(environmentFile, "utf8"),
      /^COURTSIDE_DATABASE_VOLUME="example-club_db"$/m);
  });
});

test("given a PostgreSQL 17 restore failure, when update runs, then the old release stays selected and running", () => {
  fixture((context) => {
    // given
    usePostgres17(context.archive);
    const initialized = initialize(context);
    assert.equal(initialized.status, 0, initialized.stderr);
    const next = releaseArchive(context.root, "0.1.1");
    writeFileSync(join(context.root, "docker-fail-match"), "pg_restore --no-owner --single-transaction");
    rmSync(context.dockerLog, { force: true });

    // when
    const result = run(next, context.target,
      ["update", "--archive", next, "--yes"], context.environment);

    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /PostgreSQL 18 migration failed before release selection/);
    assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"),
      /^release=0\.1\.0$/m);
    assert.match(readFileSync(context.dockerLog, "utf8"), /compose\.database-upgrade\.yaml.* down --volumes/);
  });
});

test("given the old application cannot stop after restore, when the major update exits, then it removes only the unselected target volume", () => {
  fixture((context) => {
    // given
    usePostgres17(context.archive);
    const initialized = initialize(context);
    assert.equal(initialized.status, 0, initialized.stderr);
    const next = releaseArchive(context.root, "0.1.1");
    writeFileSync(join(context.root, "docker-fail-match"), "stop app");
    rmSync(context.dockerLog, { force: true });

    // when
    const result = run(next, context.target,
      ["update", "--archive", next, "--yes"], context.environment);

    // then
    assert.equal(result.status, 2);
    assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"),
      /^release=0\.1\.0$/m);
    assert.match(readFileSync(context.dockerLog, "utf8"),
      /volume rm example-club_db-pg18-0\.1\.1/);
  });
});

test("given PostgreSQL 18 health fails after selection, when update runs, then it restores the PostgreSQL 17 release automatically", () => {
  fixture((context) => {
    // given
    usePostgres17(context.archive);
    const initialized = initialize(context);
    assert.equal(initialized.status, 0, initialized.stderr);
    const next = releaseArchive(context.root, "0.1.1");
    writeFileSync(join(context.root, "docker-fail-target-health"), "once\n");
    rmSync(context.dockerLog, { force: true });

    // when
    const result = run(next, context.target,
      ["update", "--archive", next, "--yes"], context.environment);

    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /restored release 0\.1\.0 with its original PostgreSQL 17 volume/);
    assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"),
      /^release=0\.1\.0$/m);
    assert.equal(realpathSync(join(context.target, "current")),
      realpathSync(join(context.target, "releases", "0.1.0")));
    assert.ok(readFileSync(context.dockerLog, "utf8").match(/ up -d --wait/g).length >= 3);
  });
});

test("given an operator override, when a PostgreSQL major update is requested, then it refuses before Docker or downtime", () => {
  fixture((context) => {
    // given
    usePostgres17(context.archive);
    const initialized = initialize(context);
    assert.equal(initialized.status, 0, initialized.stderr);
    const next = releaseArchive(context.root, "0.1.1");
    writeFileSync(join(context.target, "config", "local.override.yaml"), "services: {}\n");
    rmSync(context.dockerLog, { force: true });

    // when
    const result = run(next, context.target,
      ["update", "--archive", next, "--yes"], context.environment);

    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /database major update.*local override/);
    assert.ok(!existsSync(context.dockerLog));
    assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"),
      /^release=0\.1\.0$/m);
  });
});

test("given external database or custom image ownership, when a PostgreSQL major update is requested, then it fails closed before Docker", () => {
  for (const scenario of [
    {
      changes: {
        recipe: "existing-infrastructure",
        database_url: "jdbc:postgresql://database.example.org:5432/courtside",
        database_username: "courtside",
      },
      environment: { COURTSIDE_DATABASE_PASSWORD: "external-private-value" },
      expected: /external database/,
    },
    {
      changes: {
        overlays: "custom-image",
        custom_image_repository: "registry.example.org/courtside",
        custom_image_digest: "d".repeat(64),
      },
      environment: {},
      expected: /custom image/,
    },
  ]) {
    fixture((context) => {
      // given
      usePostgres17(context.archive);
      const environment = { ...context.environment, ...scenario.environment };
      const initialized = initialize(context, scenario.changes, environment);
      assert.equal(initialized.status, 0, initialized.stderr);
      const next = releaseArchive(context.root, "0.1.1");
      rmSync(context.dockerLog, { force: true });

      // when
      const result = run(next, context.target,
        ["update", "--archive", next, "--yes"], environment);

      // then
      assert.equal(result.status, 2);
      assert.match(result.stderr, scenario.expected);
      assert.ok(!existsSync(context.dockerLog));
      assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"),
        /^release=0\.1\.0$/m);
    });
  }
});

test("given an installed release before booking seed images, when it is backed up and updated, then legacy recovery stays readable", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    makeInstalledManifestLegacy(context.target);
    const backup = run(context.archive, context.target, ["backup"], context.environment);
    assert.equal(backup.status, 0, backup.stderr);
    const legacyRecovery = join(context.target, "backups",
      readdirSync(join(context.target, "backups")).find((entry) => entry.startsWith("recovery-")));
    const next = releaseArchive(context.root, "0.1.1");

    // when
    const update = run(context.archive, context.target,
      ["update", "--archive", next, "--yes"], context.environment);
    const restoreCheck = run(context.archive, context.target,
      ["restore-check", "--recovery", legacyRecovery], {
        ...context.environment,
        COURTSIDE_RESTORE_USERNAME: "doe.jane",
        COURTSIDE_RESTORE_PASSWORD: "restore-private-value",
      });

    // then
    assert.equal(update.status, 0, update.stderr);
    assert.equal(restoreCheck.status, 0, restoreCheck.stderr);
    assert.equal(realpathSync(join(context.target, "current")),
      realpathSync(join(context.target, "releases", "0.1.1")));
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

function mailVersion(archive, tag) {
  const compose = join(archive, "compose.stalwart.yaml");
  writeFileSync(compose, readFileSync(compose, "utf8")
    .replace(/stalwartlabs\/stalwart:[^@\s]+@sha256:[a-f0-9]{64}/,
      `stalwartlabs/stalwart:${tag}@sha256:${tag === "v0.16.27" ? "c429b311c93db5606598abc1c68225a85a6953183848ae01bee9c6a98885836c" : "baafeacd6cbde77acdd94af49972d41c6709e54a376df48e18a9fe3f445eb3d5"}`));
  const manifest = join(archive, "manifest.json");
  const body = JSON.parse(readFileSync(manifest, "utf8"));
  body.files["compose.stalwart.yaml"] = createHash("sha256").update(readFileSync(compose)).digest("hex");
  writeFileSync(manifest, `${JSON.stringify(body, null, 2)}\n`);
}

function legacyMail(context) {
  mailVersion(context.archive, "v0.16.27");
  const initialized = initialize(context, { recipe: "full-self-hosted", mail_relay_host: "" });
  assert.equal(initialized.status, 0, initialized.stderr);
  writeFileSync(context.dockerLog, "");
  return releaseArchive(context.root, "0.1.1");
}

for (const boundary of ["state", "phase.partial", "target.env"]) {
  test(`given interruption while staging ${boundary}, when the original release starts, then no incomplete journal blocks recovery`, () => {
    fixture((context) => {
      // given
      const next = legacyMail(context);
      const nativeChmod = executable("chmod");
      const fault = join(context.root, "interrupt-journal");
      writeFileSync(fault, "once");
      writeFileSync(join(context.root, "bin", "chmod"), `#!/bin/sh
"${nativeChmod}" "$@" || exit $?
case "$*" in
  *'/${boundary}')
    if [ -f '${fault}' ]; then
      rm '${fault}'
      kill -KILL "$PPID"
      exit 137
    fi
    ;;
esac
`, { mode: 0o755 });
      // when
      const interrupted = run(next, context.target, ["update", "--archive", next,
        "--mail-store-transition", "reinitialize", "--yes"], context.environment);
      assert.ok(interrupted.signal === "SIGKILL" || interrupted.status === 137);
      const activeJournal = existsSync(join(context.target, ".courtside-mail-transition"));
      const recovered = run(next, context.target, ["up"], context.environment);
      // then
      assert.equal(activeJournal, false, "only a complete journal may become active");
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"), /^release=0\.1\.0$/m);
      assert.ok(!readdirSync(context.target).some((name) => name.startsWith(".mail-transition.partial.")));
      assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), /volume create .*mail-(config|data)-stalwart1/);
    });
  });
}

test("given activation failed after store selection, when update is retried, then the journal resumes the same selected pair", () => {
  fixture((context) => {
    // given
    const next = legacyMail(context);
    writeFileSync(join(context.root, "docker-fail-mail-activation"), "once");
    const args = ["update", "--archive", next, "--mail-store-transition", "reinitialize", "--yes"];
    const failed = run(next, context.target, args, context.environment);
    assert.equal(failed.status, 2, failed.stderr);
    assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"), /^release=0\.1\.1$/m);
    const selected = readFileSync(join(context.target, "config", ".env"), "utf8");
    writeFileSync(context.dockerLog, "");
    // when
    const blocked = run(next, context.target, ["up"], context.environment);
    const result = run(next, context.target, args, context.environment);
    // then
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /interrupted mail transition/);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(context.target, "config", ".env"), "utf8"), selected);
    assert.equal(existsSync(join(context.target, ".courtside-mail-transition")), false);
    const calls = readFileSync(context.dockerLog, "utf8");
    assert.doesNotMatch(calls, /volume create|run --rm mail-bootstrap/);
    assert.match(calls, /run --rm --no-deps mail-ready/);
  });
});

function failedPreparation(context) {
  const next = legacyMail(context);
  writeFileSync(join(context.root, "docker-fail-match"), "run --rm mail-configure");
  const failed = run(next, context.target, ["update", "--archive", next,
    "--mail-store-transition", "reinitialize", "--yes"], context.environment);
  assert.equal(failed.status, 2, failed.stderr);
  rmSync(join(context.root, "docker-fail-match"));
  writeFileSync(context.dockerLog, "");
  return next;
}

test("given a failed mail preparation, when routine commands run, then backup, restore-check and status still work", () => {
  fixture((context) => {
    // given
    const next = failedPreparation(context);
    const journal = join(context.target, ".courtside-mail-transition");
    const recovery = readFileSync(join(journal, "state"), "utf8").match(/^recovery=(.*)$/m)[1];
    // when
    const backup = run(next, context.target, ["backup"], context.environment);
    const restore = run(next, context.target, ["restore-check", "--recovery", recovery], {
      ...context.environment, COURTSIDE_RESTORE_USERNAME: "doe.jane", COURTSIDE_RESTORE_PASSWORD: "restore-private-value" });
    const status = run(next, context.target, ["status"], context.environment);
    const up = run(next, context.target, ["up"], context.environment);
    // then
    assert.equal(backup.status, 0, backup.stderr);
    assert.equal(restore.status, 0, restore.stderr);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /^mail_transition=preparing$/m, "status must name the interrupted transition");
    assert.equal(up.status, 2, "up must stay refused while the journal is active");
    assert.ok(existsSync(join(journal, "state")), "routine commands must not retire the journal");
    assert.ok(existsSync(recovery), "a backup must not prune the journal's recovery unit");
  });
});

test("given a failed mail preparation, when the transition is abandoned, then the source runs and no new attempt starts", () => {
  fixture((context) => {
    // given
    const next = failedPreparation(context);
    const before = readFileSync(join(context.target, "config", ".env"), "utf8");
    // when
    const result = run(next, context.target,
      ["update", "--mail-store-transition", "abandon", "--yes"], context.environment);
    // then
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(context.target, ".courtside-mail-transition")), false);
    assert.equal(readdirSync(join(context.target, "backups")).filter((name) => name.startsWith("mail-transition-")).length, 1);
    assert.equal(readFileSync(join(context.target, "config", ".env"), "utf8"), before);
    assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"), /^release=0\.1\.0$/m);
    const calls = readFileSync(context.dockerLog, "utf8");
    assert.match(calls, /up -d --wait mail mail-certificate mail-reload/, "abandon must restart the certificate reloader");
    assert.match(calls, /up -d app/);
    assert.doesNotMatch(calls, /volume create|run --rm mail-bootstrap|volume rm|down --volumes/);
    assert.equal(run(context.archive, context.target, ["backup"], context.environment).status, 0);
  });
});

test("given the target release is selected, when the transition is abandoned, then refuse and point at recovery", () => {
  fixture((context) => {
    // given
    const next = legacyMail(context);
    writeFileSync(join(context.root, "docker-fail-mail-activation"), "once");
    assert.equal(run(next, context.target, ["update", "--archive", next,
      "--mail-store-transition", "reinitialize", "--yes"], context.environment).status, 2);
    writeFileSync(context.dockerLog, "");
    // when
    const result = run(next, context.target,
      ["update", "--mail-store-transition", "abandon", "--yes"], context.environment);
    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /abandon.*recovery unit/);
    assert.equal(existsSync(join(context.target, ".courtside-mail-transition")), true);
    assert.equal(readFileSync(context.dockerLog, "utf8"), "");
  });
});

test("given no interrupted mail transition, when abandon is requested, then refuse without Docker", () => {
  fixture((context) => {
    // given
    legacyMail(context);
    // when
    const result = run(context.archive, context.target,
      ["update", "--mail-store-transition", "abandon", "--yes"], context.environment);
    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no interrupted mail transition/);
    assert.equal(readFileSync(context.dockerLog, "utf8"), "");
  });
});

test("given a target volume acquired a foreign owner, when activation is retried, then no service starts", () => {
  fixture((context) => {
    // given
    const next = legacyMail(context);
    const args = ["update", "--archive", next, "--mail-store-transition", "reinitialize", "--yes"];
    writeFileSync(join(context.root, "docker-fail-mail-activation"), "once");
    assert.equal(run(next, context.target, args, context.environment).status, 2);
    writeFileSync(join(context.root, "docker-foreign-mail-owner"), "foreign");
    writeFileSync(context.dockerLog, "");
    // when
    const result = run(next, context.target, args, context.environment);
    // then
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /ownership/);
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), / up | stop |volume rm/);
  });
});

test("given a partially configured target, when update is retried, then it retains the old attempt and allocates separate stores", () => {
  fixture((context) => {
    // given
    const next = legacyMail(context);
    const args = ["update", "--archive", next, "--mail-store-transition", "reinitialize", "--yes"];
    writeFileSync(join(context.root, "docker-fail-match"), "run --rm mail-configure");
    assert.equal(run(next, context.target, args, context.environment).status, 2);
    const oldTarget = readFileSync(join(context.target, ".courtside-mail-transition", "target.env"), "utf8");
    rmSync(join(context.root, "docker-fail-match"));
    writeFileSync(context.dockerLog, "");
    // when
    const result = run(next, context.target, args, context.environment);
    // then
    assert.equal(result.status, 0, result.stderr);
    const selected = readFileSync(join(context.target, "config", ".env"), "utf8");
    assert.notEqual(selected.match(/^COURTSIDE_MAIL_CONFIG_VOLUME=.*$/m)?.[0], oldTarget.match(/^COURTSIDE_MAIL_CONFIG_VOLUME=.*$/m)?.[0]);
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), /volume rm|down --volumes/);
    assert.equal(readdirSync(join(context.target, "backups")).filter((name) => name.startsWith("mail-transition-")).length, 2);
  });
});

test("given legacy mail, when an explicit transition is previewed, then exact consequences are reported without mutation", () => {
  fixture((context) => {
    // given
    const next = legacyMail(context);
    const file = join(context.target, "config", ".env");
    const before = readFileSync(file, "utf8");
    // when
    const result = run(next, context.target,
      ["update-check", "--archive", next, "--mail-store-transition", "reinitialize"], context.environment);
    // then
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mail_transition=reinitialize/);
    assert.match(result.stdout, /v0\.16\.27@sha256:[a-f0-9]{64}/);
    assert.match(result.stdout, /v1\.0\.0@sha256:[a-f0-9]{64}/);
    assert.match(result.stdout, /not copied/);
    assert.match(result.stdout, /DKIM.*DNS/);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.deepEqual(readdirSync(join(context.target, "backups")), []);
    assert.equal(readFileSync(context.dockerLog, "utf8"), "");
    assert.equal(existsSync(join(context.target, "releases", "0.1.1")), false);
  });
});

test("given legacy mail and explicit opt-in, when the update succeeds, then new stores are configured before the app starts", () => {
  fixture((context) => {
    // given
    const next = legacyMail(context);
    // when
    const result = run(next, context.target,
      ["update", "--archive", next, "--mail-store-transition", "reinitialize", "--yes"], context.environment);
    // then
    assert.equal(result.status, 0, result.stderr);
    const environment = readFileSync(join(context.target, "config", ".env"), "utf8");
    assert.match(environment, /^COURTSIDE_MAIL_CONFIG_VOLUME="example-club_mail-config-stalwart1-[a-f0-9]+"$/m);
    assert.match(environment, /^COURTSIDE_MAIL_DATA_VOLUME="example-club_mail-data-stalwart1-[a-f0-9]+"$/m);
    assert.doesNotMatch(environment, /^COURTSIDE_MAIL_RECOVERY_(ADMIN|MODE)=.+$/m);
    assert.equal(realpathSync(join(context.target, "current")), realpathSync(join(context.target, "releases", "0.1.1")));
    const calls = readFileSync(context.dockerLog, "utf8");
    assert.match(calls, /run --rm mail-bootstrap/);
    assert.match(calls, /run --rm mail-configure/);
    assert.match(calls, /run --rm --no-deps mail-ready/);
    assert.ok(calls.indexOf("stop app") < calls.indexOf("run --rm mail-bootstrap"));
    assert.ok(calls.indexOf("run --rm --no-deps mail-ready") < calls.lastIndexOf("up -d --wait"));
    assert.doesNotMatch(calls, /volume rm example-club_mail-(config|data)(\s|$)|down --volumes/);
    assert.equal(existsSync(join(context.target, ".courtside-mail-transition")), false);
    assert.equal(readdirSync(join(context.target, "backups")).filter((name) => name.startsWith("recovery-")).length, 1);
  });
});

for (const failure of ["run --rm mail-bootstrap", "run --rm mail-configure", "run --rm --no-deps mail-ready"]) {
  test(`given a mail transition failure at ${failure}, when update exits, then source selection and recovery remain intact`, () => {
    fixture((context) => {
      // given
      const next = legacyMail(context);
      writeFileSync(join(context.root, "docker-fail-match"), failure);
      const before = readFileSync(join(context.target, "config", ".env"), "utf8");
      // when
      const result = run(next, context.target,
        ["update", "--archive", next, "--mail-store-transition", "reinitialize", "--yes"], context.environment);
      // then
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /mail transition.*recovery/i);
      assert.equal(readFileSync(join(context.target, "config", ".env"), "utf8"), before);
      assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"), /^release=0\.1\.0$/m);
      const calls = readFileSync(context.dockerLog, "utf8");
      assert.doesNotMatch(calls, /volume rm example-club_mail-|down --volumes/);
      assert.match(calls.slice(calls.lastIndexOf(failure)),
        /--env-file \S+\/config\/\.env .*up -d --wait mail mail-certificate mail-reload/,
        "the source must restart with its certificate reloader");
      assert.equal(existsSync(join(context.target, ".courtside-mail-transition")), true);
    });
  });
}

test("given a local override, when mail reinitialization is requested, then refuse before backup or Docker", () => {
  fixture((context) => {
    // given
    const next = legacyMail(context);
    writeFileSync(join(context.target, "config", "local.override.yaml"), "services: {}\n");
    // when
    const result = run(next, context.target,
      ["update", "--archive", next, "--mail-store-transition", "reinitialize", "--yes"], context.environment);
    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /mail.*override/);
    assert.equal(readFileSync(context.dockerLog, "utf8"), "");
    assert.deepEqual(readdirSync(join(context.target, "backups")), []);
  });
});

test("given simultaneous PostgreSQL and mail transitions, when the database restore fails, then source configuration remains selected", () => {
  fixture((context) => {
    // given
    usePostgres17(context.archive);
    const next = legacyMail(context);
    const before = readFileSync(join(context.target, "config", ".env"), "utf8");
    writeFileSync(join(context.root, "docker-fail-match"), "pg_restore --no-owner --single-transaction");
    // when
    const result = run(next, context.target,
      ["update", "--archive", next, "--mail-store-transition", "reinitialize", "--yes"], context.environment);
    // then
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /PostgreSQL 18 migration failed before release selection/);
    assert.equal(readFileSync(join(context.target, "config", ".env"), "utf8"), before);
    assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"), /^release=0\.1\.0$/m);
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), /volume rm example-club_mail-/);
    assert.equal(existsSync(join(context.target, ".courtside-mail-transition")), true);
  });
});

test("given successful PostgreSQL and mail preparation, when activation fails, then neither selected target is reverted independently", () => {
  fixture((context) => {
    // given
    usePostgres17(context.archive);
    const next = legacyMail(context);
    writeFileSync(join(context.root, "docker-fail-mail-activation"), "once");
    // when
    const result = run(next, context.target,
      ["update", "--archive", next, "--mail-store-transition", "reinitialize", "--yes"], context.environment);
    // then
    assert.equal(result.status, 2, result.stderr);
    const selected = readFileSync(join(context.target, "config", ".env"), "utf8");
    assert.match(selected, /^COURTSIDE_DATABASE_VOLUME="example-club_db-pg18-0\.1\.1"$/m);
    assert.match(selected, /^COURTSIDE_MAIL_CONFIG_VOLUME="example-club_mail-config-stalwart1-[a-f0-9]+"$/m);
    assert.match(readFileSync(join(context.target, ".courtside-mail-transition", "target.env"), "utf8"),
      /^COURTSIDE_DATABASE_VOLUME="example-club_db-pg18-0\.1\.1"$/m, "the mail candidate must render the target database volume");
    assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"), /^release=0\.1\.1$/m);
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), /volume rm example-club_(db-pg18|mail-)/);
  });
});

test("given an unsupported source image, when reinitialization is requested, then it refuses before backup", () => {
  fixture((context) => {
    // given
    mailVersion(context.archive, "v0.16.26");
    assert.equal(initialize(context, { recipe: "full-self-hosted", mail_relay_host: "" }).status, 0);
    const next = releaseArchive(context.root, "0.1.1");
    writeFileSync(context.dockerLog, "");
    // when
    const result = run(next, context.target, ["update", "--archive", next,
      "--mail-store-transition", "reinitialize", "--yes"], context.environment);
    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unsupported Stalwart store migration/);
    assert.equal(readFileSync(context.dockerLog, "utf8"), "");
    assert.deepEqual(readdirSync(join(context.target, "backups")), []);
  });
});

test("given a target volume belongs to another attempt, when it is allocated, then target setup never starts", () => {
  fixture((context) => {
    // given
    const next = legacyMail(context);
    writeFileSync(join(context.root, "docker-foreign-mail-owner"), "foreign");
    // when
    const result = run(next, context.target, ["update", "--archive", next,
      "--mail-store-transition", "reinitialize", "--yes"], context.environment);
    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /belongs to another attempt/);
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), /run --rm mail-bootstrap|volume rm example-club_mail-/);
    assert.match(readFileSync(join(context.target, "config", "installation.conf"), "utf8"), /^release=0\.1\.0$/m);
  });
});

test("given a completed mail transition, when a backup and patch update run, then they retain the selected stores", () => {
  fixture((context) => {
    // given
    const next = legacyMail(context);
    assert.equal(run(next, context.target, ["update", "--archive", next,
      "--mail-store-transition", "reinitialize", "--yes"], context.environment).status, 0);
    const file = join(context.target, "config", ".env");
    const pair = readFileSync(file, "utf8").match(/^COURTSIDE_MAIL_(CONFIG|DATA)_VOLUME=.*$/gm);
    assert.equal(pair.length, 2);
    const patch = releaseArchive(context.root, "0.1.2");
    writeFileSync(context.dockerLog, "");
    // when
    const backup = run(next, context.target, ["backup"], context.environment);
    const update = run(patch, context.target, ["update", "--archive", patch, "--yes"], context.environment);
    // then
    assert.equal(backup.status, 0, backup.stderr);
    assert.equal(update.status, 0, update.stderr);
    assert.deepEqual(readFileSync(file, "utf8").match(/^COURTSIDE_MAIL_(CONFIG|DATA)_VOLUME=.*$/gm), pair);
    const calls = readFileSync(context.dockerLog, "utf8");
    for (const line of pair) assert.ok(calls.includes(`${line.split('"')[1]}:/source:ro`));
    assert.doesNotMatch(calls, /example-club_mail-(config|data):\/source:ro/);
  });
});

for (const previous of ["v0.16.27", "unknown"]) {
  test(`given managed mail stores at ${previous}, when a Stalwart 1 update is requested, then refuse before backup or release selection`, () => {
    fixture((context) => {
      // given
      mailVersion(context.archive, previous);
      assert.equal(initialize(context, { recipe: "full-self-hosted", mail_relay_host: "" }).status, 0);
      const next = releaseArchive(context.root, "0.1.1");
      writeFileSync(context.dockerLog, "");
      const configuration = readFileSync(join(context.target, "config", "installation.conf"), "utf8");
      const selected = realpathSync(join(context.target, "current"));
      // when
      const result = run(next, context.target, ["update", "--archive", next, "--yes"], context.environment);
      // then
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /Stalwart.*store.*migration/);
      assert.equal(readFileSync(context.dockerLog, "utf8"), "");
      assert.equal(realpathSync(join(context.target, "current")), selected);
      assert.equal(readFileSync(join(context.target, "config", "installation.conf"), "utf8"), configuration);
      assert.deepEqual(readdirSync(join(context.target, "backups")), []);
      assert.equal(existsSync(join(context.target, "releases", "0.1.1")), false);
    });
  });
}

for (const recipe of ["full-self-hosted", "standard"]) {
  test(`given ${recipe} on compatible mail stores, when an exact release is updated, then preserve the supported update path`, () => {
    fixture((context) => {
      // given
      assert.equal(initialize(context, { recipe, ...(recipe === "full-self-hosted" ? { mail_relay_host: "" } : {}) }).status, 0);
      const next = releaseArchive(context.root, "0.1.1");
      // when
      const result = run(next, context.target, ["update", "--archive", next, "--yes"], context.environment);
      // then
      assert.equal(result.status, 0, result.stderr);
      assert.equal(realpathSync(join(context.target, "current")), realpathSync(join(context.target, "releases", "0.1.1")));
    });
  });
}

test("given a private installation, when update stages a verified release after backup, then restricted container identities can read public bind material", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const next = releaseArchive(context.root, "0.1.1");

    // when
    const result = run(next, context.target, ["update", "--archive", next, "--yes"], context.environment);
    const release = join(context.target, "releases", "0.1.1");
    const directory = statSync(join(release, "mail")).mode & 0o777;
    const renderer = statSync(join(release, "mail", "render.sh")).mode & 0o777;
    const readiness = statSync(join(release, "mail-ready.mjs")).mode & 0o777;

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.equal(directory, 0o555, "the bind-mounted directory must admit a different container identity");
    assert.equal(renderer & 0o444, 0o444, "the renderer must be readable without DAC override");
    assert.equal(readiness & 0o444, 0o444, "the unprivileged readiness identity must read its program");
    assert.equal((directory | renderer | readiness) & 0o222, 0, "release material must remain immutable");
    assert.equal(statSync(context.target).mode & 0o777, 0o700);
    assert.equal(statSync(join(context.target, "releases")).mode & 0o777, 0o700);
    assert.equal(statSync(join(context.target, "config", ".env")).mode & 0o777, 0o600);
  });
});

test("given an owner-only staged target, when update retries, then verified container bind material becomes readable", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const next = releaseArchive(context.root, "0.1.1");
    const failure = join(context.root, "docker-fail-match");
    writeFileSync(failure, "image pull");
    assert.equal(run(next, context.target, ["update", "--archive", next, "--yes"], context.environment).status, 2);
    const release = join(context.target, "releases", "0.1.1");
    chmodSync(join(release, "mail"), 0o500);
    chmodSync(join(release, "mail", "render.sh"), 0o500);
    chmodSync(join(release, "mail-ready.mjs"), 0o400);
    rmSync(failure);

    // when
    const result = run(next, context.target, ["update", "--archive", next, "--yes"], context.environment);

    // then
    assert.equal(result.status, 0, result.stderr);
    assert.equal(statSync(join(release, "mail")).mode & 0o777, 0o555);
    assert.equal(statSync(join(release, "mail", "render.sh")).mode & 0o444, 0o444);
    assert.equal(statSync(join(release, "mail-ready.mjs")).mode & 0o777, 0o444);
    assert.equal(statSync(join(context.target, "config", ".env")).mode & 0o777, 0o600);
  });
});
