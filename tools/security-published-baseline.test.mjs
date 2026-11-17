import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { combineSecuritySummaries, evaluateSecurityReports, parseNpmReport } from "./security-findings.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const fixtures = join(toolsDirectory, "security-findings.fixtures");
const read = (name) => JSON.parse(readFileSync(join(fixtures, name), "utf8"));
const audit = () => read("frontend-npm-audit.json");
const lockfile = () => read("frontend-package-lock.json");
const today = "2026-11-17";
const picomatch = "1247710";

const candidate = (input = audit(), lock = lockfile()) => parseNpmReport(input, { version: "11.17.0", subject: "commit", lockfile: lock });
const baseline = (input = audit(), lock = lockfile(), release = "v0.5.0-rc.7") =>
  ({ release, reports: [parseNpmReport(input, { version: "11.17.0", subject: release, lockfile: lock })] });
const evaluate = (reports, baselineEvidence) => evaluateSecurityReports({
  reports, exceptions: [], scope: "release-build", subject: "commit", assessmentPolicy: "not-applicable", today,
  ...(baselineEvidence ? { baseline: baselineEvidence } : {})
});
const withoutPicomatch = () => {
  const input = audit();
  for (const entry of Object.values(input.vulnerabilities)) {
    entry.via = entry.via.filter((advisory) => typeof advisory === "string" || String(advisory.source) !== picomatch);
  }
  return input;
};

test("given a real audit, when parsed, then every advisory becomes one finding and dependency paths none", () => {
  // given
  const input = audit();
  const advisories = Object.entries(input.vulnerabilities)
    .flatMap(([name, entry]) => entry.via.filter((advisory) => typeof advisory === "object").map((advisory) => `${name}:${advisory.source}`));

  // when
  const report = candidate(input);

  // then
  assert.deepEqual(report.findings.map((finding) => `${finding.component}:${finding.id}`).toSorted(), advisories.toSorted(),
    "a package listed only through another package's advisory carries no finding of its own");
  assert.ok(!report.findings.some((finding) => finding.component === "vite"), "vite reaches picomatch only as a dependency path");
  const match = report.findings.find((finding) => finding.component === "picomatch");
  assert.equal(match.id, picomatch);
  assert.equal(match.dependencyScope, "dev", "the lockfile marks picomatch as a development dependency");
});

test("given a package with an old and a new advisory, when parsed, then each advisory is its own finding", () => {
  // given
  const input = { auditReportVersion: 2, vulnerabilities: { example: { severity: "high", range: "<3", nodes: ["node_modules/example"], via: [
    { source: 1, url: "https://github.com/advisories/GHSA-aaaa-aaaa-aaaa", severity: "moderate", range: "<2" },
    { source: 2, url: "https://github.com/advisories/GHSA-bbbb-bbbb-bbbb", severity: "high", range: "<3" }
  ] } } };

  // when
  const report = parseNpmReport(input, { version: "11.17.0", subject: "commit" });

  // then
  assert.deepEqual(report.findings.map((finding) => [finding.id, finding.severity]), [["1", "MODERATE"], ["2", "HIGH"]],
    "a new advisory cannot hide behind the identity of an older one");
  assert.equal(report.findings[0].dependencyScope, "unknown", "without a lockfile the scope is not guessed");
});

test("given the published release has the same advisory, when evaluated, then it is pre-existing and does not block", () => {
  // when
  const result = evaluate([candidate()], baseline());

  // then
  assert.equal(result.status, "passed");
  assert.deepEqual(result.blockingFindings, []);
  assert.ok(result.preExistingFindings.some((finding) => finding.id === picomatch), "the gap stays visible");
  assert.deepEqual(result.baseline, { release: "v0.5.0-rc.7", sources: [
    { scanner: "npm", version: "11.17.0", status: "completed", subject: "v0.5.0-rc.7", findingCount: candidate().findings.length }
  ] });
});

test("given the published release lacks an advisory, when evaluated, then the candidate's finding blocks", () => {
  // when
  const result = evaluate([candidate()], baseline(withoutPicomatch()));

  // then
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockingFindings.map((finding) => finding.id), [picomatch]);
  assert.ok(!result.preExistingFindings.some((finding) => finding.id === picomatch));
});

test("given a development dependency that became a production dependency, when evaluated, then it blocks", () => {
  // given
  const lock = lockfile();
  delete lock.packages["node_modules/picomatch"].dev;

  // when
  const result = evaluate([candidate(audit(), lock)], baseline());

  // then
  assert.ok(result.blockingFindings.some((finding) => finding.id === picomatch && finding.dependencyScope === "prod"),
    "shipping a gap that was only a build tool before is a new exposure");
});

test("given no usable baseline, when evaluated, then findings block as before and the reason is recorded", () => {
  // given
  const skipped = { release: "v0.5.0-rc.7", reports: [parseNpmReport({ schemaVersion: 1, status: "skipped", reason: "service-unavailable" },
    { version: "11.17.0", subject: "v0.5.0-rc.7" })] };

  // when
  const results = [evaluate([candidate()]), evaluate([candidate()], skipped), evaluate([candidate()], { release: null, reason: "no-published-ancestor" })];

  // then
  for (const result of results) assert.ok(result.blockingFindings.some((finding) => finding.id === picomatch), "an unknown baseline is not a pre-existing one");
  assert.equal(results[1].baseline.sources[0].status, "skipped");
  assert.deepEqual(results[2].baseline, { release: null, reason: "no-published-ancestor" });
});

test("given a candidate audit without its lockfile, when evaluated against a baseline, then nothing counts as pre-existing", () => {
  // when
  const result = evaluate([parseNpmReport(audit(), { version: "11.17.0", subject: "commit" })], baseline());

  // then
  assert.ok(result.blockingFindings.some((finding) => finding.id === picomatch));
  assert.deepEqual(result.preExistingFindings, []);
});

test("given summaries with and without pre-existing findings, when combined into a release record, then they stay visible", () => {
  // given
  const evaluated = evaluate([candidate()], baseline());
  const summary = (scope, subject, extra = {}) => ({
    schemaVersion: 1, scope, subject, assessmentPolicy: "not-applicable", generatedAt: `${today}T00:00:00.000Z`, status: "passed",
    evidenceSources: [{ scanner: "trivy", status: "completed", subject }], blockingFindings: [], acceptedFindings: [], informationalFindings: [], ...extra
  });
  const digest = `sha256:${"d".repeat(64)}`;
  const commit = "c".repeat(40);
  const gate = {
    schemaVersion: 1, generatedAt: `${today}T00:00:00.000Z`, runId: "release-active-0001", attempt: 1, profile: "active", status: "passed",
    subject: digest, sourceCommit: commit, targetFingerprint: `sha256:${"f".repeat(64)}`, catalogVersion: "1.0.0",
    tools: [{ id: "target-identity", version: "1.0.0" }], selectedTests: [],
    budgets: { durationSeconds: 1800, requests: 10000, concurrency: 10, generatedDataMegabytes: 100, cpu: 4, memoryMegabytes: 4096,
      evidenceMegabytes: 100, expectedDuration: "up to 30 minutes" },
    startedAt: `${today}T00:00:00.000Z`, finishedAt: `${today}T00:01:00.000Z`,
    toolResults: [{ id: "target-identity", version: "1.0.0", outcome: "passed" }],
    usage: { requests: 1, generatedDataMegabytes: 0, evidenceBytes: 512 }, manifestDigest: `sha256:${"a".repeat(64)}`
  };

  // when
  const record = combineSecuritySummaries({
    summaries: [
      { ...evaluated, subject: commit, evidenceSources: evaluated.evidenceSources.map((source) => ({ ...source, subject: commit })) },
      summary("release-image-amd64", digest), summary("release-image-arm64", digest)
    ],
    scope: "release", subject: digest, sourceSubject: commit, assessmentGates: [gate], today
  });

  // then
  assert.ok(record.preExistingFindings.some((finding) => finding.id === picomatch));
  assert.deepEqual(record.sources[0].baseline, evaluated.baseline, "the record names the release it was compared against");
});

test("given a baseline directory, when the policy CLI reads it, then a chosen release is compared and a missing one is named", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-baseline-from-"));
  const write = (path, value) => writeFileSync(join(directory, path), typeof value === "string" ? value : JSON.stringify(value));
  const exceptions = join(directory, "exceptions.json");
  writeFileSync(exceptions, JSON.stringify({ schemaVersion: 1, exceptions: [], dependencyExceptions: [] }));
  const run = (baselineDirectory) => spawnSync(process.execPath, [join(toolsDirectory, "security-findings.mjs"),
    "--npm", join(fixtures, "frontend-npm-audit.json"), "--npm-lockfile", join(fixtures, "frontend-package-lock.json"),
    "--baseline-from", baselineDirectory, "--npm-version", "11.17.0", "--exceptions", exceptions,
    "--assessment-policy", "not-applicable", "--scope", "release-build", "--subject", "commit", "--output", join(directory, "summary.json")],
  { encoding: "utf8" });
  for (const name of ["chosen", "none", "unaudited"]) mkdirSync(join(directory, name));
  write("chosen/baseline.json", { release: "v0.5.0-rc.7", inspected: [] });
  write("chosen/npm-audit.json", readFileSync(join(fixtures, "frontend-npm-audit.json"), "utf8"));
  write("chosen/package-lock.json", readFileSync(join(fixtures, "frontend-package-lock.json"), "utf8"));
  write("none/baseline.json", { release: null, reason: "no-published-ancestor-with-completed-npm-audit", inspected: [] });
  write("unaudited/baseline.json", { release: "v0.5.0-rc.7", inspected: [] });
  mkdirSync(join(directory, "older"));
  write("older/baseline.json", { release: "v0.5.0-rc.7", inspected: [] });
  write("older/npm-audit.json", withoutPicomatch());
  write("older/package-lock.json", readFileSync(join(fixtures, "frontend-package-lock.json"), "utf8"));

  try {
    // when
    const chosen = run(join(directory, "chosen"));
    const none = run(join(directory, "none"));
    const noneSummary = JSON.parse(readFileSync(join(directory, "summary.json"), "utf8"));
    const unaudited = run(join(directory, "unaudited"));
    const older = run(join(directory, "older"));

    // then
    assert.equal(chosen.status, 0, chosen.stderr);
    assert.equal(none.status, 1, "without a baseline the gap blocks as before");
    assert.deepEqual(noneSummary.baseline, { release: null, reason: "no-published-ancestor-with-completed-npm-audit" });
    assert.equal(unaudited.status, 1);
    assert.match(unaudited.stderr, /npm-audit\.json/, "a chosen release whose audit is missing fails closed and says what is missing");
    assert.equal(older.status, 1, "a gap the published release did not have still fails");
    assert.match(older.stderr, new RegExp(`npm:${picomatch}:picomatch`));
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("given an advisory without a known severity or source, when parsed, then the report is refused", () => {
  // given
  const report = (advisory) => ({ auditReportVersion: 2, vulnerabilities: { example: { severity: "high", range: "<3", nodes: ["node_modules/example"],
    via: [{ source: 1, url: "https://github.com/advisories/GHSA-aaaa-aaaa-aaaa", severity: "high", range: "<3", ...advisory }] } } });

  // when / then
  assert.throws(() => parseNpmReport(report({ severity: "High " })), /severity/, "an unknown severity cannot turn a finding informational");
  assert.throws(() => parseNpmReport(report({ source: undefined })), /source/, "an advisory without its id would share one identity with every other");
  assert.equal(parseNpmReport(report({})).findings.length, 1);
});
