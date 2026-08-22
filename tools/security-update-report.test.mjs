import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runtimeComparisonRequired, securityRuntimeFiles, securityUpdateReport, semanticChanges,
  semanticJsonChanges } from "./security-update-report.mjs";

test("given a proposed security-tool update, when comparing it with the base, then versions policies and schemas are visible", () => {
  // when
  const report = securityUpdateReport("origin/main");

  // then
  assert.match(report, /Previous runtime tools:/);
  assert.match(report, /Current runtime tools:/);
  assert.match(report, /security\/run-contract\.json/);
  assert.match(report, /security\/assessment-catalog\.json/);
  assert.match(report, /security\/assessment-gate\.schema\.json/);
  assert.match(report, /deploy\/compose\.security\.yaml/);
  assert.match(report, /Runtime comparison required: (?:yes|no)/);
  assert.match(report, /Previous SHA-256.*Current SHA-256.*Changed/);
  assert.match(report, /Rule and report-schema changes/);
});

test("given two runtime digests, when they are compared, then only a difference demands a run", () => {
  // when / then
  assert.equal(runtimeComparisonRequired({ baseRuntimeDigest: "a", candidateRuntimeDigest: "b" }), true);
  assert.equal(runtimeComparisonRequired({ baseRuntimeDigest: "a", candidateRuntimeDigest: "a" }), false);
});

// The first commit predates security/run-contract.json, so a base that lacks a file the working
// tree has is a fixed fact rather than a property of whichever branch runs this.
test("given a file the base never had, when it is compared, then it reads as added and not removed", () => {
  // given
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const firstCommit = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"],
    { cwd: repository, encoding: "utf8" }).trim();

  // when
  const changes = semanticChanges("security/run-contract.json", firstCommit);

  // then — swapped arguments would report the club's own rules as deleted
  assert.deepEqual(changes, { added: ["/"], removed: [], modified: [] });
});

test("given a changed rule file, when its JSON paths are compared, then each kind of change is named", () => {
  // given
  const previous = JSON.stringify({ tools: { zap: { version: "2.16.1", active: true } } });
  const current = JSON.stringify({ tools: { zap: { version: "2.17.0", failOn: "high" } } });

  // when
  const changes = semanticJsonChanges(previous, current);

  // then
  assert.deepEqual(changes.added, ["/tools/zap/failOn"]);
  assert.deepEqual(changes.removed, ["/tools/zap/active"]);
  assert.deepEqual(changes.modified, ["/tools/zap/version"]);
});

test("given a rule file that is new or gone, when it is compared, then the whole document is the change", () => {
  // when / then
  assert.deepEqual(semanticJsonChanges(null, "{}"), { added: ["/"], removed: [], modified: [] });
  assert.deepEqual(semanticJsonChanges("{}", null), { added: [], removed: ["/"], modified: [] });
});

test("given the assessment runtime, when identifying a candidate, then execution normalization and assets contribute", () => {
  // when
  const files = new Set(securityRuntimeFiles);

  // then
  for (const path of [
    "tools/courtside.mjs", "tools/security-environment.mjs", "tools/security-triage.mjs",
    "tools/security-request-gateway.py", "deploy/compose.security.yaml", "frontend/package-lock.json",
    "pom.xml", "security/run-contract.json", "security/resource-abuse.js"
  ]) assert.equal(files.has(path), true, path);
});
