import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { applicationStateTables } from "./courtside.restore-smoke.mjs";
import { createMailCertificateDirectory, currentHostIdentity } from "./mail-relay-certificate.mjs";

function source(path) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

test("given a restore qualification, when resources are inspected, then each run is isolated and loopback-only", () => {
  // given
  const runner = source("./courtside.restore-smoke.mjs");
  const compose = source("../deploy/compose.restore.yaml");

  // when / then
  assert.match(runner, /randomBytes\(4\)/);
  assert.match(runner, /courtside-restore-\$\{runId}/);
  assert.match(compose, /127\.0\.0\.1::8080/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /axllent\/mailpit:v1\.31@sha256:/);
  assert.match(compose, /--smtp-require-starttls/);
  assert.match(compose, /COURTSIDE_RESTORE_MAIL_CERT_DIR/);
  assert.match(compose, /COURTSIDE_MAIL_RELAY_HOST: mail/);
  assert.match(compose, /COURTSIDE_MAIL_RELAY_PORT: "1025"/);
  assert.match(compose, /COURTSIDE_MAIL_TRUST_RELAY_CERTIFICATE: "true"/);
  assert.match(source("./mail-relay-certificate.mjs"), /openssl.*req.*-x509.*subjectAltName=DNS:mail/s);
});

test("given a backup archive, when qualification runs, then corruption is rejected atomically before restore", () => {
  // given
  const runner = source("./courtside.restore-smoke.mjs");

  // when / then
  assert.match(runner, /pg_dump.*-Fc/s);
  assert.match(runner, /--single-transaction/);
  assert.match(runner, /--exit-on-error/);
  assert.match(runner, /corrupt archive unexpectedly restored/);
  assert.match(runner, /corrupt restore left database objects behind/);
  assert.match(runner, /interrupted restore changed the usable database/);
  assert.match(runner, /mkdtempSync\(join\(tmpdir\(\), "courtside-restore-"\)/);
  assert.doesNotMatch(runner, /join\(build, "courtside\.dump"\)/);
});

test("given a release candidate, when release qualification runs, then restore blocks publication", () => {
  // given
  const release = source("../.github/workflows/release.yml");
  const gates = source("../.github/workflows/release-gates.yml");

  // when / then
  assert.match(gates, /\n  restore:\n    runs-on: ubuntu-latest/);
  assert.match(gates,
    /\n  restore:\n[\s\S]+?uses: \.\/\.github\/actions\/gate-image\n[\s\S]+?digest: \$\{\{ inputs\.image-digest \}\}/);
  assert.match(gates, /COURTSIDE_RESTORE_IMAGE: \$\{\{ steps\.image\.outputs\.reference \}\}/);
  assert.match(gates, /node tools\/courtside\.restore-smoke\.mjs --confirm courtside-restore/);
  assert.match(gates, /!build\/database-restore\/\*\*\/\*\.dump/);
  assert.match(gates, /!build\/database-restore\/\*\*\/\*\.sql/);
  assert.match(release, /\n  gates:\n[\s\S]+?uses: \.\/\.github\/workflows\/release-gates\.yml/);
  assert.match(release, /image-digest: \$\{\{ needs\.image\.outputs\.digest \}\}/);
  assert.match(release, /needs: \[archive, build, browser, image, qualify, gates\]/);
});

test("given the recurring restore workflow, when it runs, then evidence is retained", () => {
  // given
  const workflow = source("../.github/workflows/backup-restore-smoke.yml");

  // when / then
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /courtside\.restore-smoke\.mjs --confirm courtside-restore/);
  assert.match(workflow, /retention-days: 14/);
  assert.match(workflow, /!build\/database-restore\/\*\*\/\*\.dump/);
  assert.match(workflow, /!build\/database-restore\/\*\*\/\*\.sql/);
});

test("given a real instance backup, when qualification creates its source, then writes go through HTTP", () => {
  // given
  const runner = source("./courtside.restore-smoke.mjs");
  const start = runner.indexOf("async function populateThroughApplication");
  const body = runner.slice(start, runner.indexOf("\n}\n\nfunction", start) + 2);

  // when / then
  assert.match(runner, /populateThroughApplication/);
  assert.match(runner, /path: "\/api\/account\/initial-password", method: "PUT"/);
  assert.match(runner, /path: "\/api\/admin\/config\/logo", method: "PUT"/);
  assert.match(runner, /path: "\/api\/bookings", method: "POST"/);
  assert.doesNotMatch(body, /\bpsql\(/);
});

test("given application-written state, when it is restored, then representative tables and sequences are compared", () => {
  // given
  const runner = source("./courtside.restore-smoke.mjs");

  // when / then
  assert.deepEqual(applicationStateTables, [
    "booking", "booking_card", "club_config", "court", "court_allocation", "domain_event", "event_publication",
    "message_record", "opening_hours", "opening_hours_version", "person", "spring_session", "user_account",
    "user_account_role"
  ]);
  assert.match(runner, /application-before\.json/);
  assert.match(runner, /application-after\.json/);
  assert.match(runner, /pg_sequences/);
  assert.match(runner, /restored application database differs from its backup source/);
  assert.match(runner, /compose\(project, environment, \["stop", "mail"\]\)/);
  assert.match(runner, /event_publication\.rows > 0/);
  assert.doesNotMatch(runner, /name !== "eventPublication"/);
});

test("given a restored application database, when the image starts, then the written logo and booking remain readable", () => {
  // given
  const runner = source("./courtside.restore-smoke.mjs");

  // when / then
  assert.match(runner, /verifyRestoredApplication/);
  assert.match(runner, /path: `\/api\/public\/config\/logo\?v=\$\{logoDigest\}`/);
  assert.match(runner, /path: "\/api\/my\/bookings"/);
});

test("given private database archives, when mail TLS is configured, then the mail container cannot read the archives", () => {
  // given
  const runner = source("./courtside.restore-smoke.mjs");
  const restoreCompose = source("../deploy/compose.restore.yaml");

  // when / then
  assert.match(runner, /privateDirectory = mkdtempSync\(join\(tmpdir\(\), "courtside-restore-"\)\)/);
  assert.match(runner, /mailCertificateDirectory = createMailCertificateDirectory\(tmpdir\(\), "courtside-restore-mail-"\)/);
  assert.match(source("./mail-relay-certificate.mjs"), /chmodSync\(key, 0o600\)/);
  assert.match(runner, /COURTSIDE_RESTORE_MAIL_CERT_DIR: mailCertificateDirectory/);
  assert.match(runner, /COURTSIDE_RESTORE_MAIL_USER: containerIdentity\(\)/);
  assert.doesNotMatch(runner, /COURTSIDE_RESTORE_MAIL_CERT_DIR: privateDirectory/);
  assert.match(restoreCompose, /user: \$\{COURTSIDE_RESTORE_MAIL_USER\}/);
});

test("given a capability-free mail container, when its certificate directory is prepared, then it is traversable",
  { skip: process.platform === "win32" }, () => {
    // given
    const parent = mkdtempSync(join(tmpdir(), "courtside-restore-mode-"));

    try {
      // when
      const privateDirectory = mkdtempSync(join(parent, "courtside-restore-"));
      const mailCertificateDirectory = createMailCertificateDirectory(parent);

      // then
      assert.equal(statSync(privateDirectory).mode & 0o777, 0o700);
      assert.equal(statSync(mailCertificateDirectory).mode & 0o777, 0o700);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

test("given different Docker hosts, when the mail identity is selected, then it follows POSIX ownership or Docker Desktop", () => {
  // when / then
  assert.equal(currentHostIdentity({ getuid: () => 1001, getgid: () => 121 }), "1001:121");
  assert.equal(currentHostIdentity({}), "0:0");
});

test("given operator documentation, when backup and restore are followed, then both use the qualified archive format", () => {
  // given
  const documentation = source("../deploy/guides/operations.md");

  // when / then
  assert.match(documentation, /pg_dump -Fc/);
  assert.match(documentation, /pg_restore --list/);
  assert.match(documentation, /mktemp/);
  assert.match(documentation, /mv "\$temporary" "\$backup"/);
  assert.match(documentation, /pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error/);
  assert.match(documentation, /matching Courtside image/);
});
