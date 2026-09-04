import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { auditTimeoutMilliseconds, classifyAuditAttempt, executeNpmAudit, runAudit } from "./npm-audit.mjs";

const cleanReport = JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} });

test("given a valid audit report, when npm exits cleanly, then completed evidence is retained", () => {
  // when
  const result = classifyAuditAttempt({ status: 0, stdout: cleanReport, stderr: "" });

  // then
  assert.deepEqual(result, { status: "completed", report: JSON.parse(cleanReport) });
});

test("given a valid vulnerable report, when npm exits nonzero, then findings remain completed evidence", () => {
  // given
  const report = JSON.stringify({ auditReportVersion: 2, vulnerabilities: {
    example: { severity: "high", range: "<2", via: [] }
  } });

  // when
  const result = classifyAuditAttempt({ status: 1, stdout: report, stderr: "" });

  // then
  assert.equal(result.status, "completed");
  assert.equal(result.report.vulnerabilities.example.severity, "high");
});

test("given npm returns a report with an unexpected exit code, when classification runs, then it fails closed", () => {
  // when / then
  assert.throws(() => classifyAuditAttempt({ status: 2, stdout: cleanReport, stderr: "" }),
    /unexpected exit code/);
});

test("given the audit service is unavailable, when npm returns no report, then evidence says skipped", () => {
  // when
  const result = classifyAuditAttempt({
    status: 1, stdout: "", stderr: "npm warn audit 503 Service Unavailable\nnpm error audit endpoint returned an error"
  });

  // then
  assert.deepEqual(result, {
    status: "skipped", report: { schemaVersion: 1, status: "skipped", reason: "service-unavailable" }
  });
});

test("given npm returns its structured service error, when classification runs, then evidence says skipped", () => {
  // when
  const result = classifyAuditAttempt({
    status: 1,
    stdout: JSON.stringify({ error: { code: "E503", summary: "503 Service Unavailable", detail: "" } }),
    stderr: ""
  });

  // then
  assert.equal(result.report.reason, "service-unavailable");
});

test("given the audit request times out, when npm returns no report, then evidence says skipped", () => {
  // when
  const result = classifyAuditAttempt({
    status: 1, stdout: "", stderr: "npm warn audit network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk"
  });

  // then
  assert.equal(result.report.reason, "network-unavailable");
});

test("given the npm process exceeds its budget without network evidence, when execution ends, then it fails closed", () => {
  // when / then
  assert.throws(() => classifyAuditAttempt({
    status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" }
  }), /process budget/);
});

test("given npm is executed, when planning the child process, then it has a bounded six-minute budget", () => {
  // given
  let invocation;
  const execute = (...args) => {
    invocation = args;
    return { status: 0, stdout: cleanReport, stderr: "" };
  };

  // when
  executeNpmAudit(execute, { npm_execpath: "/opt/npm-cli.js" }, "/repo/frontend");

  // then
  assert.equal(auditTimeoutMilliseconds, 360_000);
  assert.equal(invocation[2].timeout, auditTimeoutMilliseconds);
  assert.equal(invocation[2].maxBuffer, 10 * 1024 * 1024);
  assert.equal(invocation[2].killSignal, "SIGKILL");
});

test("given malformed or unknown output, when classification runs, then it fails closed", () => {
  // when / then
  assert.throws(() => classifyAuditAttempt({ status: 1, stdout: "not json", stderr: "network timeout" }),
    /valid JSON/);
  assert.throws(() => classifyAuditAttempt({ status: 1, stdout: "{}", stderr: "" }),
    /valid audit report/);
  assert.throws(() => classifyAuditAttempt({ status: 1, stdout: "", stderr: "npm failed" }),
    /unclassified/);
  assert.throws(() => classifyAuditAttempt({
    status: 1, stdout: "", stderr: "npm error code E401\nnpm error audit endpoint returned an error"
  }), /unclassified/);
  assert.throws(() => classifyAuditAttempt({ status: 0, stdout: "", stderr: "" }),
    /produced no report/);
  assert.throws(() => classifyAuditAttempt({
    status: 1,
    stdout: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {
      example: { range: "<2", via: [] }
    } }),
    stderr: ""
  }), /severity/);
});

test("given an unavailable service, when the audit runner writes evidence, then it exits successfully with a skipped record", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-npm-audit-"));
  const output = join(directory, "npm.json");

  try {
    // when
    const result = runAudit({ output }, () => ({
      status: 1, stdout: "", stderr: "npm error code ETIMEDOUT"
    }));

    // then
    assert.equal(result.status, "skipped");
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), result.report);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
