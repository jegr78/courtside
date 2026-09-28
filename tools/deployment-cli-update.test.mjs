import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

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
