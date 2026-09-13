import assert from "node:assert/strict";
import test from "node:test";
import { validateNightlyReleaseEvidence } from "./nightly-release-evidence.mjs";

const commit = "a".repeat(40);
const runId = 123;

function evidence() {
  return {
    schemaVersion: 1,
    contract: "coupled-nightly-image-v1",
    commit,
    runId,
    attempt: 1,
    firstAttempt: true,
    jobs: { build: "success", nightlyImage: "success" },
    releaseReadiness: "complete"
  };
}

test("given one successful coupled run, when its evidence is checked, then it qualifies", () => {
  assert.deepEqual(validateNightlyReleaseEvidence(evidence(), { commit, runId }), { commit, runId });
});

test("given legacy build-only evidence, when it is checked, then it cannot qualify", () => {
  for (const candidate of [null, { ...evidence(), contract: undefined }]) {
    assert.throws(() => validateNightlyReleaseEvidence(candidate, { commit, runId }),
      /coupled nightly evidence is incomplete or invalid/);
  }
});

test("given evidence from another run or revision, when it is checked, then it cannot be swapped in", () => {
  for (const [field, value] of [["commit", "c".repeat(40)], ["runId", 124]]) {
    assert.throws(() => validateNightlyReleaseEvidence({ ...evidence(), [field]: value }, { commit, runId }),
      /does not match the selected run/);
  }
});

test("given an incomplete or repeated run, when it is checked, then it cannot qualify", () => {
  const cases = [
    { ...evidence(), releaseReadiness: "incomplete" },
    { ...evidence(), attempt: 2, firstAttempt: false },
    { ...evidence(), jobs: { build: "failure", nightlyImage: "success" } },
    { ...evidence(), jobs: { build: "success", nightlyImage: "skipped" } },
    { ...evidence(), contract: "build-only-v1" },
    { ...evidence(), unreviewed: true },
    { ...evidence(), jobs: { build: "success", nightlyImage: "success", unreviewed: "success" } }
  ];
  for (const candidate of cases) {
    assert.throws(() => validateNightlyReleaseEvidence(candidate, { commit, runId }));
  }
});
