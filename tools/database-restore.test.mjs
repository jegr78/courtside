import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { columnsAddedSinceTheFixture } from "./courtside.restore-smoke.mjs";

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

const FIXTURE = "../upgrade/fixtures/pre-release-v17.sql";
const MIGRATIONS = "../src/main/resources/db/migration";

function tablesTheFixtureSeeds() {
  return new Set([...source(FIXTURE).matchAll(/^INSERT INTO ([a-z_]+)/gm)].map((match) => match[1]));
}

// The fixture stops at V17, so anything a later migration adds as NOT NULL without leaving a default
// behind is a column its INSERTs cannot satisfy.
function requiredColumnsAddedAfterTheFixture() {
  const required = [];
  for (const file of readdirSync(fileURLToPath(new URL(MIGRATIONS, import.meta.url))).sort()) {
    const version = Number(/^V(\d+)__/.exec(file)?.[1]);
    if (!Number.isInteger(version) || version <= 17) {
      continue;
    }
    const sql = source(`${MIGRATIONS}/${file}`);
    for (const statement of sql.split(";")) {
      const table = /ALTER TABLE\s+([a-z_]+)/i.exec(statement)?.[1];
      if (!table) {
        continue;
      }
      for (const added of statement.matchAll(/ADD COLUMN\s+([a-z_]+)\s+[^,]*?NOT NULL([^,]*)/gi)) {
        const keepsADefault = /DEFAULT/i.test(added[2])
          && !new RegExp(`ALTER COLUMN\\s+${added[1]}\\s+DROP DEFAULT`, "i").test(sql);
        if (!keepsADefault) {
          required.push({ table, column: added[1], migration: file });
        }
      }
    }
  }
  return required;
}

test("given a column a migration added as required after V17, when the restore smoke seeds the fixture, then that column is lent a value", () => {
  // given
  const seeded = tablesTheFixtureSeeds();
  const lent = new Set(columnsAddedSinceTheFixture.map(({ table, column }) => `${table}.${column}`));

  // when
  const unmet = requiredColumnsAddedAfterTheFixture()
    .filter(({ table }) => seeded.has(table))
    .filter(({ table, column }) => !lent.has(`${table}.${column}`))
    .map(({ table, column, migration }) => `${migration} makes ${table}.${column} required`);

  // then
  assert.deepEqual(unmet, [],
    "The restore smoke seeds a fixture that predates these columns, so its INSERT will fail once the\n"
    + "candidate image has migrated. Lend each one a value in columnsAddedSinceTheFixture:\n"
    + `${unmet.join("\n")}`);
});

test("given a lent column, when the migrations are read, then it is one a migration after V17 actually requires", () => {
  // given
  const required = new Set(requiredColumnsAddedAfterTheFixture()
    .map(({ table, column }) => `${table}.${column}`));

  // when / then
  columnsAddedSinceTheFixture.forEach(({ table, column }) =>
    assert.ok(required.has(`${table}.${column}`),
      `${table}.${column} is lent a value but no migration after V17 requires it; drop the entry`));
});
