import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildOpenApiFuzzInventory,
  normalizeSchemathesisEvents,
  openApiFuzzPolicy,
  openApiFuzzPolicyDigest,
  openApiSpecificationDigest,
  runOpenApiMutationCases,
  runOpenApiFuzzAssessment,
  runtimeOperations,
  securityImportCases,
  securityImportSourceRequest,
  undocumentedRuntimeRoutes,
  validateOpenApiFuzzEvidence
} from "./security-openapi-fuzz.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const api = yaml.load(readFileSync(new URL(
  "../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));

test("given the synthetic import source, when building curated CSV cases, then every header uses its separator", () => {
  // given
  const source = securityImportSourceRequest("run-0001", 1);

  // when
  const csvCases = securityImportCases().filter(({ id }) => id !== "invalid-utf8");

  // then
  assert.equal(source.separator, ";");
  assert.equal(csvCases.every(({ content }) => content.toString("utf8")
    .split("\n")[0].split(source.separator).includes("Member number")), true);
  assert.equal(csvCases.every(({ content }) => !content.toString("utf8").split("\n")[0].includes(",")), true);
});

test("given the current contract, when inventorying fuzz coverage, then every operation has an explicit mode", () => {
  // when
  const inventory = buildOpenApiFuzzInventory(api);

  // then
  assert.equal(inventory.length, 96);
  assert.equal(new Set(inventory.map(({ operationId }) => operationId)).size, 96);
  assert.deepEqual(inventory.find(({ operationId }) => operationId === "getBookingEligibility"), {
    operationId: "getBookingEligibility",
    method: "GET",
    path: "/api/bookings/eligibility",
    modes: ["positive"],
    excludedModes: { negative: "The operation has no request input to invalidate." }
  });
  assert.equal(inventory.find(({ operationId }) => operationId === "listRoster").modes.join(","),
    "positive,negative");
  assert.deepEqual(inventory.find(({ operationId }) => operationId === "createCourt").modes, ["negative"]);
  assert.match(inventory.find(({ operationId }) => operationId === "createCourt").excludedModes.positive,
    /Valid mutations/);
  assert.deepEqual(inventory.find(({ operationId }) => operationId === "logOut").modes, []);
  assert.match(inventory.find(({ operationId }) => operationId === "logOut").excludedModes.all,
    /Session invalidation/);
  assert.deepEqual(inventory.find(({ operationId }) => operationId === "getApiDocument").modes, []);
  assert.match(inventory.find(({ operationId }) => operationId === "getApiDocument").excludedModes.all,
    /SECURITY deployment/);
  assert.match(openApiFuzzPolicy.image,
    /^schemathesis\/schemathesis:4\.25\.0@sha256:[a-f0-9]{64}$/);
  assert.ok(openApiFuzzPolicy.checks.includes("not_a_server_error"));
  assert.ok(!openApiFuzzPolicy.checks.includes("ignored_auth"));
  assert.deepEqual(openApiFuzzPolicy.negativeInputProxyStatuses, [421]);
  assert.match(openApiFuzzPolicyDigest(), /^sha256:[a-f0-9]{64}$/);
});

test("given the coverage phase probes unexpected methods, when one is answered by a layer other than the deployment, then it is not probed here", () => {
  // when / then
  assert.deepEqual(openApiFuzzPolicy.unexpectedMethods.filter(
    (method) => ["TRACE", "CONNECT", "TRACK"].includes(method)), []);
  // The allow-header check judges an OPTIONS response, and only this phase generates one.
  assert.ok(openApiFuzzPolicy.unexpectedMethods.includes("OPTIONS"));
});

test("given generated status failures, when the deployment contract explains them, then only actionable ones remain", () => {
  // given
  const inventory = buildOpenApiFuzzInventory(api);
  const entry = (operationId) => inventory.find((candidate) => candidate.operationId === operationId);
  const events = (operation, mode, observedStatus, check = "status_code_conformance") => [
    { LoadingFinished: { statistic: { operations: { total: 1, selected: 1 } } } },
    { ScenarioFinished: { status: "failure", recorder: { label: `${operation.method} ${operation.path}`,
      cases: { one: { value: { method: operation.method, query: { cursor: "boundary" },
        meta: { generation: { mode } } } } }, checks: { one: [{ name: check, status: "failure",
        failure_info: { reason: { kind: "status", observedStatus, expectedStatuses: ["2xx"] } } }] } } } }
  ];

  // when
  const documented = normalizeSchemathesisEvents(events(entry("listRoster"), "positive", 400,
    "positive_data_acceptance"),
    [entry("listRoster")], "positive", 1);
  const proxyRejection = normalizeSchemathesisEvents(events(entry("getCourt"), "negative", 421,
    "negative_data_rejection"), [entry("getCourt")], "negative", 1);
  const undocumented = normalizeSchemathesisEvents(events(entry("courtImpact"), "positive", 404),
    [entry("courtImpact")], "positive", 1);
  const serverError = normalizeSchemathesisEvents(events(entry("listRoster"), "positive", 503,
    "not_a_server_error"), [entry("listRoster")], "positive", 1);
  const positive421 = normalizeSchemathesisEvents(events(entry("listRoster"), "positive", 421),
    [entry("listRoster")], "positive", 1);
  const unqualifiedDocumented = normalizeSchemathesisEvents(events(entry("listRoster"), "positive", 400),
    [entry("listRoster")], "positive", 1);
  const unqualifiedProxyRejection = normalizeSchemathesisEvents(events(entry("getCourt"), "negative", 421,
    "positive_data_acceptance"), [entry("getCourt")], "negative", 1);
  const relatedProxyEvents = events(entry("getCourt"), "negative", 421, "negative_data_rejection");
  relatedProxyEvents[1].ScenarioFinished.recorder.checks.one.push({ name: "status_code_conformance",
    status: "failure", failure_info: {
      reason: { kind: "status", observedStatus: 421, expectedStatuses: ["2xx"] }
    } });
  const relatedProxyRejections = normalizeSchemathesisEvents(relatedProxyEvents,
    [entry("getCourt")], "negative", 1);
  const acceptedNegative = normalizeSchemathesisEvents(events(entry("listRoster"), "negative", 200,
    "negative_data_rejection"), [entry("listRoster")], "negative", 1);
  const controlFailures = [401, 403, 429].map((status) => normalizeSchemathesisEvents(
    events(entry("listRoster"), "positive", status, "positive_data_acceptance"),
    [entry("listRoster")], "positive", 1));

  // then
  assert.equal(documented.operationResults[0].outcome, "passed");
  assert.equal(proxyRejection.operationResults[0].outcome, "passed");
  assert.equal(documented.counterexamples.length, 0);
  assert.equal(proxyRejection.counterexamples.length, 0);
  assert.equal(relatedProxyRejections.counterexamples.length, 0);
  assert.deepEqual(documented.dispositions.map(({ disposition, reason }) =>
    ({ disposition, observedStatus: reason.observedStatus })),
  [{ disposition: "documented-status", observedStatus: 400 }]);
  assert.deepEqual(proxyRejection.dispositions.map(({ disposition, reason }) =>
    ({ disposition, observedStatus: reason.observedStatus })),
  [{ disposition: "proxy-negative-input-rejection", observedStatus: 421 }]);
  assert.equal(relatedProxyRejections.dispositions.length, 2);
  assert.equal(undocumented.dispositions.length, 0);
  assert.equal(serverError.dispositions.length, 0);
  assert.equal(positive421.dispositions.length, 0);
  assert.equal(unqualifiedDocumented.dispositions.length, 0);
  assert.equal(unqualifiedProxyRejection.dispositions.length, 0);
  assert.equal(acceptedNegative.dispositions.length, 0);
  assert.equal(controlFailures.every(({ dispositions }) => dispositions.length === 0), true);
  assert.equal(undocumented.counterexamples.length, 1);
  assert.equal(serverError.counterexamples.length, 1);
  assert.equal(positive421.counterexamples.length, 1);
  assert.equal(unqualifiedDocumented.counterexamples.length, 1);
  assert.equal(unqualifiedProxyRejection.counterexamples.length, 1);
  assert.equal(acceptedNegative.counterexamples.length, 1);
  assert.equal(controlFailures.every(({ counterexamples }) => counterexamples.length === 1), true);
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
        cases: { "credential-shaped-case-id": { value: { method: "GET", path: "/api/admin/roster",
          path_parameters: { memberId: "sensitive-object-id" }, query: { cursor: "sensitive-cursor-value" },
          body: { password: "sensitive-body-value" },
          headers: { "X-Api-Key": "request-secret", "X-Trace": "object-id" },
          meta: { generation: { mode: "negative" } } } } },
        checks: { "credential-shaped-case-id": [{ name: "not_a_server_error", status: "failure", failure_info: {
          reason: { kind: "status", observedStatus: 503, expectedStatuses: ["non-5xx"] }
        } }] },
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
  assert.equal(normalized.counterexamples[0].caseId, "case-1");
  assert.equal(normalized.counterexamples[0].pathTemplate, "/api/admin/roster");
  assert.deepEqual(normalized.counterexamples[0].reason,
    { kind: "status", observedStatus: 503, expectedStatuses: ["non-5xx"] });
  assert.deepEqual(normalized.counterexamples[0].requestShape, { locations: ["body", "path", "query"] });
  assert.match(normalized.counterexamples[0].reproductionDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(normalized.undocumentedRoutes, []);
  assert.doesNotMatch(JSON.stringify(normalized),
    /SESSION|secret|object-id|c2VjcmV0|credential-shaped-case-id|sensitive-(?:object-id|cursor-value|body-value)/);
});

test("given distinct structural failures, when normalizing them, then candidates remain distinguishable", () => {
  // given
  const inventory = [buildOpenApiFuzzInventory(api)
    .find(({ operationId }) => operationId === "listRoster")];
  const check = (missingProperty) => ({ name: "response_schema_conformance", status: "failure",
    failure_info: { reason: { kind: "schema", instancePointer: "/items/*",
      validationKeyword: "required", missingProperties: [missingProperty] } } });
  const events = [
    { LoadingFinished: { statistic: { operations: { total: 1, selected: 1 } } } },
    { ScenarioFinished: { status: "failure", recorder: { label: "GET /api/admin/roster",
      cases: {
        one: { value: { method: "GET", meta: { generation: { mode: "negative" } } } },
        two: { value: { method: "GET", meta: { generation: { mode: "negative" } } } }
      }, checks: { one: [check("email")], two: [check("status")] } } } }
  ];

  // when
  const normalized = normalizeSchemathesisEvents(events, inventory, "negative");

  // then
  assert.equal(normalized.counterexamples.length, 2);
  assert.notEqual(normalized.counterexamples[0].reproductionDigest,
    normalized.counterexamples[1].reproductionDigest);
});

test("given exact statuses in one class, when normalizing them, then their disagreements remain distinguishable", () => {
  // given
  const inventory = [buildOpenApiFuzzInventory(api)
    .find(({ operationId }) => operationId === "listRoster")];
  const check = (observedStatus) => ({ name: "status_code_conformance", status: "failure",
    failure_info: { reason: { kind: "status", observedStatus, expectedStatuses: [400] } } });
  const events = [
    { LoadingFinished: { statistic: { operations: { total: 1, selected: 1 } } } },
    { ScenarioFinished: { status: "failure", recorder: { label: "GET /api/admin/roster",
      cases: {
        one: { value: { method: "GET", meta: { generation: { mode: "negative" } } } },
        two: { value: { method: "GET", meta: { generation: { mode: "negative" } } } }
      }, checks: { one: [check(404)], two: [check(409)] } } } }
  ];

  // when
  const normalized = normalizeSchemathesisEvents(events, inventory, "negative");

  // then
  assert.notEqual(normalized.counterexamples[0].reproductionDigest,
    normalized.counterexamples[1].reproductionDigest);
});

test("given unsafe or unsupported failure reasons, when normalizing them, then the adapter fails closed", () => {
  // given
  const inventory = [buildOpenApiFuzzInventory(api)
    .find(({ operationId }) => operationId === "listRoster")];
  const events = (reason, name = "response_schema_conformance") => [
    { LoadingFinished: { statistic: { operations: { total: 1, selected: 1 } } } },
    { ScenarioFinished: { status: "failure", recorder: { label: "GET /api/admin/roster",
      cases: { one: { value: { method: "GET", meta: { generation: { mode: "negative" } } } } },
      checks: { one: [{ name, status: "failure",
        failure_info: { reason } }] } } } }
  ];

  // when / then
  assert.throws(() => normalizeSchemathesisEvents(events({ kind: "schema", instancePointer: "/members/secret-id",
    validationKeyword: "type", missingProperties: [], value: "SESSION=secret" }),
  inventory, "negative"), /unsupported Schemathesis failure reason/i);
  assert.throws(() => normalizeSchemathesisEvents(events({ kind: "scanner-message", message: "token=secret" }),
    inventory, "negative"), /unsupported Schemathesis failure reason/i);
  assert.throws(() => normalizeSchemathesisEvents(events({ kind: "status", observedStatus: 503,
    expectedStatuses: ["credential-secret"] }, "status_code_conformance"), inventory, "negative"),
  /unsupported Schemathesis failure reason/i);
  assert.throws(() => normalizeSchemathesisEvents(events({ kind: "media-type", observed: "application/json",
    expected: ["session/secret;token=value"] }, "content_type_conformance"), inventory, "negative"),
  /unsupported Schemathesis failure reason/i);
  assert.throws(() => normalizeSchemathesisEvents(events({ kind: "schema", instancePointer: "/members/0/id",
    validationKeyword: "secretValue", missingProperties: [] }),
  inventory, "negative"), /unsupported Schemathesis failure reason/i);
  assert.throws(() => normalizeSchemathesisEvents(events({ kind: "schema",
    instancePointer: "/items/object-id-from-response", validationKeyword: "type", missingProperties: [] }),
  inventory, "negative"),
  /unsupported Schemathesis failure reason/i);
  assert.doesNotThrow(() => normalizeSchemathesisEvents(events({ kind: "schema",
    instancePointer: "/items/*/id", validationKeyword: "format", missingProperties: [] }),
  inventory, "negative"));
  assert.throws(() => normalizeSchemathesisEvents(events({ kind: "media-type", observed: "undocumented",
    expected: ["session/secret"] }, "content_type_conformance"), inventory, "negative"),
  /unsupported Schemathesis failure reason/i);
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

test("given repeated and distinct failures, when retaining lifecycle evidence, then candidates follow reasons", async () => {
  // given
  const inventory = buildOpenApiFuzzInventory(api);
  const generatedInventory = inventory.filter(({ method }) => method === "GET");
  const events = (mode) => [
    { LoadingFinished: { statistic: { operations: { total: inventory.length,
      selected: generatedInventory.filter(({ modes }) => modes.includes(mode)).length } } } },
    ...generatedInventory.filter(({ modes }) => modes.includes(mode)).map((entry) => {
      const failing = entry.operationId === "listRoster" && mode === "negative";
      const cases = failing ? ["one", "two", "three", "four"] : ["one"];
      return { ScenarioFinished: { status: failing ? "failure" : "success", recorder: {
        label: `${entry.method} ${entry.path}`,
        cases: Object.fromEntries(cases.map((id, caseIndex) => [id, { value: {
          method: entry.method, path: entry.path,
          ...(caseIndex === 3 ? { body: { boundary: true } } : { query: { case: String(caseIndex) } }),
          meta: { generation: { mode } }
        } }])),
        checks: failing ? Object.fromEntries(cases.map((id, caseIndex) =>
          [id, [{ name: caseIndex === 1 ? "positive_data_acceptance" : "status_code_conformance",
            status: "failure", failure_info: {
            reason: { kind: "status", observedStatus: caseIndex === 2 ? 404 : 503,
              expectedStatuses: ["2xx"] }
          } }]])) : {}
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
  const mutationCases = inventory.filter(({ method, modes }) => method !== "GET" && modes.includes("negative"))
    .map(({ operationId, method, path }) => ({ operationId, method, path, status: 400,
      problemType: "urn:courtside:error:validation-failed", observation: "invalid-mutation-rejected",
      outcome: "passed" }));

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
      mutationCases,
      observedRoutes: inventory.map(({ method, path }) => ({ method, pathTemplate: path })),
      stateBefore: fingerprint, stateAfter: fingerprint, generatedDataMegabytes: 1 })
  });

  // then
  assert.equal(evidence.counterexamples.length, 4);
  assert.deepEqual(evidence.dispositions, []);
  assert.deepEqual(evidence.counterexamples.slice(0, 2).map(({ check }) => check).toSorted(),
    ["positive-data-acceptance", "status-code-conformance"]);
  assert.equal(evidence.candidates.length, 3);
  assert.deepEqual(evidence.candidates.map(({ evidence: values }) => values.length).toSorted(), [1, 1, 2]);
  const invalidDisposition = structuredClone(evidence);
  invalidDisposition.dispositions = [{ ...evidence.counterexamples[0], disposition: "documented-status" }];
  assert.throws(() => validateOpenApiFuzzEvidence(invalidDisposition), /disposition/i);
  const incompleteCandidateEvidence = structuredClone(evidence);
  const mergedCandidate = incompleteCandidateEvidence.candidates.find(({ evidence: values }) => values.length === 2);
  mergedCandidate.evidence.pop();
  assert.throws(() => validateOpenApiFuzzEvidence(incompleteCandidateEvidence), /candidate evidence/i);
});

test("given every state-changing operation, when building negative probes, then each is rejected", async () => {
  // given
  const responses = [];
  const fixture = { client: {} };

  // when
  const result = await runOpenApiMutationCases({ target: "https://127.0.0.1:9443" }, fixture, {
    ca: "certificate", timeoutMilliseconds: 1_000,
    request: async (probe) => {
      responses.push(probe);
      return { status: 400, problemType: "urn:courtside:error:validation-failed" };
    }
  });

  // then
  assert.ok(result.cases.length > 30);
  assert.equal(responses.length, result.cases.length);
  assert.equal(responses.find(({ path }) => path === "/api/bookings")?.headers["Idempotency-Key"],
    "security-invalid");
  assert.equal(result.cases.every(({ outcome }) => outcome === "passed"), true);
});

// The mount and the digest the run plans against are one decision. If a reader ever goes back to a
// fixed path, a paired comparison silently assesses two contracts against one application again.
test("given a contract chosen for the run, when the fuzzer loads, then it is the one it plans against", () => {
  // given
  const source = fileURLToPath(new URL("../src/main/resources/api/openapi.yaml", import.meta.url));
  const chosen = join(mkdtempSync(join(tmpdir(), "courtside-contract-")), "openapi.yaml");
  copyFileSync(source, chosen);

  // when
  const printed = execFileSync(process.execPath, ["--input-type=module", "-e",
    "import { openApiSpecificationDigest } from "
    + JSON.stringify(new URL("./security-openapi-fuzz.mjs", import.meta.url).href)
    + "; process.stdout.write(openApiSpecificationDigest());"],
  { encoding: "utf8", env: { ...process.env, COURTSIDE_SECURITY_API_DOCUMENT: chosen } }).trim();

  // then
  assert.equal(printed, `sha256:${createHash("sha256").update(readFileSync(chosen)).digest("hex")}`);
});
