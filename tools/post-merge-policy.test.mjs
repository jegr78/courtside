import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profiles = JSON.parse(readFileSync(new URL("../ci/test-profiles.json", import.meta.url)));
const observation = JSON.parse(readFileSync(new URL("../ci/test-profile-observation.json", import.meta.url)));
const contract = JSON.parse(readFileSync(new URL("../ci/test-profile-contract.json", import.meta.url)));

test("given the checked-in profile policy, when a merge smoke reads it, then every profile uses known jobs", () => {
  // given
  const full = new Set(contract.profiles.full.ciJobs);

  // when / then
  assert.deepEqual(Object.keys(profiles.profiles).sort(), Object.keys(contract.profiles).sort());
  for (const coverage of Object.values(contract.profiles)) {
    for (const job of coverage.ciJobs) {
      assert.ok(full.has(job), `${job} is not part of the full profile`);
    }
  }
});

test("given reduced profiles, when observation policy qualifies them, then every application and tooling surface remains required", () => {
  // when / then
  assert.deepEqual([...observation.requiredReducedProfiles].sort(), ["backend", "frontend", "tooling"]);
  assert.ok(observation.minimumFirstAttempts >= observation.minimumReducedFirstAttempts);
  assert.ok(Number.isFinite(Date.parse(observation.evidenceWindowStartedAt)));
  assert.match(observation.requiredBaseCommit, /^[a-f0-9]{40}$/);
});
