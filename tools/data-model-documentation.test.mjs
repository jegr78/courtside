import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function repositoryFile(path) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

const MIGRATIONS = "src/main/resources/db/migration";
// A repeatable migration is named R__*.sql and carries no version, so ordering reads the version
// where there is one and leaves the rest behind the numbered ones.
function version(name) {
  return Number(/^V(\d+)/.exec(name)?.[1] ?? Number.MAX_SAFE_INTEGER);
}

const migrations = readdirSync(fileURLToPath(new URL(`../${MIGRATIONS}`, import.meta.url)))
  .filter((name) => name.endsWith(".sql"))
  .sort((left, right) => version(left) - version(right));
const schema = migrations.map((name) => repositoryFile(`${MIGRATIONS}/${name}`)).join("\n");
const document = repositoryFile("docs/data-model.md");

const tables = [...schema.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_]+)/g)]
  .map((match) => match[1]);
const backticked = new Set([...document.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((match) => match[1]));

function declares(name) {
  return new RegExp(`\\b${name}\\b`).test(schema);
}

test("given the tables a migration creates, when the document maps them, then it names every one", () => {
  // given
  const created = new Set(tables);

  // when / then
  assert.ok(created.size >= 30, `the schema holds only ${created.size} tables`);
  for (const table of created) {
    assert.ok(backticked.has(table),
      `docs/data-model.md names no table ${table}, so the schema holds one the map does not`);
  }
});

// A name the document invents reads exactly like one that was renamed underneath it, and neither is
// visible to a reader who has only the document.
test("given a schema name the document uses, when the migrations are read, then they still carry it",
  () => {
    // when / then
    for (const token of backticked) {
      if (!token.includes("_")) continue;
      assert.ok(declares(token),
        `docs/data-model.md names ${token} and no migration mentions it any more`);
    }
  });

test("given the constraints the document cites, when the schema is read, then each is still declared",
  () => {
    // given
    const cited = ["court_allocation_no_overlap", "booking_series_one_kind_of_end",
      "booking_series_has_a_court", "booking_participant_kind_matches_filler",
      "club_config_single_row", "import_run_one_per_preview"];

    // when / then
    for (const constraint of cited) {
      assert.match(document, new RegExp("`" + constraint + "`"),
        `docs/data-model.md explains a rule and no longer names ${constraint} as what enforces it`);
      assert.ok(new RegExp(`CONSTRAINT (?:= ')?${constraint}\\b`).test(schema),
        `docs/data-model.md cites ${constraint} and no migration declares it`);
    }
  });

// The exclusion constraint is the one guarantee CLAUDE.md forbids moving into application code, so
// a document describing it has to be describing something that is still there.
test("given the occupancy guarantee, when the document explains it, then the schema still enforces it",
  () => {
    // when / then
    assert.match(schema, /EXCLUDE USING gist \(\s*court_id WITH =,\s*tstzrange\(starts_at, ends_at, '\[\)'\) WITH &&\s*\)\s*WHERE \(status <> 'CANCELLED'\)/);
    assert.match(document, /tstzrange\(starts_at, ends_at, '\[\)'\)/);
    assert.match(document, /WHERE \(status <> 'CANCELLED'\)/);
  });

test("given what a fresh instance holds, when the document lists it, then the seeds still write it",
  () => {
    // given
    const seeded = ["Member booking", "Training", "League match", "Court closed",
      "Ball machine", "Looking for a partner", "Standard", "Youth", "Active"];

    // when / then
    for (const value of seeded) {
      assert.ok(schema.includes(`'${value}'`), `no migration seeds ${value} any more`);
      assert.ok(document.includes(value),
        `docs/data-model.md does not say that a fresh instance holds ${value}`);
    }
  });
