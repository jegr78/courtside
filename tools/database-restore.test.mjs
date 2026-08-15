import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
  const workflow = source("../.github/workflows/release.yml");

  // when / then
  assert.match(workflow, /\n  restore:\n    needs: image/);
  assert.match(workflow, /COURTSIDE_RESTORE_IMAGE:[^\n]+needs\.image\.outputs\.digest/);
  assert.match(workflow, /node tools\/courtside\.restore-smoke\.mjs --confirm courtside-restore/);
  assert.match(workflow, /needs: \[build, image, qualify, security-record, upgrade, restore\]/);
  assert.match(workflow, /!build\/database-restore\/\*\*\/\*\.dump/);
  assert.match(workflow, /!build\/database-restore\/\*\*\/\*\.sql/);
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

test("given operator documentation, when backup and restore are followed, then both use the qualified archive format", () => {
  // given
  const documentation = source("../deploy/README.md");

  // when / then
  assert.match(documentation, /pg_dump -Fc/);
  assert.match(documentation, /pg_restore --list/);
  assert.match(documentation, /mktemp/);
  assert.match(documentation, /mv "\$temporary" "\$backup"/);
  assert.match(documentation, /pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error/);
  assert.match(documentation, /matching Courtside image/);
});
