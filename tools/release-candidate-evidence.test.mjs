import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  candidateRecord,
  candidateRuns,
  findCandidateRun,
  verifyCandidateEvidence
} from "./release-candidate-evidence.mjs";

const tool = fileURLToPath(new URL("./release-candidate-evidence.mjs", import.meta.url));
const commit = "a".repeat(40);
const imageDigest = `sha256:${"1".repeat(64)}`;
const bookingSeedDigest = `sha256:${"2".repeat(64)}`;
const archiveSha256 = "3".repeat(64);
const jobs = ["preconditions", "release-build", "image", "archive", "qualify", "gates"];

function results(overrides = {}) {
  return Object.fromEntries(["select", ...jobs].map((job) => [job, { result: overrides[job] ?? "success", outputs: {} }]));
}

function record({ rehearsal = false, ref = "refs/heads/main", runId = 42, ...overrides } = {}) {
  return candidateRecord({
    repository: "jegr78/courtside", commit, version: "0.1.0", rehearsal, runId, runAttempt: 1,
    workflowRef: `jegr78/courtside/.github/workflows/release-candidate.yml@${ref}`, ref,
    imageDigest, bookingSeedDigest, archive: { name: "courtside-deployment-0.1.0.zip", sha256: archiveSha256 },
    results: results(), ...overrides
  });
}

const expected = { commit, version: "0.1.0", runId: 42, mode: "release", archiveSha256 };

test("given a candidate whose every job succeeded, when its evidence is verified, then the promotion reads its digests", () => {
  // when
  const verified = verifyCandidateEvidence(record(), expected);

  // then
  assert.deepEqual(verified, {
    runId: 42, version: "0.1.0",
    image: `ghcr.io/jegr78/courtside@${imageDigest}`,
    bookingSeedImage: `ghcr.io/jegr78/courtside@${bookingSeedDigest}`,
    archiveSha256
  }, "the promotion takes its digests and the archive checksum from the verified record");
});

test("given a job that did not succeed, when evidence is written, then no passed record exists", () => {
  // when / then
  for (const outcome of ["failure", "skipped", "cancelled"]) {
    for (const job of jobs) {
      assert.throws(() => record({ results: results({ [job]: outcome }) }), new RegExp(`${job} is ${outcome}`),
        `a candidate whose ${job} job is ${outcome} must not record a pass`);
    }
  }
  assert.throws(() => record({ results: { ...results(), gates: undefined } }), /gates is missing/);
});

test("given evidence for another commit or version, when it is verified, then it is refused", () => {
  // when / then
  assert.throws(() => verifyCandidateEvidence(record(), { ...expected, commit: "b".repeat(40) }), /records commit/);
  assert.throws(() => verifyCandidateEvidence(record(), { ...expected, version: "0.1.1" }), /records version 0\.1\.0/);
  assert.throws(() => verifyCandidateEvidence(record(), { ...expected, runId: 43 }), /records run 42/);
});

test("given a rehearsal record, when a release verifies it, then it is refused, and the reverse as well", () => {
  // when / then
  assert.throws(() => verifyCandidateEvidence(record({ rehearsal: true }), expected), /rehearsal record/);
  assert.throws(() => verifyCandidateEvidence(record(), { ...expected, mode: "rehearsal" }), /release record/);
});

test("given a rehearsal, when no version is named, then the record's version is taken, but a release must name one", () => {
  // when
  const rehearsal = verifyCandidateEvidence(record({ rehearsal: true, ref: "refs/heads/ci/rehearsal" }),
    { ...expected, mode: "rehearsal", version: "" });

  // then
  assert.equal(rehearsal.version, "0.1.0", "a promotion rehearsal has no tag to read its version from");
  assert.throws(() => verifyCandidateEvidence(record(), { ...expected, version: "" }), /a release names its version/);
});

test("given a release record from a branch run, when it is verified, then it is refused", () => {
  // when / then
  assert.throws(() => verifyCandidateEvidence(record({ ref: "refs/heads/feature" }), expected), /ran on refs\/heads\/feature/);
});

test("given a malformed digest or archive checksum, when evidence is verified, then it is refused", () => {
  // given
  const valid = record();

  // when / then
  for (const forged of [
    { ...valid, image: "ghcr.io/jegr78/courtside:latest" },
    { ...valid, bookingSeedImage: `ghcr.io/someone/courtside@${bookingSeedDigest}` },
    { ...valid, archive: { ...valid.archive, sha256: "short" } }
  ]) {
    assert.throws(() => verifyCandidateEvidence(forged, expected), /malformed/);
  }
  assert.throws(() => record({ imageDigest: "sha256:abc" }), /malformed/);
});

test("given an archive whose bytes differ from the record, when evidence is verified, then it is refused", () => {
  // when / then
  assert.throws(() => verifyCandidateEvidence(record(), { ...expected, archiveSha256: "4".repeat(64) }),
    /archive .* does not match/);
});

test("given a record with a skipped job or a foreign workflow, when it is verified, then it is refused", () => {
  // given
  const valid = record();

  // when / then
  assert.throws(() => verifyCandidateEvidence({ ...valid, jobs: { ...valid.jobs, qualify: "skipped" } }, expected),
    /qualify is skipped/);
  assert.throws(() => verifyCandidateEvidence({ ...valid, workflow: ".github/workflows/build.yml" }, expected),
    /written by \.github\/workflows\/build\.yml/);
  assert.throws(() => verifyCandidateEvidence({ ...valid, outcome: "failed" }, expected), /incomplete or invalid/);
  assert.throws(() => verifyCandidateEvidence({ ...valid, extra: true }, expected), /incomplete or invalid/);
});

function api({ runs: runSpecs }) {
  const artifacts = runSpecs.map(({ id, expired = false, name = `release-candidate-evidence-${commit}`, branch = "main" }) =>
    ({ id: id * 10, name, expired, workflow_run: { id, head_branch: branch } }));
  const runs = Object.fromEntries(runSpecs.map(({ id, path = ".github/workflows/release-candidate.yml",
    event = "workflow_dispatch", branch = "main" }) => [id, { id, path, event, head_branch: branch }]));
  const runJobs = Object.fromEntries(runSpecs.map(({ id, evidence = "success" }) =>
    [id, evidence === null ? [{ name: "gates", conclusion: "success" }] : [{ name: "evidence", conclusion: evidence }]]));
  const records = Object.fromEntries(runSpecs.map(({ id, rehearsal = false }) => [id, { rehearsal }]));
  return { artifacts: [{ artifacts }], runs, jobs: runJobs, records };
}

test("given several candidate runs, when the release looks one up, then the newest qualifying release run wins", () => {
  // given
  const data = api({ runs: [{ id: 100 }, { id: 300, rehearsal: true }, { id: 200 }] });

  // when
  const found = findCandidateRun({ ...data, commit, mode: "release" });

  // then
  assert.deepEqual(found, { runId: 200, artifact: `release-candidate-evidence-${commit}` },
    "a later rehearsal on main must not shadow the real candidate");
  assert.equal(findCandidateRun({ ...data, commit, mode: "rehearsal" }).runId, 300);
});

test("given runs that do not qualify, when the release looks one up, then none of them is found", () => {
  // given
  const disqualified = [
    { id: 1, path: ".github/workflows/build.yml" },
    { id: 2, branch: "feature" },
    { id: 3, evidence: "failure" },
    { id: 4, evidence: null },
    { id: 5, expired: true },
    { id: 6, event: "push" },
    { id: 7, name: `release-candidate-evidence-${"b".repeat(40)}` }
  ];

  // when / then
  for (const run of disqualified) {
    assert.deepEqual(candidateRuns({ ...api({ runs: [run] }), commit, mode: "release" }), [],
      `run ${JSON.stringify(run)} is not a candidate for a release`);
    assert.throws(() => findCandidateRun({ ...api({ runs: [run] }), commit, mode: "release" }),
      /no candidate evidence/);
  }
});

test("given a rehearsal on a branch, when a rehearsal looks it up, then the branch run qualifies", () => {
  // given
  const data = api({ runs: [{ id: 9, branch: "ci/release-candidate-rehearsal", rehearsal: true }] });

  // when / then
  assert.equal(findCandidateRun({ ...data, commit, mode: "rehearsal" }).runId, 9);
  assert.throws(() => findCandidateRun({ ...data, commit, mode: "release" }), /no candidate evidence/);
});

test("given the command line, when a candidate writes its evidence, then the verification reads it back with the archive", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-candidate-evidence-"));
  const archive = join(directory, "courtside-deployment-0.1.0.zip");
  writeFileSync(archive, "archive bytes");
  const environment = { ...process.env, GITHUB_REPOSITORY: "jegr78/courtside", GITHUB_RUN_ID: "42",
    GITHUB_RUN_ATTEMPT: "2", GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF: "jegr78/courtside/.github/workflows/release-candidate.yml@refs/heads/main" };
  const output = join(directory, "evidence.json");
  const githubOutput = join(directory, "github-output");
  writeFileSync(githubOutput, "");

  // when
  execFileSync(process.execPath, [tool, "--write", "--commit", commit, "--version", "0.1.0", "--rehearsal", "false",
    "--image-digest", imageDigest, "--booking-seed-digest", bookingSeedDigest, "--archive", archive,
    "--results", JSON.stringify(results()), "--output", output], { env: environment });
  execFileSync(process.execPath, [tool, "--verify", "--evidence", output, "--commit", commit, "--version", "0.1.0",
    "--run-id", "42", "--mode", "release", "--archive", archive, "--github-output", githubOutput], { env: environment });

  // then
  const written = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(written.archive.sha256, createHash("sha256").update("archive bytes").digest("hex"));
  assert.equal(written.runAttempt, 2);
  assert.match(readFileSync(githubOutput, "utf8"), new RegExp(`^image=ghcr\\.io/jegr78/courtside@${imageDigest}$`, "m"));
  writeFileSync(archive, "other bytes");
  assert.throws(() => execFileSync(process.execPath, [tool, "--verify", "--evidence", output, "--commit", commit,
    "--version", "0.1.0", "--run-id", "42", "--mode", "release", "--archive", archive], { env: environment, stdio: "pipe" }),
  /does not match/, "a replaced archive must not pass as the qualified one");
});
