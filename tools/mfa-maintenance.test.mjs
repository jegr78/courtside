import assert from "node:assert/strict";
import { chmodSync, closeSync, constants, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openMaintenanceEmail } from "./mfa-maintenance.mjs";
import test from "node:test";
import { parseArguments } from "./courtside.mjs";
import { fixture, initialize, run } from "./deployment-cli-fixture.mjs";

test("given account maintenance, when a target or identity check is missing, then the UAT launcher refuses before Docker", () => {
  // given / when / then
  assert.throws(() => parseArguments(["uat-mfa-recover"]), /account-id/);
  assert.throws(() => parseArguments(["uat-mfa-recover", "--account-id", "11111111-1111-4111-8111-111111111111"]), /identity-checked/);
  assert.equal(parseArguments(["uat-mfa-rotate-keys"]).command, "uat-mfa-rotate-keys");
});

test("given email correction, when the operator command is built, then the email travels only through private standard input", async () => {
  // given
  const { mfaMaintenancePlan } = await import("./mfa-maintenance.mjs");
  const options = { action: "mfa-correct-email", accountId: "11111111-1111-4111-8111-111111111111", identityChecked: true, emailFile: "/private/email" };
  // when
  const plan = mfaMaintenancePlan(options, ["compose", "-p", "courtside-uat"], {}, 42);
  // then
  assert.equal(plan.stdin, 42);
  assert.ok(plan.args.includes("--no-deps"));
  assert.ok(plan.args.some((argument) => /cat >.*email/.test(argument)));
  assert.ok(plan.args.includes("--courtside.maintenance.email-file=/tmp/courtside-maintenance/email"));
  assert.doesNotMatch(plan.args.join(" "), /example\.org|\/private\/email/);
});

test("given the production launcher, when account rescue is confirmed, then the action is account scoped and needs an external identity check", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const account = "11111111-1111-4111-8111-111111111111";
    // when
    const refused = run(context.archive, context.target, ["mfa-recover", "--account-id", account], context.environment);
    const accepted = run(context.archive, context.target, ["mfa-recover", "--account-id", account, "--identity-checked"], context.environment);
    // then
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /identity-checked/);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(readFileSync(context.dockerLog, "utf8"), /run --rm --no-deps -T app --courtside.maintenance.action=mfa-recover --courtside.maintenance.account-id=11111111-1111-4111-8111-111111111111 --courtside.maintenance.identity-checked=true/);
  });
});

test("given an unreachable holder email, when maintenance receives a private email file, then no email appears in the launcher output or Docker arguments", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const input = join(context.root, "email");
    writeFileSync(input, "jane.doe@example.org\n", { mode: 0o600 });
    // when
    const result = run(context.archive, context.target, ["mfa-correct-email", "--account-id", "11111111-1111-4111-8111-111111111111", "--identity-checked", "--email-file", input], context.environment);
    // then
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(context.dockerLog, "utf8");
    assert.match(calls, /--courtside.maintenance.email-file=\/tmp\/courtside-maintenance\/email/);
    assert.doesNotMatch(calls + result.stdout + result.stderr, /jane\.doe@example\.org/);
  });
});

test("given a validated email descriptor, when the path changes before Docker consumes it, then production sends only the opened file", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const input = join(context.root, "email");
    const captured = join(context.root, "captured-email");
    writeFileSync(input, "jane.doe@example.org\n", { mode: 0o600 });
    const docker = join(context.root, "bin", "docker");
    const source = readFileSync(docker, "utf8");
    writeFileSync(docker, source.replace("previous=''", `case "$*" in
  *'--courtside.maintenance.action=mfa-correct-email'*)
    cat > "${captured}"
    ;;
esac
previous=''`));
    writeFileSync(join(context.root, "bin", "chmod"), `#!/bin/bash
if [[ "\${!#}" = */.courtside.lock ]]; then
  mv "${input}" "${input}.old"
  printf '%s' 'foreign@example.org' > "${input}"
fi
exec /bin/chmod "$@"
`, { mode: 0o700 });
    // when
    const result = run(context.archive, context.target, ["mfa-correct-email", "--account-id", "11111111-1111-4111-8111-111111111111", "--identity-checked", "--email-file", input], context.environment);
    // then
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(captured, "utf8"), "jane.doe@example.org\n");
    assert.equal(readFileSync(input, "utf8"), "foreign@example.org");
  });
});


test("given an email file swapped before opening, when the descriptor is checked, then the replacement is rejected without exposing its path", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-email-swap-"));
  const file = join(directory, "jane.doe@example.org");
  writeFileSync(file, "jane.doe@example.org", { mode: 0o600 });
  let descriptor;
  try {
    // when / then
    assert.throws(() => { descriptor = openMaintenanceEmail(file, { openSync: (path, flags) => {
      assert.ok(flags & constants.O_NOFOLLOW);
      rmSync(path);
      writeFileSync(path, "jane.doe@example.org", { mode: 0o644 });
      return openSync(path, flags);
    } }); }, (failure) => /trusted directory/.test(failure.message) && !failure.message.includes("jane.doe@example.org"));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given a private email file in a writable parent, when the host opens it, then the untrusted parent is rejected", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-email-parent-"));
  const file = join(directory, "email");
  writeFileSync(file, "jane.doe@example.org", { mode: 0o600 });
  chmodSync(directory, 0o777);
  let descriptor;
  try {
    // when / then
    assert.throws(() => { descriptor = openMaintenanceEmail(file); }, /trusted directory/);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given a trusted lexical alias to a foreign-owned directory, when the host opens an email file, then the real parent chain is rejected", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-email-real-parent-"));
  const target = join(directory, "target");
  const alias = join(directory, "alias");
  mkdirSync(target, { mode: 0o700 });
  writeFileSync(join(target, "email"), "jane.doe@example.org", { mode: 0o600 });
  symlinkSync(target, alias);
  let descriptor;
  try {
    // when / then
    assert.throws(() => { descriptor = openMaintenanceEmail(join(alias, "email"), { lstatSync: (path) => {
      const info = lstatSync(path);
      return path === realpathSync(target) ? Object.assign(info, { uid: process.getuid() + 1 }) : info;
    } }); }, /trusted directory/);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given an email replaced after its path metadata is checked, when production opens the input, then it validates the opened descriptor before Docker", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const input = join(context.root, "email");
    writeFileSync(input, "jane.doe@example.org", { mode: 0o600 });
    writeFileSync(context.dockerLog, "");
    const stat = join(context.root, "bin", "stat");
    writeFileSync(stat, `#!/bin/bash
/usr/bin/stat "$@"
result=$?
if [ "$result" = 0 ] && [ "\${!#}" = "${input}" ] && [ ! -e "${input}.swapped" ]; then
  mv "${input}" "${input}.swapped"
  printf '%s' 'foreign@example.org' > "${input}"
  chmod 644 "${input}"
fi
exit "$result"
`, { mode: 0o700 });
    // when
    const result = run(context.archive, context.target, ["mfa-correct-email", "--account-id", "11111111-1111-4111-8111-111111111111", "--identity-checked", "--email-file", input], context.environment);
    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /private|regular|trusted/);
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), /--courtside.maintenance.action=mfa-correct-email/);
    assert.doesNotMatch(result.stdout + result.stderr, /jane\.doe@example\.org|foreign@example\.org/);
  });
});

test("given a hard-linked production email input, when maintenance starts, then it rejects shared file ownership before Docker", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const input = join(context.root, "email");
    writeFileSync(input, "jane.doe@example.org", { mode: 0o600 });
    linkSync(input, join(context.root, "email-copy"));
    writeFileSync(context.dockerLog, "");
    // when
    const result = run(context.archive, context.target, ["mfa-correct-email", "--account-id", "11111111-1111-4111-8111-111111111111", "--identity-checked", "--email-file", input], context.environment);
    // then
    assert.equal(result.status, 2);
    assert.doesNotMatch(readFileSync(context.dockerLog, "utf8"), /--courtside.maintenance.action=mfa-correct-email/);
  });
});

test("given a hard-linked email input, when the host opens it, then multiple links are rejected", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-email-links-"));
  const file = join(directory, "email");
  writeFileSync(file, "jane.doe@example.org", { mode: 0o600 });
  linkSync(file, join(directory, "other"));
  let descriptor;
  try {
    // when / then
    assert.throws(() => { descriptor = openMaintenanceEmail(file); }, /trusted directory/);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given 254 email bytes and a final newline, when the host opens the private input, then it accepts 255 bytes and rejects a larger descriptor", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-email-boundary-"));
  const file = join(directory, "email");
  writeFileSync(file, `${"a".repeat(254)}\n`, { mode: 0o600 });
  let descriptor;
  try {
    // when
    descriptor = openMaintenanceEmail(file);
    // then
    assert.equal(readFileSync(descriptor).length, 255);
    closeSync(descriptor);
    descriptor = undefined;
    writeFileSync(file, "a".repeat(256));
    assert.throws(() => { descriptor = openMaintenanceEmail(file); }, /private|254/);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given a writable host input directory, when the production launcher corrects an email, then it refuses before running maintenance", () => {
  fixture((context) => {
    // given
    assert.equal(initialize(context).status, 0);
    const parent = join(context.root, "input");
    mkdirSync(parent, { mode: 0o777 });
    chmodSync(parent, 0o777);
    const file = join(parent, "jane.doe@example.org");
    writeFileSync(file, "jane.doe@example.org", { mode: 0o600 });
    // when
    const result = run(context.archive, context.target, ["mfa-correct-email", "--account-id", "11111111-1111-4111-8111-111111111111", "--identity-checked", "--email-file", file], context.environment);
    // then
    assert.equal(result.status, 2);
    assert.match(result.stderr, /trusted directory/);
    assert.doesNotMatch(result.stdout + result.stderr, /jane\.doe@example\.org/);
  });
});
