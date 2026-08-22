import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { describeFindings, findingReport } from "./security-tool-acknowledgement.mjs";

const fingerprint = (character) => `sha256:${character.repeat(64)}`;

function evidenceDirectory(name, candidates) {
  const directory = join(mkdtempSync(join(tmpdir(), "courtside-acknowledgement-")), name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "openapi-fuzz.json"), JSON.stringify({ outcome: "passed", candidates }));
  return directory;
}

const finding = {
  fingerprint: fingerprint("a"),
  state: "candidate",
  scanner: "schemathesis",
  ruleId: "server_error",
  normalizedSurface: "PUT /api/admin/config",
  parameter: "slotMinutes",
  attackClass: "input-validation",
  evidence: [{ request: "Cookie: SESSION=a-real-looking-session-value" }]
};

test("given a finding the candidate carries, when describing the difference, then it is named rather than hashed", () => {
  // given
  const candidate = evidenceDirectory("candidate", [finding]);

  // when
  const described = describeFindings([finding.fingerprint], { candidate, base: evidenceDirectory("base", []) });

  // then
  assert.deepEqual(described, [{
    fingerprint: finding.fingerprint, side: "candidate", scanner: "schemathesis",
    ruleId: "server_error", normalizedSurface: "PUT /api/admin/config",
    parameter: "slotMinutes", attackClass: "input-validation"
  }]);
});

test("given a finding only the base carries, when describing the difference, then it is taken from there", () => {
  // given
  const base = evidenceDirectory("base", [finding]);

  // when
  const described = describeFindings([finding.fingerprint], { candidate: evidenceDirectory("candidate", []), base });

  // then
  assert.equal(described[0].side, "base");
  assert.equal(described[0].ruleId, "server_error");
});

test("given a fingerprint no evidence carries, when describing it, then it says so instead of dropping it", () => {
  // given
  const empty = { candidate: evidenceDirectory("candidate", []), base: evidenceDirectory("base", []) };

  // when
  const described = describeFindings([fingerprint("b")], empty);

  // then
  assert.deepEqual(described, [{ fingerprint: fingerprint("b"), side: "unresolved" }]);
});

test("given a described finding, when writing the report, then the scanner's own evidence stays out of it", () => {
  // given
  const directories = { candidate: evidenceDirectory("candidate", [finding]), base: evidenceDirectory("base", []) };
  const comparison = { baseRef: "1".repeat(40), candidateRef: "2".repeat(40),
    newFindings: [finding.fingerprint], resolvedFindings: [] };

  // when
  const report = findingReport(comparison, { acknowledged: [] }, directories);

  // then
  assert.match(report, /PUT \/api\/admin\/config/);
  assert.doesNotMatch(report, /SESSION=/);
});

test("given every difference acknowledged, when writing the report, then it names nothing to read", () => {
  // given
  const directories = { candidate: evidenceDirectory("candidate", [finding]), base: evidenceDirectory("base", []) };
  const comparison = { baseRef: "1".repeat(40), candidateRef: "2".repeat(40),
    newFindings: [finding.fingerprint], resolvedFindings: [] };

  // when
  const report = findingReport(comparison, { acknowledged: [finding.fingerprint] }, directories);

  // then
  assert.match(report, /Unacknowledged: none/);
});
