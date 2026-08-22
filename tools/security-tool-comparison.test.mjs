import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compareSecurityToolRuns, comparisonSummary, unacknowledgedFindings } from "./security-tool-comparison.mjs";

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

const baseApplication = { imageDigest: fingerprint("a"), commit: "2".repeat(40) };

test("given paired immutable runs, when comparing a tool update, then new findings and provenance remain bound", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-tool-comparison-"));
  const baseRoot = runtimeRoot(root, "base-runtime");
  const candidateRoot = runtimeRoot(root, "candidate-runtime");
  const base = runFixture(root, "base", { application: baseApplication });
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
  // Each side ran its own revision, and the report says which — the findings are read beside it
  assert.equal(comparison.application.commit, "b".repeat(40));
  assert.equal(comparison.baseApplication.commit, "2".repeat(40));
});

test("given a base run from a revision that is not the base, when comparing, then the report fails closed", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-tool-comparison-"));
  const baseRoot = runtimeRoot(root, "base-runtime");
  const candidateRoot = runtimeRoot(root, "candidate-runtime");
  const base = runFixture(root, "base");
  const candidate = runFixture(root, "candidate");

  // when / then — the base image has to prove it carries the protected revision
  assert.throws(() => compareSecurityToolRuns({
    baseRoot, baseManifest: base.manifest, baseEvidence: base.evidence,
    baseRef: "2".repeat(40), baseContract: contractPath, baseCatalog: catalogPath,
    candidateRoot, candidateManifest: candidate.manifest, candidateEvidence: candidate.evidence,
    candidateRef: "b".repeat(40),
    candidateContract: contractPath, candidateCatalog: catalogPath
  }), /differs from the base revision/);
});

test("given runs for different fixtures or incomplete tool evidence, when comparing them, then the report fails closed", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-tool-comparison-"));
  const baseRoot = runtimeRoot(root, "base-runtime");
  const candidateRoot = runtimeRoot(root, "candidate-runtime");
  const base = runFixture(root, "base", { application: baseApplication });
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

test("given a comparison, when summarising it, then both revisions and both differences are named", () => {
  // given
  const comparison = {
    baseRef: "2".repeat(40), candidateRef: "b".repeat(40),
    application: { imageDigest: fingerprint("a"), commit: "b".repeat(40) },
    baseApplication: { imageDigest: fingerprint("a"), commit: "2".repeat(40) },
    newFindings: [fingerprint("9")], resolvedFindings: []
  };

  // when
  const summary = comparisonSummary(comparison);

  // then — the artifact nobody downloads is why this exists
  assert.match(summary, /New findings/);
  assert.match(summary, new RegExp(fingerprint("9")));
  assert.match(summary, /Resolved findings.*none/s);
  assert.match(summary, new RegExp("2".repeat(40)));
  assert.match(summary, new RegExp("b".repeat(40)));
});
