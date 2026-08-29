import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { compareSecurityToolRuns, comparisonSummary, unacknowledgedFindings,
  untoleratedBaseFailures } from "./security-tool-comparison.mjs";

const fingerprint = (character) => `sha256:${character.repeat(64)}`;
const contractPath = new URL("../security/run-contract.json", import.meta.url);
const catalogPath = new URL("../security/assessment-catalog.json", import.meta.url);
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const selectedTests = contract.selectedTests.filter((testId) =>
  catalog.tests.some((entry) => entry.id === testId && entry.profile === "active"));
const tools = contract.tools.filter((tool) => tool.id === "target-identity"
  || tool.testIds.some((testId) => selectedTests.includes(testId)));
const evidenceNames = ["authenticated-zap.json", "openapi-fuzz.json", "authorization-matrix.json"];

function runtimeRoot(root, name) {
  const runtime = join(root, name);
  for (const directory of ["security", "tools", "deploy", "frontend"]) {
    mkdirSync(join(runtime, directory), { recursive: true });
  }
  for (const path of ["pom.xml", "deploy/compose.security.yaml", "deploy/Caddyfile.security",
    "frontend/package.json", "frontend/package-lock.json", "tools/courtside.mjs"]) {
    writeFileSync(join(runtime, path), path);
  }
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false,
    required: ["outcome", "candidates"], properties: {
      outcome: { enum: ["passed", "failed", "incomplete"] },
      operations: { type: "array" },
      candidates: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["fingerprint"], properties: { fingerprint: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } } } }
    }
  };
  for (const name of ["authenticated-zap", "openapi-fuzz", "authorization"]) {
    writeFileSync(join(runtime, "security", `${name}-evidence.schema.json`), JSON.stringify(schema));
  }
  return runtime;
}

function runFixture(root, name, overrides = {}) {
  const directory = join(root, name);
  const evidence = join(directory, "evidence");
  mkdirSync(evidence, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    runId: `compare-${name}`,
    attempt: 1,
    status: "finished",
    outcome: "incomplete",
    profile: "active",
    target: "https://127.0.0.1:8443",
    environment: "SECURITY",
    application: { imageDigest: fingerprint("a"), commit: "b".repeat(40) },
    targetFingerprint: fingerprint("c"),
    seedFingerprint: fingerprint("d"),
    instanceFingerprint: fingerprint("e"),
    catalogVersion: catalog.catalogVersion,
    tools,
    selectedTests,
    budgets: contract.profiles.active,
    startedAt: "2026-08-22T00:00:00.000Z",
    finishedAt: "2026-08-22T00:01:00.000Z",
    toolResults: tools.map(({ id, version }) => ({ id, version, outcome: id === "target-identity" ? "passed" : "incomplete" })),
    reason: "Candidate findings require triage",
    usage: { requests: 1, generatedDataMegabytes: 0, evidenceBytes: 100 },
    ...overrides
  };
  const manifestPath = join(directory, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  for (const evidenceName of evidenceNames) {
    writeFileSync(join(evidence, evidenceName), JSON.stringify({ outcome: "incomplete",
      candidates: [{ fingerprint: fingerprint("7") }] }));
  }
  return { manifest: manifestPath, evidence };
}

test("given paired immutable runs, when comparing a tool update, then new findings and provenance remain bound", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-tool-comparison-"));
  const baseRoot = runtimeRoot(root, "base-runtime");
  const candidateRoot = runtimeRoot(root, "candidate-runtime");
  const base = runFixture(root, "base");
  const candidate = runFixture(root, "candidate");
  writeFileSync(join(base.evidence, "authenticated-zap.json"),
    JSON.stringify({ outcome: "incomplete", candidates: [{ fingerprint: fingerprint("f") }] }));
  writeFileSync(join(candidate.evidence, "authenticated-zap.json"),
    JSON.stringify({ outcome: "incomplete", candidates: [{ fingerprint: fingerprint("9") }] }));

  // when
  const comparison = compareSecurityToolRuns({
    baseRoot, baseManifest: base.manifest, baseEvidence: base.evidence,
    baseRef: "2".repeat(40), baseContract: contractPath, baseCatalog: catalogPath,
    candidateRoot, candidateManifest: candidate.manifest, candidateEvidence: candidate.evidence,
    candidateRef: "b".repeat(40),
    candidateContract: contractPath, candidateCatalog: catalogPath
  });

  // then
  assert.deepEqual(comparison.newFindings, [fingerprint("9")]);
  assert.deepEqual(comparison.resolvedFindings, [fingerprint("f")]);
  assert.equal(comparison.baseRef, "2".repeat(40));
  assert.match(comparison.candidate.runtimeDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(comparison.base.toolResults.map(({ outcome }) => outcome).toSorted(),
    ["incomplete", "incomplete", "incomplete", "passed"]);
});

test("given an unattributed incomplete baseline, when the candidate passes, then the repair can be compared", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-tool-comparison-"));
  const baseRoot = runtimeRoot(root, "base-runtime");
  const candidateRoot = runtimeRoot(root, "candidate-runtime");
  const base = runFixture(root, "base", {
    toolResults: tools.map(({ id, version }) => ({ id, version,
      outcome: id === "openapi-fuzzer" ? "incomplete" : "passed" }))
  });
  const candidate = runFixture(root, "candidate", {
    outcome: "passed", reason: null,
    toolResults: tools.map(({ id, version }) => ({ id, version, outcome: "passed" }))
  });
  for (const evidenceName of evidenceNames) {
    writeFileSync(join(base.evidence, evidenceName), JSON.stringify({
      outcome: evidenceName === "openapi-fuzz.json" ? "incomplete" : "passed", candidates: []
    }));
    writeFileSync(join(candidate.evidence, evidenceName), JSON.stringify({ outcome: "passed", candidates: [] }));
  }

  // when
  const comparison = compareSecurityToolRuns({
    baseRoot, baseManifest: base.manifest, baseEvidence: base.evidence,
    baseRef: "2".repeat(40), baseContract: contractPath, baseCatalog: catalogPath,
    candidateRoot, candidateManifest: candidate.manifest, candidateEvidence: candidate.evidence,
    candidateRef: "b".repeat(40), candidateContract: contractPath, candidateCatalog: catalogPath
  });

  // then
  assert.equal(comparison.base.outcome, "incomplete");
  assert.equal(comparison.candidate.outcome, "passed");
  assert.deepEqual(comparison.newFindings, []);
  assert.deepEqual(comparison.resolvedFindings, []);
});

test("given an unattributed incomplete baseline, when the candidate stays incomplete, then comparison fails closed", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-tool-comparison-"));
  const baseRoot = runtimeRoot(root, "base-runtime");
  const candidateRoot = runtimeRoot(root, "candidate-runtime");
  const base = runFixture(root, "base");
  const candidate = runFixture(root, "candidate");
  writeFileSync(join(base.evidence, "openapi-fuzz.json"),
    JSON.stringify({ outcome: "incomplete", candidates: [] }));
  writeFileSync(join(candidate.evidence, "openapi-fuzz.json"),
    JSON.stringify({ outcome: "incomplete", candidates: [],
      operations: [{ operationId: "uploadClubLogo", method: "POST", path: "/api/admin/config/logo",
        outcomes: [{ mode: "negative", outcome: "incomplete", observation: "candidate-requires-triage" }] }] }));

  // when / then
  assert.throws(() => compareSecurityToolRuns({
    baseRoot, baseManifest: base.manifest, baseEvidence: base.evidence,
    baseRef: "2".repeat(40), baseContract: contractPath, baseCatalog: catalogPath,
    candidateRoot, candidateManifest: candidate.manifest, candidateEvidence: candidate.evidence,
    candidateRef: "b".repeat(40), candidateContract: contractPath, candidateCatalog: catalogPath
  }), /POST \/api\/admin\/config\/logo negative\/candidate-requires-triage/);
});

test("given runs for different fixtures or incomplete tool evidence, when comparing them, then the report fails closed", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-tool-comparison-"));
  const baseRoot = runtimeRoot(root, "base-runtime");
  const candidateRoot = runtimeRoot(root, "candidate-runtime");
  const base = runFixture(root, "base");
  const otherFixture = runFixture(root, "other", { seedFingerprint: fingerprint("8") });
  const missingTool = runFixture(root, "missing", { toolResults: [] });
  const wrongTool = runFixture(root, "wrong", {
    toolResults: [{ id: "different-tool", version: "1.0.0", outcome: "incomplete" }]
  });
  const failedCandidate = runFixture(root, "failed", {
    outcome: "failed",
    toolResults: tools.map(({ id, version }) => ({ id, version, outcome: id === "openapi-fuzzer" ? "failed" : "passed" }))
  });
  writeFileSync(join(failedCandidate.evidence, "authenticated-zap.json"), JSON.stringify({ outcome: "passed" }));
  writeFileSync(join(failedCandidate.evidence, "openapi-fuzz.json"), JSON.stringify({ outcome: "failed" }));
  writeFileSync(join(failedCandidate.evidence, "authorization-matrix.json"), JSON.stringify({ outcome: "passed" }));
  const invalidEvidence = runFixture(root, "invalid-evidence");
  writeFileSync(join(invalidEvidence.evidence, "openapi-fuzz.json"),
    JSON.stringify({ outcome: "incomplete", candidates: [{ fingerprint: fingerprint("7") }], rawResponse: "secret" }));
  const input = {
    baseRoot, baseManifest: base.manifest, baseEvidence: base.evidence,
    baseRef: "2".repeat(40), baseContract: contractPath, baseCatalog: catalogPath,
    candidateRoot, candidateEvidence: otherFixture.evidence,
    candidateRef: "b".repeat(40), candidateContract: contractPath, candidateCatalog: catalogPath
  };

  // when / then
  assert.throws(() => compareSecurityToolRuns({ ...input, candidateManifest: otherFixture.manifest }));
  assert.throws(() => compareSecurityToolRuns({
    ...input, candidateManifest: missingTool.manifest, candidateEvidence: missingTool.evidence
  }), /Candidate findings require triage/);
  assert.throws(() => compareSecurityToolRuns({
    ...input, candidateManifest: wrongTool.manifest, candidateEvidence: wrongTool.evidence
  }));
  assert.throws(() => compareSecurityToolRuns({
    ...input, candidateManifest: failedCandidate.manifest, candidateEvidence: failedCandidate.evidence
  }));
  assert.throws(() => compareSecurityToolRuns({
    ...input, candidateManifest: invalidEvidence.manifest, candidateEvidence: invalidEvidence.evidence
  }));
});

test("given a run that assessed another revision's application, when comparing, then the report fails closed", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-tool-comparison-"));
  const baseRoot = runtimeRoot(root, "base-runtime");
  const candidateRoot = runtimeRoot(root, "candidate-runtime");
  const elsewhere = { imageDigest: fingerprint("a"), commit: "7".repeat(40) };
  const base = runFixture(root, "base", { application: elsewhere });
  const candidate = runFixture(root, "candidate", { application: elsewhere });

  // when / then — the constant both runs share has to be the revision being merged, not just equal
  assert.throws(() => compareSecurityToolRuns({
    baseRoot, baseManifest: base.manifest, baseEvidence: base.evidence,
    baseRef: "2".repeat(40), baseContract: contractPath, baseCatalog: catalogPath,
    candidateRoot, candidateManifest: candidate.manifest, candidateEvidence: candidate.evidence,
    candidateRef: "b".repeat(40),
    candidateContract: contractPath, candidateCatalog: catalogPath
  }), /application of the candidate revision/);
});

test("given runs that assessed the base revision's application, when comparing, then the report fails closed", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-tool-comparison-"));
  const baseRoot = runtimeRoot(root, "base-runtime");
  const candidateRoot = runtimeRoot(root, "candidate-runtime");
  const beforeTheChange = { imageDigest: fingerprint("a"), commit: "2".repeat(40) };
  const base = runFixture(root, "base", { application: beforeTheChange });
  const candidate = runFixture(root, "candidate", { application: beforeTheChange });

  // when / then — a tool that detects what this branch repairs can never pass against the
  // application it repairs, so the application both runs share is the one being merged.
  assert.throws(() => compareSecurityToolRuns({
    baseRoot, baseManifest: base.manifest, baseEvidence: base.evidence,
    baseRef: "2".repeat(40), baseContract: contractPath, baseCatalog: catalogPath,
    candidateRoot, candidateManifest: candidate.manifest, candidateEvidence: candidate.evidence,
    candidateRef: "b".repeat(40),
    candidateContract: contractPath, candidateCatalog: catalogPath
  }), /application of the candidate revision/);
});

// A base toolchain that finishes and does not pass is the one judgement in the pair the branch did
// not write itself, so tolerating it is a named decision rather than a rule that always applies.
test("given a base toolchain that failed, when nobody named it, then the difference is reported", () => {
  // given
  const failedThere = { base: { toolResults: [
    { id: "authenticated-zap", version: "2.17.0", outcome: "passed" },
    { id: "authorization-matrix", version: "1.0.0", outcome: "failed" }] } };

  // when / then
  assert.deepEqual(untoleratedBaseFailures(failedThere, { toleratedBaseFailures: [] }),
    ["authorization-matrix"]);
  assert.deepEqual(untoleratedBaseFailures(failedThere, {}), ["authorization-matrix"]);
  assert.deepEqual(untoleratedBaseFailures(failedThere,
    { toleratedBaseFailures: ["authorization-matrix"] }), []);
});

test("given a candidate toolchain that failed, when the base names it, then the toleration does not reach it", () => {
  // given
  const failedHere = {
    base: { toolResults: [{ id: "authorization-matrix", version: "1.0.0", outcome: "passed" }] },
    candidate: { toolResults: [{ id: "authorization-matrix", version: "1.0.0", outcome: "failed" }] }
  };

  // when / then — the candidate's own failure is fatal in the comparator and nothing here softens it
  assert.deepEqual(untoleratedBaseFailures(failedHere,
    { toleratedBaseFailures: ["authorization-matrix"] }), []);
});

test("given a finding difference the acknowledgement does not name, when comparing, then it is reported", () => {
  // given
  const comparison = { newFindings: [fingerprint("9")], resolvedFindings: [fingerprint("f")] };

  // when / then — a difference is the point of the run, so it has to be seen before it passes
  assert.deepEqual(unacknowledgedFindings(comparison, { acknowledged: [fingerprint("9")] }),
    [fingerprint("f")]);
  assert.deepEqual(unacknowledgedFindings(comparison,
    { acknowledged: [fingerprint("f"), fingerprint("9")] }), []);
  assert.deepEqual(unacknowledgedFindings(
    { newFindings: [], resolvedFindings: [] }, { acknowledged: [] }), []);
});

test("given a comparison, when summarising it, then the constant, both toolchains and both outcomes are named", () => {
  // when
  const summary = comparisonSummary({
    baseRef: "2".repeat(40), candidateRef: "b".repeat(40),
    base: { outcome: "failed", findingFingerprints: [fingerprint("1"), fingerprint("2")] },
    candidate: { outcome: "passed", findingFingerprints: [fingerprint("1"), fingerprint("2"),
      fingerprint("3"), fingerprint("4"), fingerprint("5")] },
    newFindings: [fingerprint("9")], resolvedFindings: []
  });

  // then — the artifact nobody downloads is why this exists
  assert.match(summary, new RegExp(`assessed the application of .${"b".repeat(40)}`));
  assert.match(summary, new RegExp("2".repeat(40)));
  assert.match(summary, new RegExp(`New findings: .${fingerprint("9")}`));
  assert.match(summary, /Resolved findings: none/);
  // A base run the comparison tolerates is silent unless the summary says it fell.
  assert.match(summary, /base toolchain ended failed/);
  assert.match(summary, /candidate toolchain ended passed/);
  // Weakening a tool and the surface it reads together removes a finding from both legs at once,
  // so the difference stays empty and only these two counts show the corpus shrinking.
  assert.match(summary, /base toolchain produced 2 finding fingerprints, the candidate 5/);
});

// The parser pairs tokens positionally, so an argument whose value is missing silently takes the
// next option as its value and the comparison runs against a path nobody passed.
test("given an option where a value belongs, when the comparator starts, then it refuses the run", () => {
  // given
  const names = ["base-root", "base-manifest", "base-evidence", "base-ref", "base-contract", "base-catalog",
    "candidate-root", "candidate-manifest", "candidate-evidence",
    "candidate-ref", "candidate-contract", "candidate-catalog", "output"];
  const args = names.flatMap((name) => [`--${name}`, name === "output" ? "--sneaky" : name]);

  // when / then
  const failure = spawnSync(process.execPath,
    [new URL("./security-tool-comparison.mjs", import.meta.url).pathname, ...args],
    { encoding: "utf8" });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /required arguments are missing/);
});
