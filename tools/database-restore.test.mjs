import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applicationStateTables,
  columnsAddedSinceTheFixture
} from "./courtside.restore-smoke.mjs";

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
  assert.match(runner, /openssl.*req.*-x509.*subjectAltName=DNS:mail/s);
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
    "message_record", "opening_hours", "person", "spring_session", "user_account", "user_account_role"
  ]);
  assert.match(runner, /application-before\.json/);
  assert.match(runner, /application-after\.json/);
  assert.match(runner, /pg_sequences/);
  assert.match(runner, /restored application database differs from its backup source/);
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

  // when / then
  assert.match(runner, /privateDirectory = mkdtempSync\(join\(tmpdir\(\), "courtside-restore-"\)\)/);
  assert.match(runner,
    /mailCertificateDirectory = mkdtempSync\(join\(tmpdir\(\), "courtside-restore-mail-"\)\)/);
  assert.match(runner, /COURTSIDE_RESTORE_MAIL_CERT_DIR: mailCertificateDirectory/);
  assert.doesNotMatch(runner, /COURTSIDE_RESTORE_MAIL_CERT_DIR: privateDirectory/);
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

// Read as a sequence rather than file by file: a migration can add a column with a default and a
// later one take it away, which leaves the column required even though neither file says so alone.
function withoutComments(sql) {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// A column clause runs until the next clause of the same ALTER, not until the next comma: a type
// like numeric(10,2) carries one of its own.
function clausesOf(alterBody) {
  return alterBody.split(/,(?=\s*(?:ADD|ALTER|DROP)\s)/i);
}

function alterationsIn(sql) {
  const alterations = [];
  const statements = withoutComments(sql).split(/;\s*(?=\n|$)/);
  for (const statement of statements) {
    const table = /\bALTER TABLE\s+(?:ONLY\s+)?([a-z_]+)/i.exec(statement)?.[1];
    if (!table) {
      continue;
    }
    const body = statement.slice(statement.search(/\bALTER TABLE\b/i));
    for (const clause of clausesOf(body)) {
      const added = /\bADD COLUMN\s+([a-z_]+)\b/i.exec(clause);
      if (added) {
        alterations.push({
          table, column: added[1], required: /\bNOT NULL\b/i.test(clause),
          setsADefault: /\bDEFAULT\b/i.test(clause), dropsTheDefault: false
        });
        continue;
      }
      const altered = /\bALTER COLUMN\s+([a-z_]+)\s+(SET NOT NULL|DROP DEFAULT|SET DEFAULT)/i.exec(clause);
      if (altered) {
        alterations.push({
          table, column: altered[1], required: /SET NOT NULL/i.test(altered[2]),
          setsADefault: /SET DEFAULT/i.test(altered[2]),
          dropsTheDefault: /DROP DEFAULT/i.test(altered[2])
        });
      }
    }
  }
  return alterations;
}

function requiredColumnsAfter(migrations, floor) {
  const state = new Map();
  for (const { file, sql } of migrations) {
    const version = Number(/^V(\d+)__/.exec(file)?.[1]);
    if (!Number.isInteger(version)) {
      continue;
    }
    for (const change of alterationsIn(sql)) {
      const key = `${change.table}.${change.column}`;
      const held = state.get(key) ?? { required: false, hasADefault: false, migration: file };
      state.set(key, {
        required: held.required || change.required,
        hasADefault: change.dropsTheDefault ? false : held.hasADefault || change.setsADefault,
        migration: version > floor && !held.required ? file : held.migration,
        introduced: held.introduced ?? version
      });
    }
  }
  return [...state.entries()]
    .filter(([, held]) => held.required && !held.hasADefault && held.introduced > floor)
    .map(([key, held]) => ({
      table: key.split(".")[0], column: key.split(".")[1], migration: held.migration
    }));
}

function requiredColumnsAddedAfterTheFixture() {
  const directory = fileURLToPath(new URL(MIGRATIONS, import.meta.url));
  const migrations = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => Number(/^V(\d+)__/.exec(left)[1]) - Number(/^V(\d+)__/.exec(right)[1]))
    .map((file) => ({ file, sql: source(`${MIGRATIONS}/${file}`) }));
  return requiredColumnsAfter(migrations, 17);
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

test("given the ways a migration can make a column required, when the migrations are read, then each way is found", () => {
  // given
  const migrations = [
    { file: "V18__comma_in_the_type.sql", sql: "ALTER TABLE member ADD COLUMN fee numeric(10,2) NOT NULL;" },
    { file: "V19__existing_column.sql", sql: "ALTER TABLE member ALTER COLUMN nickname SET NOT NULL;" },
    { file: "V20__with_a_default.sql",
      sql: "ALTER TABLE member ADD COLUMN joined date NOT NULL DEFAULT CURRENT_DATE;" },
    { file: "V21__default_withdrawn_later.sql", sql: "ALTER TABLE member ALTER COLUMN joined DROP DEFAULT;" },
    { file: "V22__keeps_its_default.sql", sql: "ALTER TABLE member ADD COLUMN note text NOT NULL DEFAULT '';" },
    { file: "V23__only_in_a_comment.sql",
      sql: "-- ALTER TABLE member ADD COLUMN ignored text NOT NULL;\nALTER TABLE member ADD COLUMN kept text;" }
  ];

  // when
  const required = requiredColumnsAfter(migrations, 17).map(({ column }) => column).sort();

  // then
  assert.deepEqual(required, ["fee", "joined", "nickname"],
    "fee carries a comma in its type, nickname is an existing column made required, and joined keeps\n"
    + "no default once a later migration withdraws it. note keeps its default, ignored is commented\n"
    + "out and kept is nullable, so none of those three is required.");
});
