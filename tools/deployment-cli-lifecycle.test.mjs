import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync }
  from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { executable } from "./deployment-archive.mjs";
import { deploy, digest, fixture, answers, run, initialize } from "./deployment-cli-fixture.mjs";

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
    writeFileSync(join(context.root, "docker-volumes"),
      "example-club_db\nexample-club_db-pg18-0.1.1\n");

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
    assert.match(readFileSync(context.dockerLog, "utf8"), /volume rm example-club_db-pg18-0\.1\.1/);
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
