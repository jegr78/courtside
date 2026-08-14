import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectRepositoryDigest, selectUpgradeOrigins } from "./courtside.upgrade-smoke.mjs";

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
  const tags = ["v0.1.0", "v0.1.1", "v0.2.0", "v0.2.1", "v0.3.0-rc.1"];

  // when
  const origins = selectUpgradeOrigins("v0.3.0", tags);

  // then
  assert.deepEqual(origins, ["v0.2.1"]);
});

test("given several patches in the current line, when selecting origins, then patch and previous minor differ", () => {
  // given
  const tags = ["v0.1.1", "v0.2.0", "v0.2.1", "v0.3.0", "v0.3.1"];

  // when
  const origins = selectUpgradeOrigins("v0.3.2", tags);

  // then
  assert.deepEqual(origins, ["v0.3.1", "v0.2.1"]);
});

test("given no published origin, when selecting upgrade origins, then the pre-release fixture is used", () => {
  // when / then
  assert.deepEqual(selectUpgradeOrigins("v0.1.0", []), ["pre-release-v17"]);
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

test("given the upgrade verifier, when it is inspected, then representative row contents are hashed", () => {
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
  assert.match(releaseWorkflow, /needs: \[build, image, qualify, upgrade\]/);
});
