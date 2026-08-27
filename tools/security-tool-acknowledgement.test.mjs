import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { describeFindings, findingReport } from "./security-tool-acknowledgement.mjs";

const fingerprint = (character) => `sha256:${character.repeat(64)}`;
const cli = new URL("./security-tool-acknowledgement.mjs", import.meta.url).pathname;

function workspace() {
  return mkdtempSync(join(tmpdir(), "courtside-acknowledgement-"));
}

function evidenceDirectory(root, name, candidates, specificationDigest) {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "openapi-fuzz.json"),
    JSON.stringify({ outcome: "passed", candidates, ...(specificationDigest ? { specificationDigest } : {}) }));
  return directory;
}

const finding = {
  fingerprint: fingerprint("a"),
  state: "candidate",
  scanner: "schemathesis",
  ruleId: "contract-boundary",
  normalizedSurface: "PUT /api/admin/config",
  parameter: "slotMinutes",
  attackClass: "input-validation",
  provenance: { runId: "compare-head-1", attempt: 1 },
  evidence: [{
    id: "openapi-fuzz-1", status: "retained", classification: "restricted",
    digest: `sha256:${"c".repeat(64)}`, expiresOn: "2026-09-30",
    location: "build/security/compare-head-1/assessment/attempt-1/diagnostics/openapi-fuzz-1"
  }],
  regression: false
};

const comparison = {
  baseRef: "1".repeat(40), candidateRef: "2".repeat(40),
  base: { outcome: "failed" }, candidate: { outcome: "passed" },
  newFindings: [finding.fingerprint], resolvedFindings: []
};

test("given a finding the candidate carries, when describing the difference, then it is named rather than hashed", () => {
  // given
  const root = workspace();
  const directories = {
    candidate: evidenceDirectory(root, "candidate", [finding]),
    base: evidenceDirectory(root, "base", [])
  };

  // when
  const described = describeFindings([finding.fingerprint], directories);

  // then
  assert.deepEqual(described, [{
    fingerprint: finding.fingerprint, side: "candidate", scanner: "schemathesis",
    ruleId: "contract-boundary", normalizedSurface: "PUT /api/admin/config",
    parameter: "slotMinutes", attackClass: "input-validation"
  }]);
});

test("given a finding only the base carries, when describing the difference, then it is taken from there", () => {
  // given
  const root = workspace();
  const directories = {
    candidate: evidenceDirectory(root, "candidate", []),
    base: evidenceDirectory(root, "base", [finding])
  };

  // when
  const described = describeFindings([finding.fingerprint], directories);

  // then
  assert.equal(described[0].side, "base");
  assert.equal(described[0].ruleId, "contract-boundary");
});

test("given a fingerprint no evidence carries, when describing it, then it says so instead of dropping it", () => {
  // given
  const root = workspace();
  const directories = {
    candidate: evidenceDirectory(root, "candidate", []),
    base: evidenceDirectory(root, "base", [])
  };

  // when
  const described = describeFindings([fingerprint("b")], directories);

  // then
  assert.deepEqual(described, [{ fingerprint: fingerprint("b"), side: "unresolved" }]);
});

// The lifecycle schema keeps captured traffic out of the evidence array, which holds pointers and
// digests. Those still locate material a public artifact has no business naming.
test("given a described finding, when writing the report, then only the naming fields travel", () => {
  // given
  const root = workspace();
  const directories = {
    candidate: evidenceDirectory(root, "candidate", [finding]),
    base: evidenceDirectory(root, "base", [])
  };

  // when
  const report = findingReport(comparison, { acknowledged: [] }, directories);

  // then
  assert.match(report, /PUT \/api\/admin\/config/);
  assert.doesNotMatch(report, /diagnostics/);
  assert.doesNotMatch(report, new RegExp("c".repeat(64)));
  assert.doesNotMatch(report, /retained|restricted|compare-head-1/);
});

test("given an evidence directory that cannot be read, when writing the report, then it names the directory", () => {
  // given
  const root = workspace();
  const directories = {
    candidate: join(root, "never-written"),
    base: evidenceDirectory(root, "base", [])
  };

  // when
  const report = findingReport(comparison, { acknowledged: [] }, directories);

  // then
  assert.match(report, /could not be read/);
  assert.match(report, /candidate: .*never-written/);
  assert.match(report, /unresolved/);
});

test("given every difference acknowledged, when writing the report, then it names nothing to read", () => {
  // given
  const root = workspace();
  const directories = {
    candidate: evidenceDirectory(root, "candidate", [finding]),
    base: evidenceDirectory(root, "base", [])
  };

  // when
  const report = findingReport(comparison, { acknowledged: [finding.fingerprint] }, directories);

  // then
  assert.match(report, /Unacknowledged: none/);
});

function runCli(acknowledged, contracts = {}) {
  const root = workspace();
  const directories = {
    candidate: evidenceDirectory(root, "candidate", [finding], contracts.candidate),
    base: evidenceDirectory(root, "base", [], contracts.base)
  };
  const comparisonFile = join(root, "runtime.json");
  const acknowledgementFile = join(root, "acknowledgement.json");
  const summaryFile = join(root, "summary.md");
  writeFileSync(comparisonFile, JSON.stringify(comparison));
  writeFileSync(acknowledgementFile, JSON.stringify({ acknowledged }));
  try {
    execFileSync(process.execPath, [cli, "--comparison", comparisonFile,
      "--acknowledgement", acknowledgementFile, "--summary", summaryFile,
      "--candidate-evidence", directories.candidate, "--base-evidence", directories.base],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stderr: "" };
  } catch (failure) {
    return { status: failure.status, stderr: failure.stderr };
  }
}

test("given an unacknowledged difference, when the command runs, then it fails and names the finding", () => {
  // when
  const result = runCli([]);

  // then
  assert.equal(result.status, 1);
  assert.match(result.stderr, /contract-boundary \/ PUT \/api\/admin\/config \/ slotMinutes/);
});

test("given the difference acknowledged, when the command runs, then it passes", () => {
  // when
  const result = runCli([finding.fingerprint]);

  // then
  assert.equal(result.status, 0);
});

test("given an option used where a value belongs, when the command runs, then it refuses instead of accepting it", () => {
  // when / then
  assert.throws(() => execFileSync(process.execPath,
    [cli, "--comparison", "--acknowledgement", "--summary", "a",
      "--candidate-evidence", "b", "--base-evidence", "c", "--extra", "d"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /Usage:/);
});

// The workflow points both runs at one document. Without this the property is wiring nobody checks,
// and a difference caused by a contract change reads exactly like one caused by the tools.
test("given two runs that read different contracts, when the command runs, then it refuses to attribute anything", () => {
  // when
  const result = runCli([finding.fingerprint],
    { candidate: `sha256:${"1".repeat(64)}`, base: `sha256:${"2".repeat(64)}` });

  // then
  assert.equal(result.status, 1);
  assert.match(result.stderr, /read different API documents/);
});

test("given two runs that read one contract, when the command runs, then it judges the findings", () => {
  // when
  const result = runCli([finding.fingerprint],
    { candidate: `sha256:${"1".repeat(64)}`, base: `sha256:${"1".repeat(64)}` });

  // then
  assert.equal(result.status, 0);
});
