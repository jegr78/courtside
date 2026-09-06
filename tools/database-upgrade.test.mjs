import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  selectRepositoryDigest,
  publishedTags,
  previousReleaseTag,
  selectUpgradeOrigins,
  unexplainedChanges
} from "./courtside.upgrade-smoke.mjs";

const releaseWorkflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)),
  "utf8"
);
const fixture = readFileSync(
  fileURLToPath(new URL("../upgrade/fixtures/pre-release-v17.sql", import.meta.url)),
  "utf8"
);
const upgradeCompose = readFileSync(
  fileURLToPath(new URL("../deploy/compose.upgrade.yaml", import.meta.url)),
  "utf8"
);
const upgradeRunner = readFileSync(
  fileURLToPath(new URL("./courtside.upgrade-smoke.mjs", import.meta.url)),
  "utf8"
);

test("given patch and minor releases, when selecting upgrade origins, then the latest of each is retained", () => {
  // given
  const tags = ["v0.1.0", "v0.1.1", "v0.2.0", "v0.2.1"];

  // when
  const origins = selectUpgradeOrigins("v0.3.0", tags);

  // then
  assert.deepEqual(origins, ["v0.2.1"]);
});

// A club that ran a candidate has migrated its database, so the release it is a candidate for has
// to upgrade from it.
test("given candidates for this release, when selecting upgrade origins, then every one of them is an origin",
  () => {
    // given
    const tags = ["v0.2.1", "v0.3.0-alpha.1", "v0.3.0-rc.1", "v0.3.0-rc.2"];

    // when
    const origins = selectUpgradeOrigins("v0.3.0", tags);

    // then
    assert.deepEqual(origins, ["v0.2.1", "v0.3.0-alpha.1", "v0.3.0-rc.1", "v0.3.0-rc.2"]);
  });

test("given a candidate as the release, when selecting upgrade origins, then only what precedes it counts",
  () => {
    // given
    const tags = ["v0.2.1", "v0.3.0-rc.1", "v0.3.0-rc.2", "v0.3.0"];

    // when
    const origins = selectUpgradeOrigins("v0.3.0-rc.2", tags);

    // then
    assert.deepEqual(origins, ["v0.2.1", "v0.3.0-rc.1"]);
  });

test("given candidates of another line, when selecting upgrade origins, then they are not origins", () => {
  // given
  const tags = ["v0.2.1", "v0.2.2-rc.1", "v0.4.0-rc.1"];

  // when
  const origins = selectUpgradeOrigins("v0.3.0", tags);

  // then
  assert.deepEqual(origins, ["v0.2.1"]);
});

test("given candidates numbered past nine, when ordering them, then ten follows nine rather than one", () => {
  // given
  const tags = ["v0.3.0-rc.2", "v0.3.0-rc.10", "v0.3.0-rc"];

  // when
  const origins = selectUpgradeOrigins("v0.3.0", tags);

  // then
  assert.deepEqual(origins, ["pre-release-v17", "v0.3.0-rc", "v0.3.0-rc.2", "v0.3.0-rc.10"]);
});

test("given several patches in the current line, when selecting origins, then patch and previous minor differ", () => {
  // given
  const tags = ["v0.1.1", "v0.2.0", "v0.2.1", "v0.3.0", "v0.3.1"];

  // when
  const origins = selectUpgradeOrigins("v0.3.2", tags);

  // then
  assert.deepEqual(origins, ["v0.3.1", "v0.2.1"]);
});

// Semantic versioning forbids a leading zero, and accepting one would offer the same version twice
// as two origins that only differ in how they were written.
test("given a version written with a leading zero, when selecting upgrade origins, then it is not one", () => {
  // when / then
  assert.deepEqual(selectUpgradeOrigins("v0.3.0", ["v0.3.0-rc.01", "v0.3.0-rc.1"]),
    ["pre-release-v17", "v0.3.0-rc.1"]);
  assert.throws(() => selectUpgradeOrigins("v01.2.3", []), /not a semantic version/);
  assert.throws(() => selectUpgradeOrigins("v0.3.0-rc.01", []), /not a semantic version/);
});

test("given no published origin, when selecting upgrade origins, then the pre-release fixture is used", () => {
  // when / then
  assert.deepEqual(selectUpgradeOrigins("v0.1.0", []), ["pre-release-v17"]);
});

// Before the first release the pre-release schema is the only database a club can hold, and a
// candidate preceding it does not make that upgrade any less real.
test("given only candidates before the first release, when selecting origins, then the pre-release schema stays one",
  () => {
    // when / then
    assert.deepEqual(selectUpgradeOrigins("v0.1.0", ["v0.1.0-rc.1"]),
      ["pre-release-v17", "v0.1.0-rc.1"]);
    assert.deepEqual(selectUpgradeOrigins("v0.1.0", []), ["pre-release-v17"]);
  });

test("given only a candidate of another line, when selecting origins, then the pre-release schema is the origin",
  () => {
    // when / then
    assert.deepEqual(selectUpgradeOrigins("v0.3.0", ["v0.2.2-rc.1"]), ["pre-release-v17"]);
  });

// A tag whose run never reached publish names no image, so an origin resolved from it would pull
// something that does not exist and block the whole line.
test("given a release that was drafted or never published, when reading the tags, then it is not one", () => {
  // given
  const releases = [
    { tag_name: "v0.2.0", draft: false },
    { tag_name: "v0.3.0-rc.1", draft: false },
    { tag_name: "v0.3.0", draft: true }
  ];

  // when / then
  assert.deepEqual(publishedTags(releases), ["v0.2.0", "v0.3.0-rc.1"]);
  assert.deepEqual(publishedTags([]), []);
});

test("given the published releases, when anchoring the upgrade notes, then a candidate is never the anchor",
  () => {
    // when / then
    assert.equal(previousReleaseTag("v0.3.0", ["v0.2.0", "v0.2.1", "v0.3.0-rc.2"]), "v0.2.1");
    assert.equal(previousReleaseTag("v0.3.0-rc.2", ["v0.2.1", "v0.3.0-rc.1"]), "v0.2.1");
    assert.equal(previousReleaseTag("v0.1.0", ["v0.1.0-rc.1"]), null);
    assert.equal(previousReleaseTag("v0.1.0", []), null);
  });

test("given repository digests, when resolving an origin, then only the expected repository is accepted", () => {
  // given
  const digests = [
    "ghcr.io/example/other@sha256:bbbb",
    "ghcr.io/example/courtside@sha256:aaaa"
  ];

  // when / then
  assert.equal(selectRepositoryDigest("example/courtside", "v0.2.0", digests),
    "ghcr.io/example/courtside@sha256:aaaa");
  assert.throws(() => selectRepositoryDigest("example/courtside", "v0.2.0", [digests[0]]),
    /exactly one digest/);
});

test("given the pre-release fixture, when it is inspected, then all representative state is explicit", () => {
  // when / then
  for (const table of [
    "person", "user_account", "user_account_role", "member", "court", "rule_set",
    "rule_definition", "booking", "court_allocation", "booking_participant", "booking_series",
    "booking_series_court", "spring_session", "login_attempt_limit"
  ]) {
    assert.match(fixture, new RegExp(`INSERT INTO ${table}\\b`, "i"), table);
  }
  assert.match(fixture, /UPDATE club_config\b/i);
  assert.match(fixture, /upgrade-fixture@example\.org/);
});

test("given the upgrade verifier, when it is inspected, then representative row contents are captured", () => {
  // given
  const verification = readFileSync(fileURLToPath(new URL("../upgrade/verify.sql", import.meta.url)), "utf8");

  // when / then
  for (const checksum of [
    "personRows", "accountRows", "roleRows", "memberRows", "courtRows", "ruleSetRows", "ruleRows",
    "bookingRows", "allocationRows", "participantRows", "seriesRows", "seriesCourtRows", "sessionRows",
    "loginLimitRows", "configuration"
  ]) {
    assert.match(verification, new RegExp(`'${checksum}'`), checksum);
  }
  assert.doesNotMatch(verification, /SELECT id::text AS value/);
  assert.doesNotMatch(verification, /md5\(string_agg/);
});

test("given the proof captures whole rows, when a column is secret-sounding, then one rule redacts it", () => {
  // given
  const verification = readFileSync(fileURLToPath(new URL("../upgrade/verify.sql", import.meta.url)), "utf8");

  // when
  const rules = verification.match(/key ~\* '\([^']+\)'/g) ?? [];

  // then
  assert.equal(rules.length, 1, "the redaction must exist once, not once per captured table");
  for (const name of ["password", "secret", "token", "credential", "hash", "key"]) {
    assert.match(rules[0], new RegExp(`\\b${name}\\b`), name);
  }
  const captured = [...verification.matchAll(/SELECT '(\w+)',/g)].map((match) => match[1]);
  const served = [...verification.matchAll(/FROM redacted WHERE name = '(\w+)'/g)]
    .map((match) => match[1]);
  assert.deepEqual([...new Set(captured)].sort(), [...new Set(served)].sort(),
    "every captured table is served through the redaction, and none bypasses it");
});

test("given the restore proof, when it is produced, then it reads the same file and stays strict", () => {
  // given
  const restoreRunner = readFileSync(
    fileURLToPath(new URL("./courtside.restore-smoke.mjs", import.meta.url)), "utf8");

  // when / then
  assert.match(restoreRunner, /join\(root, "upgrade", "verify\.sql"\)/);
  assert.match(restoreRunner, /assert\.deepEqual\(after, before/);
  assert.doesNotMatch(restoreRunner, /unexplainedChanges/);
});

test("given a comparison that spans a migration, when a run makes it, then only losses fail the run", () => {
  // when / then
  assert.match(upgradeRunner, /unexplainedChanges\(JSON\.parse\(before\), JSON\.parse\(after\)\)/);
});

test("given a comparison within one schema version, when a run makes it, then nothing may be added either", () => {
  // when / then
  assert.match(upgradeRunner, /assert\.equal\(afterInterruption, before/);
  assert.match(upgradeRunner, /assert\.equal\(afterRecoveryProof, before/);
  assert.doesNotMatch(upgradeRunner, /unexplainedChanges\([^)]*afterInterruption/);
  assert.doesNotMatch(upgradeRunner, /unexplainedChanges\([^)]*afterRecoveryProof/);
});

test("given concurrent upgrade runs, when resources are named, then projects and ports are isolated", () => {
  // when / then
  assert.match(upgradeRunner, /randomBytes\(4\)/);
  assert.match(upgradeRunner, /courtside-upgrade-\$\{suffix}-\$\{runId}/);
  assert.match(upgradeCompose, /127\.0\.0\.1::8080/);
  assert.doesNotMatch(upgradeCompose, /127\.0\.0\.1:8084:8080/);
});

test("given an interrupted candidate, when the origin is recovered, then usability and unchanged data are proven", () => {
  // when / then
  assert.match(upgradeRunner, /verifyApplication\(password, publishedPort\(project, originEnvironment\), false\)/);
  assert.match(upgradeRunner, /origin usability proof changed fixture data/);
});

test("given a release candidate, when release qualification runs, then every supported database origin blocks publication", () => {
  // when / then
  assert.match(releaseWorkflow, /id: upgrade-origins/);
  assert.match(releaseWorkflow, /node tools\/courtside\.upgrade-smoke\.mjs --confirm courtside-upgrade/);
  assert.match(releaseWorkflow, /COURTSIDE_UPGRADE_CANDIDATE_IMAGE:[^\n]+needs\.image\.outputs\.digest/);
  assert.match(releaseWorkflow, /Supported database upgrade origins/);
  assert.match(releaseWorkflow, /needs: \[build, image, qualify, security-record, upgrade, restore\]/);
});

test("given a migration that adds a column, when comparing the proof, then the new column is not a change", () => {
  // given
  const before = { members: 2, memberRows: [{ id: "a", person_id: "p" }] };
  const after = { members: 2, memberRows: [{ id: "a", person_id: "p", started_on: "2026-01-01" }] };

  // when / then
  assert.deepEqual(unexplainedChanges(before, after), []);
});

test("given a migration that rewrites a value, when comparing the proof, then the change is reported", () => {
  // given
  const before = { memberRows: [{ id: "a", membership_type_id: "old" }] };
  const after = { memberRows: [{ id: "a", membership_type_id: "new" }] };

  // when / then
  assert.deepEqual(unexplainedChanges(before, after), ["memberRows[0].membership_type_id"]);
});

test("given a migration that drops a column, when comparing the proof, then the loss is reported", () => {
  // given
  const before = { memberRows: [{ id: "a", membership_type_id: "t" }] };
  const after = { memberRows: [{ id: "a" }] };

  // when / then
  assert.deepEqual(unexplainedChanges(before, after), ["memberRows[0].membership_type_id"]);
});

test("given a migration that loses a row, when comparing the proof, then the row count is reported", () => {
  // given
  const before = { memberRows: [{ id: "a" }, { id: "b" }] };
  const after = { memberRows: [{ id: "a" }] };

  // when / then
  assert.deepEqual(unexplainedChanges(before, after), ["memberRows: 2 rows before, 1 after"]);
});

test("given a migration that changes a count, when comparing the proof, then the count is reported", () => {
  // given
  const before = { members: 2, people: 3 };
  const after = { members: 1, people: 3 };

  // when / then
  assert.deepEqual(unexplainedChanges(before, after), ["members"]);
});

test("given a table the fixture leaves empty, when comparing the proof, then null stays null", () => {
  // given
  const before = { seriesRows: null };
  const after = { seriesRows: null };

  // when / then
  assert.deepEqual(unexplainedChanges(before, after), []);
});

test("given a proof that gains a whole entry, when comparing it, then the addition is not a change", () => {
  // given
  const before = { members: 1 };
  const after = { members: 1, membershipPeriods: 1 };

  // when / then
  assert.deepEqual(unexplainedChanges(before, after), []);
});
