import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  authorizeSecurityProfile, buildSecurityPlan, executeSecurityPlan, fingerprintSecurityTarget, recoverSecurityRun,
  redactSecurityText, securityRunContract, securityRunPaths, validateSecurityRedirect,
  validateSecurityTarget
} from "./security-runner.mjs";

test("given the same target identity in a different property order, when fingerprinting it, then the identity is stable", () => {
  // given
  const first = { target: "https://localhost:9443", image: { digest: "sha256:first", architecture: "arm64" } };
  const reordered = { image: { architecture: "arm64", digest: "sha256:first" }, target: "https://localhost:9443" };

  // when / then
  assert.equal(fingerprintSecurityTarget(first), fingerprintSecurityTarget(reordered));
  assert.notEqual(fingerprintSecurityTarget(first), fingerprintSecurityTarget({
    target: "https://localhost:9443", image: { digest: "sha256:second", architecture: "arm64" }
  }));
});

const digest = `sha256:${"a".repeat(64)}`;
const seedFingerprint = `sha256:${"b".repeat(64)}`;
const instanceFingerprint = `sha256:${"d".repeat(64)}`;
const targetFingerprint = `sha256:${"c".repeat(64)}`;
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const runContractSchema = JSON.parse(readFileSync(new URL("../security/run-contract.schema.json", import.meta.url)));
const runManifestSchema = JSON.parse(readFileSync(new URL("../security/run-manifest.schema.json", import.meta.url)));

function manifestValidator() {
  const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true, formats: false });
  ajv.addSchema(runContractSchema);
  return ajv.compile(runManifestSchema);
}

function input(overrides = {}) {
  return {
    runId: "run-0001",
    profile: "active",
    target: "https://localhost:23456",
    environment: "SECURITY",
    imageDigest: digest,
    imageArchitecture: "arm64",
    applicationCommit: "abcdef0123456789",
    seedFingerprint,
    instanceFingerprint,
    targetFingerprint,
    catalogVersion: "1.0.0",
    tools: [{ id: "target-identity", version: "1.0.0", testIds: [] }],
    selectedTests: [],
    authorization: "authorize-active-run-0001",
    ...overrides
  };
}

function activePlan() {
  const selectedTests = ["CSA-AUTHN-001", "CSA-AUTHZ-001", "CSA-DAST-001", "CSA-API-001", "CSA-IMPORT-001"];
  return buildSecurityPlan(input({
    tools: [
      { id: "target-identity", version: "1.0.0", testIds: [] },
      { id: "authenticated-zap", version: "2.17.0", testIds: ["CSA-DAST-001"] },
      { id: "openapi-fuzzer", version: "4.25.2", testIds: ["CSA-API-001", "CSA-IMPORT-001"] },
      { id: "authorization-matrix", version: "1.0.0", testIds: ["CSA-AUTHN-001", "CSA-AUTHZ-001"] }
    ],
    selectedTests,
    catalogTests: selectedTests.map((id) => ({ id, status: "implemented", profile: "active" }))
  }));
}

test("given every security profile, when reading its contract, then all resource and evidence budgets are bounded", () => {
  // given
  const validate = new Ajv({ strict: true, strictRequired: false, allErrors: true }).compile(runContractSchema);

  // when / then
  assert.equal(validate(securityRunContract), true, JSON.stringify(validate.errors));
  for (const profile of Object.values(securityRunContract.profiles)) {
    for (const field of ["durationSeconds", "requests", "concurrency", "cpu", "memoryMegabytes",
      "evidenceMegabytes"]) assert.ok(profile[field] > 0, field);
    assert.ok(profile.generatedDataMegabytes >= 0);
    assert.match(profile.expectedDuration, /^up to [1-9][0-9]* minutes$/);
  }
  assert.doesNotMatch(readFileSync(new URL("../deploy/compose.security.yaml", import.meta.url), "utf8"),
    /docker\.sock/);
});

test("given a path-like run identity, when resolving evidence, then it cannot leave the security root", () => {
  // when / then
  assert.throws(() => securityRunPaths("/tmp/security", "../../outside", 1), /Invalid security run ID/);
});

test("given a production-like target, when planning active traffic, then it is rejected before execution", () => {
  // when / then
  assert.throws(() => buildSecurityPlan(input({
    target: "https://club.example.org", environment: "EXPLICIT_PRODUCTION"
  })), /only supports the SECURITY environment/);
});

test("given a mismatched authorization, when planning an active run, then it is rejected", () => {
  // when / then
  assert.throws(() => buildSecurityPlan(input({ authorization: "authorize-active-run-0002" })),
    /exact authorization/);
});

test("given destructive authorization, when checking an active run, then it cannot authorize another profile", () => {
  // when / then
  assert.throws(() => authorizeSecurityProfile("active", "run-0001", "authorize-destructive-run-0001"),
    /exact authorization/);
});

test("given an explicitly authorized safe target, when validating it, then only its exact origin is allowed", () => {
  // when / then
  assert.equal(validateSecurityTarget("https://club.example.org", "safe", "https://club.example.org"),
    "https://club.example.org");
  assert.throws(() => validateSecurityTarget("https://other.example.org", "safe", "https://club.example.org"),
    /allowlist/);
  assert.throws(() => validateSecurityTarget("https://club.example.org/login", "safe", "https://club.example.org"),
    /bare HTTPS origin/);
});

test("given a redirect, when its origin differs, then the orchestrator rejects it", () => {
  // when / then
  assert.equal(validateSecurityRedirect("/login", "https://localhost:23456"),
    "https://localhost:23456/login");
  assert.throws(() => validateSecurityRedirect("https://other.example.org/callback", "https://localhost:23456"),
    /outside the target allowlist/);
});

test("given a security plan, when rendering a dry run, then budgets and authorization are explicit", () => {
  // when
  const plan = buildSecurityPlan(input());

  // then
  assert.equal(plan.profile, "active");
  assert.equal(plan.requiredAuthorization, "authorize-active-run-0001");
  assert.ok(plan.budgets.durationSeconds > 0);
  assert.ok(plan.budgets.requests > 0);
  assert.ok(plan.budgets.concurrency > 0);
  assert.ok(plan.budgets.generatedDataMegabytes > 0);
  assert.ok(plan.budgets.cpu > 0);
  assert.ok(plan.budgets.memoryMegabytes > 0);
  assert.ok(plan.budgets.evidenceMegabytes > 0);
  assert.deepEqual(plan.selectedTests, []);
});

test("given a selected test without an adapter, when planning it, then a passing run is impossible", () => {
  // when / then
  assert.throws(() => buildSecurityPlan(input({
    tools: [{ id: "target-identity", version: "1.0.0", testIds: [] }],
    selectedTests: ["CSA-SESS-001"]
  })), /No executable tool covers: CSA-SESS-001/);
});

test("given a planned catalog test, when selecting it, then the run cannot claim executable coverage", () => {
  // when / then
  assert.throws(() => buildSecurityPlan(input({
    tools: [{ id: "identity", version: "1.0.0", testIds: ["CSA-SESS-001"] }],
    selectedTests: ["CSA-SESS-001"],
    catalogTests: [{ id: "CSA-SESS-001", status: "planned", profile: "active" }]
  })), /not implemented/);
});

test("given a target verifier failure, when executing a run, then the immutable first attempt is incomplete", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-security-run-"));
  const plan = buildSecurityPlan(input());

  // when
  const manifest = await executeSecurityPlan(plan, {
    root,
    now: () => new Date("2026-08-19T12:00:00.000Z"),
    verifyTarget: async () => { throw new Error("target verification exited 2"); }
  });

  // then
  assert.equal(manifest.outcome, "incomplete");
  assert.match(manifest.reason, /target verification exited 2/);
  assert.equal(manifest.attempt, 1);
  const paths = securityRunPaths(root, "run-0001", 1);
  assert.equal(JSON.parse(readFileSync(paths.manifest, "utf8")).outcome, "incomplete");
  const validate = manifestValidator();
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
});

test("given an unregistered assessment tool, when execution starts, then no adapter is invoked", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-security-run-"));
  let executed = false;
  const plan = buildSecurityPlan(input({
    tools: [{ id: "scanner", version: "1.0.0", testIds: [] }]
  }));

  // when
  const manifest = await executeSecurityPlan(plan, {
    root,
    verifyTarget: async () => input(),
    executeTool: async () => { executed = true; }
  });

  // then
  assert.equal(executed, false);
  assert.equal(manifest.outcome, "incomplete");
  assert.match(manifest.reason, /isolated orchestrator-owned runner/);
});

test("given selected assessment tests, when execution starts, then no adapter is invoked", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-security-run-"));
  let executed = false;
  const plan = buildSecurityPlan(input({
    tools: [{ id: "target-identity", version: "1.0.0", testIds: ["CSA-SESS-001"] }],
    selectedTests: ["CSA-SESS-001"]
  }));

  // when
  const manifest = await executeSecurityPlan(plan, {
    root,
    verifyTarget: async () => input(),
    executeTool: async () => { executed = true; }
  });

  // then
  assert.equal(executed, false);
  assert.equal(manifest.outcome, "incomplete");
  assert.match(manifest.reason, /isolated orchestrator-owned runner/);
});

test("given only the identity prerequisite, when execution finishes, then assessment remains incomplete", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-security-run-"));

  // when
  const manifest = await executeSecurityPlan(buildSecurityPlan(input()), {
    root,
    verifyTarget: async () => input()
  });

  // then
  assert.equal(manifest.outcome, "incomplete");
  assert.match(manifest.reason, /No isolated assessment adapter/);
  assert.deepEqual(manifest.toolResults, [
    { id: "target-identity", version: "1.0.0", outcome: "passed" }
  ]);
});

test("given the bounded passive suite, when every check passes, then its evidence governs the outcome", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-security-run-"));
  const plan = buildSecurityPlan(input({
    profile: "safe",
    authorization: undefined,
    tools: [
      { id: "target-identity", version: "1.0.0", testIds: [] },
      { id: "passive-deployment", version: "1.0.0", testIds: ["CSA-DEPLOY-001"] }
    ],
    selectedTests: ["CSA-DEPLOY-001"],
    catalogTests: [{ id: "CSA-DEPLOY-001", status: "implemented", profile: "safe" }]
  }));

  // when
  const manifest = await executeSecurityPlan(plan, {
    root,
    verifyTarget: async () => input({ profile: "safe", authorization: undefined }),
    runPassiveAssessment: async () => ({ outcome: "passed", requestCount: 24 })
  });

  // then
  assert.equal(manifest.outcome, "passed");
  assert.equal(manifest.usage.requests, 24);
  assert.deepEqual(manifest.toolResults.at(-1), {
    id: "passive-deployment", version: "1.0.0", outcome: "passed"
  });
});

test("given the bounded active suites, when every attack check passes, then their evidence governs the outcome", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-security-run-"));
  const plan = activePlan();
  const limits = {};

  // when
  const manifest = await executeSecurityPlan(plan, {
    root,
    verifyTarget: async () => input(),
    runAuthorizationAssessment: async (_plan, context) => {
      limits.authorization = context.maxRequests;
      await context.resetLoginAttempts();
      return { outcome: "passed", requestCount: 900 };
    },
    resetLoginAttempts: async () => { limits.loginAttemptsReset = true; },
    runAuthenticatedZapAssessment: async (_plan, context) => {
      limits.zap = context.maxRequests;
      return { outcome: "passed", requestCount: 100,
        generatedDataMegabytes: 1 };
    },
    runOpenApiFuzzAssessment: async (_plan, context) => {
      limits.fuzz = context.maxRequests;
      return { outcome: "passed", requestCount: 200, generatedDataMegabytes: 2 };
    }
  });

  // then
  assert.equal(manifest.outcome, "passed");
  assert.equal(manifest.usage.requests, 1200);
  assert.equal(manifest.usage.generatedDataMegabytes, 3);
  assert.deepEqual(limits, { zap: 6000, fuzz: 2000, loginAttemptsReset: true, authorization: 2000 });
  assert.deepEqual(manifest.toolResults.at(-1), {
    id: "authorization-matrix", version: "1.0.0", outcome: "passed"
  });
});

test("given fuzzing changed domain state, when executing the active plan, then later probes are skipped", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-security-run-"));
  let authorizationCalled = false;

  // when
  const manifest = await executeSecurityPlan(activePlan(), {
    root,
    verifyTarget: async () => input(),
    runAuthenticatedZapAssessment: async () => ({ outcome: "passed", requestCount: 100,
      generatedDataMegabytes: 1 }),
    runOpenApiFuzzAssessment: async () => ({ outcome: "failed", requestCount: 200,
      generatedDataMegabytes: 2 }),
    runAuthorizationAssessment: async () => {
      authorizationCalled = true;
      return { outcome: "passed", requestCount: 900 };
    }
  });

  // then
  assert.equal(authorizationCalled, false);
  assert.equal(manifest.outcome, "failed");
  assert.match(manifest.reason, /changed protected domain state/);
  assert.equal(manifest.usage.requests, 300);
});

test("given the destructive abuse suite, when recovery and integrity pass, then its evidence governs the outcome", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-security-run-"));
  const plan = buildSecurityPlan(input({
    profile: "destructive",
    authorization: "authorize-destructive-run-0001",
    tools: [
      { id: "target-identity", version: "1.0.0", testIds: [] },
      { id: "resource-abuse", version: "1.0.0", testIds: ["CSA-RES-001"] }
    ],
    selectedTests: ["CSA-RES-001"],
    catalogTests: [{ id: "CSA-RES-001", status: "implemented", profile: "destructive" }]
  }));

  // when
  const manifest = await executeSecurityPlan(plan, {
    root,
    verifyTarget: async () => input({ profile: "destructive" }),
    runResourceAbuseAssessment: async (_plan, context) => ({
      outcome: "passed", requestCount: 640, generatedDataMegabytes: 2,
      maxRequests: context.maxRequests
    })
  });

  // then
  assert.equal(manifest.outcome, "passed");
  assert.deepEqual(manifest.usage, { requests: 640, generatedDataMegabytes: 2, evidenceBytes: 0 });
  assert.deepEqual(manifest.toolResults.at(-1), {
    id: "resource-abuse", version: "1.0.0", outcome: "passed"
  });
});

test("given sensitive diagnostics, when retaining them, then credentials and session material are redacted", () => {
  // given
  const diagnostic = "Authorization: Bearer abc.def.ghi\nCookie: SESSION=secret\npassword=hunter2 token=abcdef";

  // when
  const redacted = redactSecurityText(diagnostic);

  // then
  assert.doesNotMatch(redacted, /abc\.def\.ghi|SESSION=secret|hunter2|token=abcdef/);
  assert.match(redacted, /Authorization: \[REDACTED\]/);
  assert.match(redacted, /Cookie: \[REDACTED\]/);
});

test("given a changed target identity, when the prerequisite runs, then execution stops incomplete", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-security-run-"));

  // when
  const manifest = await executeSecurityPlan(buildSecurityPlan(input()), {
    root,
    verifyTarget: async () => input({ targetFingerprint: `sha256:${"d".repeat(64)}` })
  });

  // then
  assert.equal(manifest.outcome, "incomplete");
  assert.match(manifest.reason, /target identity changed/);
});

test("given an interrupted run, when recovering it, then only its exact identity is changed", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "courtside-security-run-"));
  const own = securityRunPaths(root, "run-0001", 1);
  const other = securityRunPaths(root, "run-0002", 1);
  mkdirSync(own.directory, { recursive: true });
  mkdirSync(other.directory, { recursive: true });
  writeFileSync(own.manifest, JSON.stringify({ schemaVersion: 1, runId: "run-0001", attempt: 1,
    status: "running" }));
  writeFileSync(other.manifest, JSON.stringify({ schemaVersion: 1, runId: "run-0002", attempt: 1,
    status: "running" }));

  // when
  recoverSecurityRun(root, "run-0001", 1);

  // then
  assert.equal(JSON.parse(readFileSync(own.manifest, "utf8")).outcome, "incomplete");
  assert.equal(JSON.parse(readFileSync(other.manifest, "utf8")).status, "running");
});
