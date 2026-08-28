import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profiles = JSON.parse(readFileSync(new URL("../ci/test-profiles.json", import.meta.url)));
const observation = JSON.parse(readFileSync(new URL("../ci/test-profile-observation.json", import.meta.url)));

test("given the checked-in profile policy, when a merge smoke reads it, then every profile uses known jobs", () => {
  const full = new Set(observation.profiles.full);

  assert.deepEqual(Object.keys(profiles.profiles).sort(), Object.keys(observation.profiles).sort());
  for (const jobs of Object.values(observation.profiles)) {
    for (const job of jobs) {
      assert.ok(full.has(job), `${job} is not part of the full profile`);
    }
  }
});

test("given reduced profiles, when observation policy qualifies them, then both code surfaces remain required", () => {
  assert.deepEqual([...observation.requiredReducedProfiles].sort(), ["backend", "frontend"]);
  assert.ok(observation.minimumFirstAttempts >= observation.minimumReducedFirstAttempts);
});
