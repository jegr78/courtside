import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  selectRepositoryDigest,
  publishedTags,
  gitHistory,
  nightlyUpgradeOrigins,
  previousReleaseTag,
  releaseUpgradeOrigins,
  selectUpgradeOrigins,
  unexplainedChanges,
  originFixture,
  originVerification
} from "./courtside.upgrade-smoke.mjs";

const releaseWorkflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)),
  "utf8"
);
const gatesWorkflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release-gates.yml", import.meta.url)),
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
  const tags = ["v0.2.1", "v0.3.0-rc.2", "v0.3.0-rc.10", "v0.3.0-rc"];

  // when
  const origins = selectUpgradeOrigins("v0.3.0", tags);

  // then
  assert.deepEqual(origins, ["v0.2.1", "v0.3.0-rc", "v0.3.0-rc.2", "v0.3.0-rc.10"]);
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
  assert.deepEqual(selectUpgradeOrigins("v0.3.0", ["v0.2.1", "v0.3.0-rc.01", "v0.3.0-rc.1"]),
    ["v0.2.1", "v0.3.0-rc.1"]);
  assert.throws(() => selectUpgradeOrigins("v01.2.3", []), /not a semantic version/);
  assert.throws(() => selectUpgradeOrigins("v0.3.0-rc.01", []), /not a semantic version/);
});

test("given only candidates before the first release, when selecting origins, then nothing is an upgrade origin",
  () => {
    // when / then
    assert.deepEqual(selectUpgradeOrigins("v0.1.0", []), []);
    assert.deepEqual(selectUpgradeOrigins("v0.1.0", ["v0.1.0-rc.1", "v0.1.0-rc.2"]), [],
      "a candidate schema is not frozen before the first release");
    assert.deepEqual(selectUpgradeOrigins("v0.1.0-rc.4", ["v0.1.0-rc.3"]), []);
  });

test("given the first release of a major, when selecting origins, then the preceding major remains covered",
  () => {
    // given
    const tags = ["v0.8.0", "v0.9.1", "v0.10.0-rc.1", "v1.0.0-rc.1"];

    // when
    const origins = selectUpgradeOrigins("v1.0.0", tags);

    // then
    assert.deepEqual(origins, ["v0.9.1", "v1.0.0-rc.1"]);
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
  assert.match(releaseWorkflow, /--release-origins "\$GITHUB_REPOSITORY"/);
  assert.match(releaseWorkflow, /upgrade-origins: \$\{\{ needs\.build\.outputs\.upgrade-origins \}\}/);
  assert.match(gatesWorkflow, /node tools\/courtside\.upgrade-smoke\.mjs --confirm courtside-upgrade/);
  assert.match(gatesWorkflow,
    /\n  upgrade:\n[\s\S]+?uses: \.\/\.github\/actions\/gate-image\n[\s\S]+?digest: \$\{\{ inputs\.image-digest \}\}/);
  assert.match(gatesWorkflow, /COURTSIDE_UPGRADE_CANDIDATE_IMAGE: \$\{\{ steps\.image\.outputs\.reference \}\}/);
  assert.match(gatesWorkflow, /COURTSIDE_UPGRADE_ORIGIN_IMAGE: \$\{\{ matrix\.origin\.image \}\}/);
  assert.match(releaseWorkflow, /Supported database upgrade origins/);
  assert.match(releaseWorkflow, /needs: \[archive, build, browser, image, qualify, gates\]/);
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

test("given the files a later release reads from this tag, when the tree is inspected, then both exist", () => {
  // when
  const missing = [originFixture, originVerification]
    .filter((path) => !existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url))));

  // then
  assert.deepEqual(missing, [], "a later upgrade proof reads these paths from this release's tag");
});

test("given published releases, when the release names its upgrade origins, then each is checked out and pulled "
  + "by its version", () => {
  // when / then
  assert.deepEqual(releaseUpgradeOrigins("example/courtside", ["v0.1.0", "v0.2.3"]), [
    { ref: "v0.1.0", image: "ghcr.io/example/courtside:0.1.0" },
    { ref: "v0.2.3", image: "ghcr.io/example/courtside:0.2.3" }
  ]);
  assert.deepEqual(releaseUpgradeOrigins("example/courtside", []), []);
});

test("given the retained dated nightlies, when the night rehearses an upgrade, then it starts from the earliest "
  + "one whose shipped migrations the candidate still carries unchanged", () => {
    // given
    const tags = ["nightly", "nightly-20261001-91740c9", "release-candidate-5c0a946e", "nightly-20260930-2a3b6f7",
      "booking-seed-nightly-20260920-0000000", "nightly-20260930-7e6adcc", "nightly-20260929-aaaaaaa", "0.1.0"];
    const committedAt = { "91740c9": 40, "2a3b6f7": 20, "7e6adcc": 10, aaaaaaa: 5 };
    const history = { committedAt: (ref) => committedAt[ref], unchangedSince: (ref) => ref !== "aaaaaaa" };

    // when / then
    assert.deepEqual(nightlyUpgradeOrigins("example/courtside", tags, history),
      [{ ref: "7e6adcc", image: "ghcr.io/example/courtside:nightly-20260930-7e6adcc" }],
      "a migration corrected in place since aaaaaaa would fail Flyway's checksum, and 7e6adcc precedes 2a3b6f7");
    assert.deepEqual(nightlyUpgradeOrigins("example/courtside", ["nightly"], history), [],
      "without a dated nightly there is nothing to upgrade from");
  });

test("given a history where a shipped migration was corrected, when git is asked, then only origins before an "
  + "addition qualify and commit time orders them", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-upgrade-history-"));
  const git = (args, date = "2026-09-01T00:00:00Z") => execFileSync("git", args, { cwd: directory, encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: "Jane Doe",
      GIT_AUTHOR_EMAIL: "jane@example.org", GIT_COMMITTER_NAME: "Jane Doe", GIT_COMMITTER_EMAIL: "jane@example.org" }
  }).trim();
  const commit = (path, content, date) => {
    mkdirSync(join(directory, path, ".."), { recursive: true });
    writeFileSync(join(directory, path), content);
    git(["add", "."], date);
    git(["commit", "-q", "-m", path], date);
    return git(["rev-parse", "--short", "HEAD"]);
  };
  const migration = "src/main/resources/db/migration";

  try {
    git(["init", "-q"]);
    const first = commit(`${migration}/V1__base.sql`, "create table a();", "2026-09-01T00:00:00Z");
    const added = commit(`${migration}/V2__more.sql`, "create table b();", "2026-09-02T00:00:00Z");
    const verified = commit("upgrade/verify.sql", "select 1;", "2026-09-03T00:00:00Z");
    const corrected = commit(`${migration}/V1__base.sql`, "create table a(id int);", "2026-09-04T00:00:00Z");

    // when
    const beforeCorrection = gitHistory(verified, directory);
    const afterCorrection = gitHistory(corrected, directory);

    // then
    assert.ok(beforeCorrection.unchangedSince(first), "a migration added later does not disqualify an origin");
    assert.ok(beforeCorrection.committedAt(first) < beforeCorrection.committedAt(added));
    assert.ok(!afterCorrection.unchangedSince(added), "Flyway would refuse V1's changed checksum");
    assert.ok(afterCorrection.unchangedSince(corrected));
    assert.ok(!afterCorrection.unchangedSince("0000000"), "a commit this checkout lacks is never an origin");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
