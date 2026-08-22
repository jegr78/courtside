import assert from "node:assert/strict";
import { test } from "node:test";
import { rmSync, writeFileSync } from "node:fs";
import { runtimeComparisonRequired, securityRuntimeFiles, securityRuntimeIdentity,
  securityUpdateReport, semanticChanges,
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

// A file this test writes itself, so no commit reachable from any base can hold it. Reading the
// direction off the repository's own history needs a checkout deep enough to reach a commit that
// predates the file, which a shallow one is not.
test("given a file no base can hold, when it is compared, then it reads as added and not removed", () => {
  // given
  const probe = `tools/comparison-direction-probe-${process.pid}.json`;
  const location = new URL(`../${probe}`, import.meta.url);
  writeFileSync(location, "{}");

  // when / then — swapped arguments would report the club's own rules as deleted
  try {
    assert.deepEqual(semanticChanges(probe, "HEAD"), { added: ["/"], removed: [], modified: [] });
  } finally {
    rmSync(location);
  }
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

test("given a change outside what the two runs vary, when deciding, then no paired assessment is required", () => {
  // given — the compose file and the Caddyfile describe the target both runs share
  const only = (path, previous, current) => ({
    previous: (candidate) => candidate === path ? previous : "same",
    current: (candidate) => candidate === path ? current : "same"
  });

  // when / then
  for (const path of ["deploy/compose.security.yaml", "deploy/Caddyfile.security"]) {
    assert.equal(runtimeComparisonRequired(
      securityRuntimeIdentity("HEAD", only(path, "before", "after"))), false,
    `${path} is the same on both sides by construction, so it cannot change what either run sees`);
  }
});

test("given a changed assessment file, when deciding, then a paired assessment is required", () => {
  // given
  const contract = {
    previous: (path) => path === "security/run-contract.json" ? "before" : "same",
    current: (path) => path === "security/run-contract.json" ? "after" : "same"
  };

  // when / then
  assert.equal(runtimeComparisonRequired(securityRuntimeIdentity("HEAD", contract)), true);
});

test("given the pinned node version, when it moves, then a paired assessment is required", () => {
  // given
  const pom = (version) => (path) =>
    path === "pom.xml" ? `<node.version>${version}</node.version>` : "same";

  // when / then
  assert.equal(runtimeComparisonRequired(securityRuntimeIdentity("HEAD",
    { previous: pom("v24.0.0"), current: pom("v26.5.1") })), true,
  "the tools run on the node the build pins, so moving it can change what they see");
  assert.equal(runtimeComparisonRequired(securityRuntimeIdentity("HEAD",
    { previous: pom("v26.5.1"), current: pom("v26.5.1") })), false,
  "and a pom.xml change that leaves that version alone must not spend ninety minutes");
});
