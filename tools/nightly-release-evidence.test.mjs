import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findNightlyRelease, nightlyRunsOf, validateNightlyReleaseEvidence } from "./nightly-release-evidence.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const commit = "a".repeat(40);
const runId = 123;

const recordStep = yaml.load(readFileSync(
  fileURLToPath(new URL("../.github/workflows/build.yml", import.meta.url)), "utf8"))
  .jobs["nightly-release-evidence"].steps
  .find((step) => step.name === "Record the completed build and image contract");

function generated({ build = "success", nightlyImage = "success", releaseGates = "success", attempt = 1 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "courtside-nightly-evidence-"));
  const script = recordStep.run
    .replaceAll("${{ github.sha }}", commit)
    .replaceAll("${{ github.run_id }}", String(runId))
    .replaceAll("${{ github.run_attempt }}", String(attempt));
  execFileSync("bash", ["-c", script], {
    cwd: directory,
    env: { ...process.env, BUILD_RESULT: build, NIGHTLY_IMAGE_RESULT: nightlyImage,
      RELEASE_GATES_RESULT: releaseGates },
    stdio: "pipe"
  });
  return JSON.parse(readFileSync(join(directory, "build/nightly-release/evidence.json"), "utf8"));
}

test("given a nightly whose build, image and release gates succeeded, when its evidence is checked, then it qualifies",
  () => {
    // when / then
    assert.deepEqual(validateNightlyReleaseEvidence(generated(), { commit, runId }), { commit, runId });
  });

test("given a nightly that did not rehearse the release gates, when its evidence is checked, then it cannot qualify",
  () => {
    // given
    const unrehearsed = ["skipped", "failure", "cancelled"].map((releaseGates) => generated({ releaseGates }));

    // when / then
    for (const candidate of unrehearsed) {
      assert.equal(candidate.releaseReadiness, "incomplete", "the workflow itself records the missing rehearsal");
      assert.throws(() => validateNightlyReleaseEvidence(candidate, { commit, runId }),
        /coupled nightly evidence is incomplete or invalid/);
    }
  });

test("given evidence written before the release gates were rehearsed, when it is checked, then it cannot qualify",
  () => {
    // given
    const imageOnly = {
      schemaVersion: 1, contract: "coupled-nightly-image-v1", commit, runId, attempt: 1, firstAttempt: true,
      jobs: { build: "success", nightlyImage: "success" }, releaseReadiness: "complete"
    };

    // when / then
    for (const candidate of [null, imageOnly, { ...generated(), contract: undefined }]) {
      assert.throws(() => validateNightlyReleaseEvidence(candidate, { commit, runId }),
        /coupled nightly evidence is incomplete or invalid/);
    }
  });

test("given evidence from another run or revision, when it is checked, then it cannot be swapped in", () => {
  // when / then
  for (const [field, value] of [["commit", "c".repeat(40)], ["runId", 124]]) {
    assert.throws(() => validateNightlyReleaseEvidence({ ...generated(), [field]: value }, { commit, runId }),
      /does not match the selected run/);
  }
});

test("given an incomplete or repeated run, when it is checked, then it cannot qualify", () => {
  // given
  const cases = [
    generated({ attempt: 2 }),
    generated({ build: "failure" }),
    generated({ nightlyImage: "skipped" }),
    { ...generated(), contract: "build-only-v1" },
    { ...generated(), unreviewed: true },
    { ...generated(), jobs: { ...generated().jobs, unreviewed: "success" } }
  ];

  // when / then
  for (const candidate of cases) {
    assert.throws(() => validateNightlyReleaseEvidence(candidate, { commit, runId }));
  }
});

function run(overrides = {}) {
  return { id: runId, head_sha: commit, head_branch: "main", event: "schedule", run_attempt: 1, ...overrides };
}

test("given recorded build runs, when the nightly candidates are read, then only first attempts on the branch count", () => {
  // given
  const pages = [{ workflow_runs: [
    run(),
    run({ id: 124, event: "push" }),
    run({ id: 125, run_attempt: 2 }),
    run({ id: 126, head_branch: "release/0.1", event: "workflow_dispatch" }),
    run({ id: 127, head_sha: "main" })
  ] }, { workflow_runs: [run({ id: 128, event: "workflow_dispatch" })] }];

  // when / then
  assert.deepEqual(nightlyRunsOf(pages, "main"), [{ id: runId, head: commit }, { id: 128, head: commit }],
    "a push build rehearses no gates and a re-run attempt proves nothing on its first try");
  assert.deepEqual(nightlyRunsOf(pages, "release/0.1"), [{ id: 126, head: commit }],
    "a patch reads the dispatched build of its own release branch, never a main nightly");
});

test("given nightly candidates, when evidence is found, then the first ancestor whose evidence verifies is chosen", () => {
  // given
  const runs = [{ id: 130, head: "c".repeat(40) }, { id: 129, head: commit }, { id: runId, head: commit }];
  const evidence = new Map([[129, null], [runId, generated()]]);

  // when
  const found = findNightlyRelease({ runs, isAncestor: (head) => head === commit,
    evidenceOf: (id) => evidence.get(id) ?? null, branch: "main" });

  // then
  assert.deepEqual(found, { commit, runId }, "a run without downloadable evidence is skipped, not trusted");
});

test("given no nightly whose evidence verifies, when evidence is found, then the release is refused for that branch", () => {
  // when / then
  assert.throws(() => findNightlyRelease({ runs: [{ id: runId, head: commit }], isAncestor: () => true,
    evidenceOf: () => generated({ releaseGates: "skipped" }), branch: "release/0.1" }),
  /no green first-attempt build on release\/0\.1 with a completed nightly release rehearsal verified a commit this candidate builds on/);
  assert.throws(() => findNightlyRelease({ runs: [{ id: runId, head: commit }], isAncestor: () => false,
    evidenceOf: () => generated(), branch: "main" }), /no green first-attempt build on main/,
  "a nightly of a commit the release does not build on proves nothing about it");
});
