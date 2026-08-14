import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectUpgradeOrigins } from "./courtside.upgrade-smoke.mjs";

const releaseWorkflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)),
  "utf8"
);
const fixture = readFileSync(
  fileURLToPath(new URL("../upgrade/fixtures/pre-release-v17.sql", import.meta.url)),
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

test("given a release candidate, when release qualification runs, then every supported database origin blocks publication", () => {
  // when / then
  assert.match(releaseWorkflow, /id: upgrade-origins/);
  assert.match(releaseWorkflow, /node tools\/courtside\.upgrade-smoke\.mjs --confirm courtside-upgrade/);
  assert.match(releaseWorkflow, /COURTSIDE_UPGRADE_CANDIDATE_IMAGE:[^\n]+needs\.image\.outputs\.digest/);
  assert.match(releaseWorkflow, /Supported database upgrade origins/);
  assert.match(releaseWorkflow, /needs: \[build, image, qualify, upgrade\]/);
});
