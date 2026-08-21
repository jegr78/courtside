import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildOpenApiFuzzInventory,
  normalizeSchemathesisEvents,
  openApiFuzzPolicy,
  openApiFuzzPolicyDigest,
  openApiSpecificationDigest,
  runOpenApiFuzzAssessment,
  runtimeOperations,
  undocumentedRuntimeRoutes
} from "./security-openapi-fuzz.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const api = yaml.load(readFileSync(new URL(
  "../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));

test("given the current contract, when inventorying fuzz coverage, then every operation has an explicit mode", () => {
  // when
  const inventory = buildOpenApiFuzzInventory(api);

  // then
  assert.equal(inventory.length, 87);
  assert.equal(new Set(inventory.map(({ operationId }) => operationId)).size, 87);
  assert.equal(inventory.find(({ operationId }) => operationId === "listRoster").modes.join(","),
    "positive,negative");
  assert.deepEqual(inventory.find(({ operationId }) => operationId === "createCourt").modes, ["negative"]);
  assert.match(inventory.find(({ operationId }) => operationId === "createCourt").excludedModes.positive,
    /Valid mutations/);
  assert.deepEqual(inventory.find(({ operationId }) => operationId === "logOut").modes, []);
  assert.match(inventory.find(({ operationId }) => operationId === "logOut").excludedModes.all,
    /Session invalidation/);
  assert.match(openApiFuzzPolicy.image,
    /^schemathesis\/schemathesis:4\.25\.0@sha256:[a-f0-9]{64}$/);
  assert.ok(openApiFuzzPolicy.checks.includes("not_a_server_error"));
  assert.ok(!openApiFuzzPolicy.checks.includes("ignored_auth"));
  assert.match(openApiFuzzPolicyDigest(), /^sha256:[a-f0-9]{64}$/);
});

test("given minimized Schemathesis events, when normalizing them, then failures retain no raw traffic", () => {
  // given
  const inventory = [buildOpenApiFuzzInventory(api)
    .find(({ operationId }) => operationId === "listRoster")];
  const events = [
    { LoadingFinished: { statistic: { operations: { total: 1, selected: 1 } } } },
    { ScenarioFinished: {
      status: "failure",
      phase: "Fuzzing",
      recorder: {
        label: "GET /api/admin/roster",
        cases: { abc123: { value: { method: "GET", path: "/api/admin/roster", query: { cursor: "candidate" },
          meta: { generation: { mode: "negative" } } } } },
        checks: { abc123: [{ name: "not_a_server_error", status: "failure" }] },
        interactions: { abc123: { request: { headers: { Cookie: "SESSION=secret" }, body: "secret" },
          response: { content: { $base64: "c2VjcmV0" } } } }
      }
    } }
  ];

  // when
  const normalized = normalizeSchemathesisEvents(events, inventory, "negative");

  // then
  assert.equal(normalized.operationResults[0].operationId, "listRoster");
  assert.equal(normalized.operationResults[0].outcome, "incomplete");
  assert.equal(normalized.counterexamples[0].check, "not-a-server-error");
  assert.equal(normalized.counterexamples[0].pathTemplate, "/api/admin/roster");
  assert.equal(JSON.parse(normalized.counterexamples[0].minimizedRequest).query.cursor, "candidate");
  assert.match(normalized.counterexamples[0].reproductionDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(normalized.undocumentedRoutes, []);
  assert.doesNotMatch(JSON.stringify(normalized), /SESSION|secret|c2VjcmV0/);
});

test("given missing or contradictory operation evidence, when normalizing it, then coverage fails closed", () => {
  // given
  const inventory = buildOpenApiFuzzInventory(api);

  // when / then
  assert.throws(() => normalizeSchemathesisEvents([], inventory, "positive"), /operation inventory/);
  assert.throws(() => normalizeSchemathesisEvents([
    { LoadingFinished: { statistic: { operations: { total: 86, selected: 1 } } } }
  ], inventory, "positive"), /contract operation count/);
});

test("given an unexpected observed operation, when normalizing it, then it becomes a review candidate", () => {
  // given
  const inventory = [buildOpenApiFuzzInventory(api)
    .find(({ operationId }) => operationId === "listRoster")];
  const events = [
    { LoadingFinished: { statistic: { operations: { total: 1, selected: 1 } } } },
    { ScenarioFinished: { status: "success", recorder: { label: "GET /api/internal/diagnostics",
      cases: {}, checks: {} } } },
    { ScenarioFinished: { status: "success", recorder: { label: "GET /api/admin/roster",
      cases: { one: { value: { meta: { generation: { mode: "positive" } } } } }, checks: {} } } }
  ];

  // when
  const normalized = normalizeSchemathesisEvents(events, inventory, "positive");

  // then
  assert.deepEqual(normalized.undocumentedRoutes,
    [{ method: "GET", pathTemplate: "/api/internal/diagnostics" }]);
});

test("given runtime handler mappings, when comparing them with OpenAPI, then undocumented routes remain visible", () => {
  // given
  const mappings = { contexts: { application: { mappings: { dispatcherServlets: { dispatcherServlet: [
    { details: { requestMappingConditions: { methods: ["GET"], patterns: ["/api/public/courts"] } } },
    { details: { requestMappingConditions: { methods: ["POST"], patterns: ["/api/internal/rebuild"] } } },
    { details: { requestMappingConditions: { methods: ["GET"], patterns: ["/actuator/health"] } } }
  ] } } } } };

  // when
  const observed = runtimeOperations(mappings);
  const unexpected = undocumentedRuntimeRoutes(observed, buildOpenApiFuzzInventory(api));

  // then
  assert.deepEqual(unexpected, [{ method: "POST", pathTemplate: "/api/internal/rebuild" }]);
});

test("given repeated minimized failures, when retaining lifecycle evidence, then one candidate owns both requests", async () => {
  // given
  const inventory = buildOpenApiFuzzInventory(api);
  const events = (mode) => [
    { LoadingFinished: { statistic: { operations: { total: inventory.length,
      selected: inventory.filter(({ modes }) => modes.includes(mode)).length } } } },
    ...inventory.filter(({ modes }) => modes.includes(mode)).map((entry, index) => {
      const failing = entry.operationId === "listRoster" && mode === "negative";
      const cases = failing ? ["one", "two"] : ["one"];
      return { ScenarioFinished: { status: failing ? "failure" : "success", recorder: {
        label: `${entry.method} ${entry.path}`,
        cases: Object.fromEntries(cases.map((id, caseIndex) => [id, { value: {
          method: entry.method, path: entry.path, query: { case: String(caseIndex) },
          meta: { generation: { mode } }
        } }])),
        checks: failing ? Object.fromEntries(cases.map((id) =>
          [id, [{ name: "not_a_server_error", status: "failure" }]])) : {}
      } } };
    })
  ];
  const fingerprint = `sha256:${"a".repeat(64)}`;
  const inputCases = openApiFuzzPolicy.inputClasses.map((id) => ({ id, status: 400,
    problemType: "urn:courtside:error:validation-failed", observation: "typed-input-rejection",
    outcome: "passed" }));
  const importCases = ["invalid-utf8", "duplicate-columns"].map((id) => ({ id, status: 400,
    problemType: "urn:courtside:error:import-snapshot-unreadable", observation: "typed-upload-rejection",
    outcome: "passed" })).concat(["oversized-cell", "conflicting-reference"].map((id) => ({ id, status: 201,
    observation: "row-level-rejection", outcome: "passed" })));

  // when
  const evidence = await runOpenApiFuzzAssessment({ profile: "active", environment: "SECURITY",
    selectedTests: ["CSA-AUTHN-001", "CSA-AUTHZ-001", "CSA-DAST-001", "CSA-API-001", "CSA-IMPORT-001"],
    runId: "run-0001", targetFingerprint: fingerprint }, {
    maxRequests: 2000, attempt: 1, deadline: new Date(Date.now() + 60_000),
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-fuzz-evidence-")),
    now: () => new Date("2026-08-21T12:00:00Z"),
    runFuzzer: async () => ({ runtimeHardened: true, requestCount: 100,
      specificationDigest: openApiSpecificationDigest(),
      events: { positive: events("positive"), negative: events("negative") }, inputCases, importCases,
      observedRoutes: inventory.map(({ method, path }) => ({ method, pathTemplate: path })),
      stateBefore: fingerprint, stateAfter: fingerprint, generatedDataMegabytes: 1 })
  });

  // then
  assert.equal(evidence.counterexamples.length, 2);
  assert.equal(evidence.candidates.length, 1);
  assert.equal(evidence.candidates[0].evidence.length, 2);
});
