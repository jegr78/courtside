import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { apiDocumentPath } from "./security-api-document.mjs";
import { createCandidate } from "./security-triage.mjs";
import { authorizationRequest, SecurityCookieJar } from "./security-authorization.mjs";

const methods = new Set(["get", "post", "put", "patch", "delete"]);
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const Ajv = require("ajv/dist/2020").default;
const specification = readFileSync(apiDocumentPath());
const api = yaml.load(specification.toString("utf8"));
const evidenceSchema = JSON.parse(readFileSync(
  new URL("../security/openapi-fuzz-evidence.schema.json", import.meta.url), "utf8"));
const lifecycleSchema = JSON.parse(readFileSync(
  new URL("../security/finding-lifecycle.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addSchema(lifecycleSchema);
const validateEvidenceSchema = ajv.compile(evidenceSchema);

export const openApiFuzzPolicy = Object.freeze(JSON.parse(readFileSync(
  new URL("../security/openapi-fuzz-policy.json", import.meta.url), "utf8")));

export function openApiFuzzPolicyDigest(policy = openApiFuzzPolicy) {
  return `sha256:${createHash("sha256").update(JSON.stringify(policy)).digest("hex")}`;
}

export function openApiSpecificationDigest() {
  return `sha256:${createHash("sha256").update(specification).digest("hex")}`;
}

export function buildOpenApiFuzzInventory(api, policy = openApiFuzzPolicy) {
  const inventory = Object.entries(api.paths ?? {}).flatMap(([path, pathItem]) =>
    Object.entries(pathItem).filter(([method]) => methods.has(method)).map(([method, operation]) => {
      if (!operation.operationId) throw new Error(`${method.toUpperCase()} ${path} has no operationId`);
      const excluded = policy.excludedOperations[operation.operationId];
      if (excluded) return operationCoverage(operation.operationId, method, path, [], { all: excluded });
      const mutation = method !== "get";
      const inputs = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].length > 0
        || operation.requestBody != null;
      const modes = mutation ? ["negative"] : inputs ? ["positive", "negative"] : ["positive"];
      const excludedModes = {
        ...(mutation ? { positive: policy.positiveMutationRationale } : {}),
        ...(!mutation && !inputs ? { negative: "The operation has no request input to invalidate." } : {})
      };
      return operationCoverage(operation.operationId, method, path, modes, excludedModes);
    }));
  const ids = inventory.map(({ operationId }) => operationId);
  if (new Set(ids).size !== ids.length) throw new Error("OpenAPI operation IDs must be unique for fuzz coverage");
  return inventory;
}

export function normalizeSchemathesisEvents(events, inventory, mode, contractOperationCount = inventory.length) {
  if (!events.length) throw new Error("Schemathesis produced no operation inventory");
  const loading = events.find(({ LoadingFinished }) => LoadingFinished)?.LoadingFinished;
  if (loading?.statistic?.operations?.total !== contractOperationCount) {
    throw new Error("Schemathesis contract operation count differs from the pinned inventory");
  }
  const expected = inventory.filter(({ modes }) => modes.includes(mode));
  if (loading.statistic.operations.selected !== expected.length) {
    throw new Error("Schemathesis selected operation count differs from the fuzz policy");
  }
  const byLabel = new Map(expected.map((entry) => [`${entry.method} ${entry.path}`, entry]));
  const scenarios = new Map();
  const undocumentedRoutes = new Map();
  for (const event of events) {
    const scenario = event.ScenarioFinished;
    if (!scenario) continue;
    const entry = byLabel.get(scenario.recorder?.label);
    if (!entry) {
      const match = /^([A-Z]+) (\/[^?#]*)$/.exec(scenario.recorder?.label ?? "");
      if (!match || ![...methods].map((method) => method.toUpperCase()).includes(match[1])) {
        throw new Error("Schemathesis reported an invalid operation label");
      }
      undocumentedRoutes.set(`${match[1]} ${match[2]}`, { method: match[1], pathTemplate: match[2] });
      continue;
    }
    const recorded = scenarios.get(entry.operationId) ?? [];
    recorded.push(scenario);
    scenarios.set(entry.operationId, recorded);
  }
  const counterexamples = [];
  const operationResults = expected.map((entry) => {
    const operationScenarios = scenarios.get(entry.operationId) ?? [];
    const matching = operationScenarios.flatMap((scenario) => {
      const caseIds = Object.entries(scenario.recorder?.cases ?? {})
        .filter(([, { value }]) => value?.meta?.generation?.mode === mode).map(([caseId]) => caseId);
      return caseIds.length ? [{ scenario, caseIds }] : [];
    });
    if (!matching.length) throw new Error(`Schemathesis omitted ${mode} inputs for ${entry.operationId}`);
    let failed = false;
    for (const { scenario, caseIds } of matching) {
      for (const caseId of caseIds) {
        for (const check of (scenario.recorder?.checks?.[caseId] ?? []).filter(({ status }) => status === "failure")) {
          const generatedCase = scenario.recorder.cases[caseId].value;
          counterexamples.push(safeCounterexample(entry, mode, caseId, check.name, generatedCase));
          failed = true;
        }
      }
      if (scenario.status !== "success") failed = true;
    }
    const outcome = failed ? "incomplete" : "passed";
    return { operationId: entry.operationId, mode, outcome,
      observation: outcome === "passed" ? "generated-inputs-conform" : "candidate-requires-triage" };
  });
  return { operationResults, counterexamples, undocumentedRoutes: [...undocumentedRoutes.values()] };
}

export async function runOpenApiFuzzAssessment(plan, context) {
  const requiredTests = ["CSA-AUTHN-001", "CSA-AUTHZ-001", "CSA-DAST-001", "CSA-API-001", "CSA-IMPORT-001"];
  if (plan.profile !== "active" || plan.environment !== "SECURITY"
      || JSON.stringify(plan.selectedTests) !== JSON.stringify(requiredTests)) {
    throw new Error("OpenAPI fuzzing requires the complete active SECURITY plan");
  }
  if (!Number.isSafeInteger(context.maxRequests) || context.maxRequests < 1) {
    throw new Error("OpenAPI fuzzing has no remaining request budget");
  }
  const inventory = buildOpenApiFuzzInventory(api);
  const generatedInventory = inventory.filter(({ method }) => method === "GET");
  const scanner = await context.runFuzzer(plan, {
    inventory: generatedInventory,
    policy: openApiFuzzPolicy,
    policyDigest: openApiFuzzPolicyDigest(),
    specificationDigest: openApiSpecificationDigest(),
    maxRequests: context.maxRequests,
    attempt: context.attempt,
    timeoutMilliseconds: Math.max(1, context.deadline.getTime() - Date.now())
  });
  if (!scanner.runtimeHardened || scanner.requestCount < 1 || scanner.requestCount > context.maxRequests
      || scanner.specificationDigest !== openApiSpecificationDigest()) {
    throw new Error("OpenAPI fuzzer runtime, request or specification evidence is incomplete");
  }
  const normalized = ["positive", "negative"].map((mode) =>
    normalizeSchemathesisEvents(scanner.events[mode], generatedInventory, mode, inventory.length));
  const operationOutcomes = [...normalized.flatMap(({ operationResults }) => operationResults),
    ...scanner.mutationCases.map(({ operationId, outcome }) => ({ operationId, mode: "negative", outcome,
      observation: outcome === "passed" ? "curated-invalid-input-rejected" : "candidate-requires-triage" }))];
  const counterexamples = normalized.flatMap(({ counterexamples: values }) => values);
  const undocumentedRoutes = [...normalized.flatMap(({ undocumentedRoutes: values }) => values),
    ...undocumentedRuntimeRoutes(scanner.observedRoutes, inventory)]
    .filter((value, index, values) => values.findIndex((candidate) =>
      candidate.method === value.method && candidate.pathTemplate === value.pathTemplate) === index);
  const operations = inventory.map((entry) => ({ ...entry,
    outcomes: operationOutcomes.filter(({ operationId }) => operationId === entry.operationId)
      .map(({ mode, outcome, observation }) => ({ mode, outcome, observation }))
  }));
  const observedAt = (context.now?.() ?? new Date()).toISOString();
  const candidates = mergeCandidates([
    ...counterexamples.map((counterexample) => counterexampleCandidate(counterexample, plan, context, observedAt)),
    ...undocumentedRoutes.map((route) => undocumentedRouteCandidate(route, plan, context, observedAt))
  ]);
  const stateChanged = scanner.stateBefore !== scanner.stateAfter;
  const incomplete = counterexamples.length > 0 || undocumentedRoutes.length > 0
    || operationOutcomes.some(({ outcome }) => outcome === "incomplete")
    || scanner.inputCases.some(({ outcome }) => outcome === "incomplete")
    || scanner.importCases.some(({ outcome }) => outcome === "incomplete")
    || scanner.mutationCases.some(({ outcome }) => outcome === "incomplete");
  const evidence = {
    schemaVersion: 1,
    testIds: ["CSA-API-001", "CSA-IMPORT-001"],
    targetFingerprint: plan.targetFingerprint,
    image: openApiFuzzPolicy.image,
    policyDigest: openApiFuzzPolicyDigest(),
    specificationDigest: openApiSpecificationDigest(),
    seed: openApiFuzzPolicy.seed,
    operations,
    counterexamples,
    undocumentedRoutes,
    inputCases: scanner.inputCases,
    importCases: scanner.importCases,
    mutationCases: scanner.mutationCases,
    stateBefore: scanner.stateBefore,
    stateAfter: scanner.stateAfter,
    candidates,
    requestCount: scanner.requestCount,
    generatedDataMegabytes: scanner.generatedDataMegabytes,
    outcome: stateChanged ? "failed" : incomplete ? "incomplete" : "passed"
  };
  validateOpenApiFuzzEvidence(evidence, inventory);
  retainOpenApiFuzzEvidence(context.evidenceDirectory, evidence);
  return evidence;
}

export async function prepareOpenApiFuzzFixtures(plan, context) {
  const client = new SecurityCookieJar();
  const control = requestControl(context.stopFile, context.deadline);
  let requestCount = 0;
  const request = async (probe, options = {}) => {
    control.beforeRequest();
    requestCount++;
    return authorizationRequest(plan.target, client, probe, {
      ca: context.ca,
      signal: control.signal,
      timeoutMilliseconds: control.remainingMilliseconds(),
      ...options
    });
  };
  await request({ method: "GET", path: "/api/session", headers: {} });
  const login = await request({ method: "POST", path: "/api/session",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "security.admin.1", password: context.sharedPassword }).toString()
  }, { csrf: true });
  if (login.status !== 200 || !client.csrfToken()) throw new Error("Synthetic fuzzer authentication failed");
  const source = await request({ method: "POST", path: "/api/admin/import/sources",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(securityImportSourceRequest(plan.runId, context.attempt))
  }, { csrf: true });
  if (source.status !== 201 || !source.json?.id) throw new Error("Synthetic import source setup failed");
  const mappings = await request({ method: "GET", path: "/__security/runtime-mappings", headers: {} },
    { maxResponseBytes: 2 * 1024 * 1024 });
  if (mappings.status !== 200 || !mappings.json) throw new Error("Runtime route inventory is unavailable");
  return { client, sourceId: source.json.id, observedRoutes: runtimeOperations(mappings.json), requestCount,
    close: () => control.close() };
}

export function securityImportSourceKey(runId, attempt) {
  const identity = createHash("sha256").update(`${runId}:${attempt}`).digest("hex").slice(0, 16);
  return `security-fuzz-${identity}`;
}

export function securityImportSourceRequest(runId, attempt) {
  return {
    sourceKey: securityImportSourceKey(runId, attempt),
    displayName: "Security fuzz source",
    separator: ";",
    encoding: "UTF-8",
    columns: { "Member number": "EXTERNAL_ID", "First name": "FIRST_NAME",
      "Last name": "LAST_NAME", Email: "EMAIL" },
    defaultMembershipTypeId: "cccccccc-0000-0000-0000-000000000001",
    removalWarningPercent: 10
  };
}

export async function runOpenApiImportCases(plan, fixture, context) {
  const cases = [
    { id: "invalid-utf8", content: Buffer.from([0x4d, 0x65, 0x6d, 0x62, 0x65, 0x72, 0xff]),
      status: 400, problemType: "urn:courtside:error:import-snapshot-unreadable",
      observation: "typed-upload-rejection" },
    { id: "duplicate-columns", content: Buffer.from(
      "Member number,First name,Last name,Email,First name\n4711,Jane,Doe,jane.doe@example.org,Jane\n"),
      status: 400, problemType: "urn:courtside:error:import-snapshot-unreadable",
      observation: "typed-upload-rejection" },
    { id: "oversized-cell", content: Buffer.from(
      `Member number,First name,Last name,Email\n4711,${"J".repeat(4096)},Doe,jane.doe@example.org\n`),
      status: 201, observation: "row-level-rejection" },
    { id: "conflicting-reference", content: Buffer.from(
      "Member number,First name,Last name,Email\n4711,Jane,Doe,jane.doe@example.org\n4711,John,Roe,john.roe@example.org\n"),
      status: 201, observation: "row-level-rejection" }
  ];
  const results = [];
  let generatedBytes = 0;
  for (const entry of cases) {
    const probe = multipartProbe(fixture.sourceId, entry.id, entry.content);
    generatedBytes += probe.body.length;
    const response = await authorizationRequest(plan.target, fixture.client,
      probe, {
        ca: context.ca, signal: context.signal, csrf: true,
        timeoutMilliseconds: context.timeoutMilliseconds
      });
    const passed = response.status === entry.status
      && (!entry.problemType || response.problemType === entry.problemType)
      && (entry.observation !== "row-level-rejection" || response.json?.rowErrors?.length > 0);
    results.push({ id: entry.id, status: response.status,
      ...(response.problemType ? { problemType: response.problemType } : {}),
      observation: entry.observation, outcome: passed ? "passed" : "incomplete" });
  }
  return { cases: results, requestCount: cases.length, generatedBytes };
}

export async function runOpenApiInputCases(plan, fixture, context) {
  const zero = "00000000-0000-0000-0000-000000000000";
  const booking = JSON.stringify({ courtIds: [zero], cardId: zero,
    startsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z" });
  const cases = [
    inputCase("missing-fields", "POST", "/api/admin/courts", "{}"),
    inputCase("duplicate-fields", "POST", "/api/admin/courts", '{"name":null,"name":null}'),
    inputCase("unknown-fields", "POST", "/api/admin/courts", '{"name":null,"unknown":"value"}'),
    inputCase("unicode-normalization", "POST", "/api/admin/courts", '{"name":null,"probe":"e\\u0301"}'),
    inputCase("control-characters", "POST", "/api/admin/courts", '{"name":"\u0000"}'),
    inputCase("deep-json", "POST", "/api/admin/courts",
      JSON.stringify({ name: null, probe: nestedObject(64) })),
    inputCase("oversized-body", "POST", "/api/admin/courts", "x".repeat(2 * 1024 * 1024 + 1), 413),
    inputCase("numeric-boundary", "GET", "/api/admin/audit?limit=2147483648"),
    inputCase("cursor-boundary", "GET", `/api/admin/audit?cursor=${"x".repeat(4096)}`),
    inputCase("date-time-boundary", "GET", "/api/bookings?week=9999-99-99"),
    { ...inputCase("malformed-idempotency-key", "POST", "/api/bookings", booking),
      headers: { "idempotency-key": "x".repeat(129) } }
  ];
  const results = [];
  let generatedBytes = 0;
  for (const entry of cases) {
    generatedBytes += Buffer.byteLength(entry.body ?? "") + Buffer.byteLength(entry.path);
    const response = await authorizationRequest(plan.target, fixture.client, {
      method: entry.method,
      path: entry.path,
      headers: { ...(entry.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(entry.headers ?? {}) },
      ...(entry.body !== undefined ? { body: entry.body } : {})
    }, { ca: context.ca, csrf: entry.method !== "GET", timeoutMilliseconds: context.timeoutMilliseconds,
      acceptConnectionReset: entry.id === "oversized-body" });
    const typed = response.status >= 400 && response.status < 500
      && /^urn:courtside:error:[a-z0-9-]+$/.test(response.problemType ?? "");
    const proxyRejected = entry.expectedStatus === 413
      && (response.status === 413 || response.transportError === "connection-reset");
    results.push({ id: entry.id,
      ...(response.status ? { status: response.status } : {}),
      ...(response.transportError ? { transportError: response.transportError } : {}),
      ...(response.problemType ? { problemType: response.problemType } : {}),
      observation: proxyRejected ? "proxy-size-rejection" : "typed-input-rejection",
      outcome: typed || proxyRejected ? "passed" : "incomplete" });
  }
  return { cases: results, requestCount: cases.length, generatedBytes };
}

export async function runOpenApiMutationCases(plan, fixture, context) {
  const operations = buildOpenApiFuzzInventory(api)
    .filter(({ method, modes }) => method !== "GET" && modes.includes("negative"));
  const results = [];
  let generatedBytes = 0;
  const send = context.request ?? ((probe) => authorizationRequest(plan.target, fixture.client, probe, {
    ca: context.ca,
    signal: context.signal,
    csrf: true,
    timeoutMilliseconds: context.timeoutMilliseconds
  }));
  for (const operation of operations) {
    const definition = api.paths[operation.path][operation.method.toLowerCase()];
    const parameters = [...(api.paths[operation.path].parameters ?? []), ...(definition.parameters ?? [])];
    const path = operation.path.replaceAll(/\{[^}]+\}/g, "invalid");
    const contentTypes = Object.keys(definition.requestBody?.content ?? {});
    const contentType = contentTypes[0];
    const probe = { method: operation.method, path, headers: {} };
    for (const parameter of parameters.filter(({ in: location, required }) => location === "header" && required)) {
      probe.headers[parameter.name] = "security-invalid";
    }
    if (contentType === "application/json") {
      probe.headers["content-type"] = contentType;
      probe.body = "{";
    } else if (contentType === "application/x-www-form-urlencoded") {
      probe.headers["content-type"] = contentType;
      probe.body = "";
    } else if (contentType === "multipart/form-data") {
      probe.headers["content-type"] = "multipart/form-data; boundary=courtside-invalid";
      probe.body = "--courtside-invalid--\r\n";
    }
    generatedBytes += Buffer.byteLength(path) + Buffer.byteLength(probe.body ?? "");
    const response = await send(probe);
    const passed = response.status >= 400 && response.status < 500
      && /^urn:courtside:error:[a-z0-9-]+$/.test(response.problemType ?? "");
    results.push({ operationId: operation.operationId, method: operation.method, path: operation.path,
      status: response.status, ...(response.problemType ? { problemType: response.problemType } : {}),
      observation: "invalid-mutation-rejected", outcome: passed ? "passed" : "incomplete" });
  }
  return { cases: results, requestCount: results.length, generatedBytes };
}

export function validateOpenApiFuzzEvidence(evidence, inventory = buildOpenApiFuzzInventory(api)) {
  if (!validateEvidenceSchema(evidence)) {
    throw new Error(`OpenAPI fuzz evidence is invalid: ${JSON.stringify(validateEvidenceSchema.errors)}`);
  }
  const expected = inventory.map(({ operationId, method, path, modes, excludedModes }) =>
    JSON.stringify({ operationId, method, path, modes, excludedModes })).toSorted();
  const actual = evidence.operations.map(({ operationId, method, path, modes, excludedModes }) =>
    JSON.stringify({ operationId, method, path, modes, excludedModes })).toSorted();
  if (JSON.stringify(actual) !== JSON.stringify(expected)
      || evidence.image !== openApiFuzzPolicy.image
      || evidence.policyDigest !== openApiFuzzPolicyDigest()
      || evidence.specificationDigest !== openApiSpecificationDigest()
      || evidence.seed !== openApiFuzzPolicy.seed) {
    throw new Error("OpenAPI fuzz evidence contradicts its pinned contract");
  }
  for (const operation of evidence.operations) {
    if (operation.outcomes.length !== operation.modes.length
        || operation.modes.some((mode) => !operation.outcomes.some((outcome) => outcome.mode === mode))) {
      throw new Error(`OpenAPI fuzz evidence omits a mode for ${operation.operationId}`);
    }
  }
  const operationById = new Map(evidence.operations.map((operation) => [operation.operationId, operation]));
  if (evidence.counterexamples.some((counterexample) => {
    const operation = operationById.get(counterexample.operationId);
    return operation == null || operation.method !== counterexample.method
      || operation.path !== counterexample.pathTemplate || !operation.modes.includes(counterexample.mode);
  })) throw new Error("OpenAPI fuzz evidence contains an unbound counterexample");
  const candidateFingerprints = evidence.candidates.map(({ fingerprint }) => fingerprint);
  if (evidence.inputCases.some((entry) => (entry.status === undefined) === (entry.transportError === undefined))) {
    throw new Error("OpenAPI input evidence must contain exactly one transport outcome");
  }
  if (new Set(candidateFingerprints).size !== candidateFingerprints.length) {
    throw new Error("OpenAPI fuzz evidence contains duplicate lifecycle candidates");
  }
  const expectedFingerprints = new Set([
    ...evidence.counterexamples.map((counterexample) => counterexampleCandidate(counterexample,
      { runId: "validation", targetFingerprint: evidence.targetFingerprint }, { attempt: 1 },
      "2000-01-01T00:00:00.000Z").fingerprint),
    ...evidence.undocumentedRoutes.map((route) => undocumentedRouteCandidate(route,
      { runId: "validation", targetFingerprint: evidence.targetFingerprint }, { attempt: 1 },
      "2000-01-01T00:00:00.000Z").fingerprint)
  ]);
  if (expectedFingerprints.size !== candidateFingerprints.length
      || candidateFingerprints.some((fingerprint) => !expectedFingerprints.has(fingerprint))) {
    throw new Error("OpenAPI fuzz evidence omits a lifecycle candidate");
  }
  const expectedImportCases = ["invalid-utf8", "duplicate-columns", "oversized-cell", "conflicting-reference"];
  if (JSON.stringify(evidence.importCases.map(({ id }) => id).toSorted())
      !== JSON.stringify(expectedImportCases.toSorted())) {
    throw new Error("OpenAPI fuzz evidence omits a curated import case");
  }
  if (JSON.stringify(evidence.inputCases.map(({ id }) => id).toSorted())
      !== JSON.stringify(openApiFuzzPolicy.inputClasses.toSorted())) {
    throw new Error("OpenAPI fuzz evidence omits a required input class");
  }
  const expectedMutations = inventory.filter(({ method, modes }) => method !== "GET" && modes.includes("negative"))
    .map(({ operationId, method, path }) => JSON.stringify({ operationId, method, path })).toSorted();
  if (JSON.stringify(evidence.mutationCases.map(({ operationId, method, path }) =>
    JSON.stringify({ operationId, method, path })).toSorted())
      !== JSON.stringify(expectedMutations)) {
    throw new Error("OpenAPI fuzz evidence omits a negative mutation case");
  }
  const derived = evidence.stateBefore !== evidence.stateAfter ? "failed"
    : evidence.counterexamples.length > 0 || evidence.undocumentedRoutes.length > 0
      || evidence.operations.some(({ outcomes }) => outcomes.some(({ outcome }) => outcome === "incomplete"))
      || evidence.inputCases.some(({ outcome }) => outcome === "incomplete")
      || evidence.importCases.some(({ outcome }) => outcome === "incomplete")
      || evidence.mutationCases.some(({ outcome }) => outcome === "incomplete") ? "incomplete" : "passed";
  if (evidence.outcome !== derived) throw new Error("OpenAPI fuzz evidence outcome is inconsistent");
}

function retainOpenApiFuzzEvidence(directory, evidence) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "openapi-fuzz.json");
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function counterexampleCandidate(counterexample, plan, context, observedAt) {
  return createCandidate({
    scanner: "schemathesis",
    ruleId: counterexample.check,
    normalizedSurface: `${counterexample.method} ${counterexample.pathTemplate}`,
    parameter: "request",
    attackClass: "contract-boundary",
    provenance: {
      tool: "schemathesis",
      version: "4.25.0",
      runId: plan.runId,
      attempt: context.attempt,
      targetFingerprint: plan.targetFingerprint,
      observedAt
    },
    evidence: [{
      id: `schemathesis-${counterexample.reproductionDigest.slice(7, 19)}`,
      status: "retained",
      classification: "protected",
      digest: counterexample.reproductionDigest,
      expiresOn: new Date(new Date(observedAt).getTime() + 30 * 86_400_000).toISOString().slice(0, 10)
    }]
  });
}

function undocumentedRouteCandidate(route, plan, context, observedAt) {
  return createCandidate({
    scanner: "schemathesis",
    ruleId: "undocumented-route",
    normalizedSurface: `${route.method} ${route.pathTemplate}`,
    parameter: "route",
    attackClass: "unexpected-api-route",
    provenance: {
      tool: "schemathesis", version: "4.25.0", runId: plan.runId, attempt: context.attempt,
      targetFingerprint: plan.targetFingerprint, observedAt
    },
    evidence: [{
      id: `schemathesis-route-${createHash("sha256").update(`${route.method} ${route.pathTemplate}`)
        .digest("hex").slice(0, 12)}`,
      status: "retained", classification: "protected",
      digest: `sha256:${createHash("sha256").update(`${route.method} ${route.pathTemplate}`).digest("hex")}`,
      expiresOn: new Date(new Date(observedAt).getTime() + 30 * 86_400_000).toISOString().slice(0, 10)
    }]
  });
}

function operationCoverage(operationId, method, path, modes, excludedModes) {
  return { operationId, method: method.toUpperCase(), path, modes, excludedModes };
}

export function runtimeOperations(mappings) {
  const operations = new Map();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const conditions = value.details?.requestMappingConditions;
    for (const path of conditions?.patterns ?? []) {
      if (!path.startsWith("/api") && path !== "/manifest.webmanifest") continue;
      for (const method of conditions?.methods ?? []) {
        const normalizedMethod = String(method).toUpperCase();
        if ([...methods].map((candidate) => candidate.toUpperCase()).includes(normalizedMethod)) {
          operations.set(`${normalizedMethod} ${path}`, { method: normalizedMethod, pathTemplate: path });
        }
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(mappings);
  return [...operations.values()];
}

export function undocumentedRuntimeRoutes(observedRoutes, inventory) {
  if (!Array.isArray(observedRoutes) || observedRoutes.length === 0) {
    throw new Error("Runtime route inventory is empty");
  }
  const documented = new Set(inventory.map(({ method, path }) => `${method} ${path}`));
  return observedRoutes.filter(({ method, pathTemplate }) => !documented.has(`${method} ${pathTemplate}`));
}

function safeCounterexample(operation, mode, caseId, check, generatedCase) {
  const normalizedCheck = String(check).replaceAll("_", "-").toLowerCase();
  const minimizedRequest = minimizedRequestProjection(generatedCase);
  const reproductionDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify({ seed: openApiFuzzPolicy.seed, operationId: operation.operationId,
      mode, check: normalizedCheck, minimizedRequest }))
    .digest("hex")}`;
  return {
    operationId: operation.operationId,
    mode,
    caseId: String(caseId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32),
    check: normalizedCheck.slice(0, 80),
    method: operation.method,
    pathTemplate: operation.path,
    minimizedRequest,
    reproductionDigest
  };
}

function minimizedRequestProjection(generatedCase) {
  const projected = structuredClone(generatedCase);
  delete projected.meta;
  delete projected.cookies;
  if (projected.headers && typeof projected.headers === "object" && !Array.isArray(projected.headers)) {
    for (const name of Object.keys(projected.headers)) {
      if (["authorization", "cookie", "x-xsrf-token"].includes(name.toLowerCase())) delete projected.headers[name];
    }
  }
  const serialized = JSON.stringify(projected);
  if (!serialized || serialized.length > 1_048_576) {
    throw new Error("The minimized request exceeds the protected evidence limit");
  }
  return serialized;
}

function mergeCandidates(candidates) {
  const merged = new Map();
  for (const candidate of candidates) {
    const existing = merged.get(candidate.fingerprint);
    if (!existing) {
      merged.set(candidate.fingerprint, candidate);
      continue;
    }
    const evidenceIds = new Set(existing.evidence.map(({ id }) => id));
    existing.evidence.push(...candidate.evidence.filter(({ id }) => !evidenceIds.has(id)));
  }
  return [...merged.values()];
}

function inputCase(id, method, path, body, expectedStatus = 400) {
  return { id, method, path, ...(body !== undefined ? { body } : {}), expectedStatus };
}

function nestedObject(depth) {
  let value = "boundary";
  for (let level = 0; level < depth; level++) value = { nested: value };
  return value;
}

function requestControl(stopFile, deadline) {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    beforeRequest() {
      if (existsSync(stopFile)) throw new Error("Emergency stop requested");
      if (Date.now() >= deadline.getTime()) throw new Error("The duration budget was exceeded");
    },
    remainingMilliseconds() { return Math.max(1, deadline.getTime() - Date.now()); },
    close() { controller.abort(); }
  };
}

function multipartProbe(sourceId, id, content) {
  const boundary = `courtside-security-${id}`;
  return { method: "POST", path: `/api/admin/import/sources/${sourceId}/previews`,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\nFULL_SNAPSHOT\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${id}.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]) };
}
