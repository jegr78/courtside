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
const operationResponses = collectOperationResponses(api);
const publicPropertyNames = collectPropertyNames(api.components?.schemas ?? {});
const publicMediaTypes = collectMediaTypes(api);
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
      const modes = mutation ? (inputs ? ["negative"] : []) : inputs ? ["positive", "negative"] : ["positive"];
      const excludedModes = {
        ...(mutation ? { positive: policy.positiveMutationRationale } : {}),
        ...(inputs ? {} : { negative: "The operation has no request input to invalidate." })
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
  const dispositions = [];
  let sequence = 0;
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
      let recordedFailure = false;
      for (const caseId of caseIds) {
        const generatedCase = scenario.recorder.cases[caseId].value;
        const failures = (scenario.recorder?.checks?.[caseId] ?? [])
          .filter(({ status }) => status === "failure")
          .map((check) => safeCounterexample(entry, mode, ++sequence, check, generatedCase));
        for (const counterexample of failures) {
          recordedFailure = true;
          const disposition = counterexampleDisposition(counterexample);
          if (disposition === null) {
            counterexamples.push(counterexample);
            failed = true;
          } else {
            dispositions.push(dispositionProjection(counterexample, disposition));
          }
        }
      }
      if (scenario.status !== "success" && !recordedFailure) failed = true;
    }
    const outcome = failed ? "incomplete" : "passed";
    return { operationId: entry.operationId, mode, outcome,
      observation: outcome === "passed" ? "generated-inputs-conform" : "candidate-requires-triage" };
  });
  return { operationResults, counterexamples, dispositions, undocumentedRoutes: [...undocumentedRoutes.values()] };
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
  const dispositions = normalized.flatMap(({ dispositions: values }) => values);
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
    schemaVersion: 3,
    testIds: ["CSA-API-001", "CSA-IMPORT-001"],
    targetFingerprint: plan.targetFingerprint,
    image: openApiFuzzPolicy.image,
    policyDigest: openApiFuzzPolicyDigest(),
    specificationDigest: openApiSpecificationDigest(),
    seed: openApiFuzzPolicy.seed,
    operations,
    counterexamples,
    dispositions,
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

export function securityImportCases() {
  const separator = securityImportSourceRequest("separator-contract", 1).separator;
  const row = (...cells) => `${cells.join(separator)}\n`;
  const header = row("Member number", "First name", "Last name", "Email");
  return [
    { id: "invalid-utf8", content: Buffer.from([0x4d, 0x65, 0x6d, 0x62, 0x65, 0x72, 0xff]),
      status: 400, problemType: "urn:courtside:error:import-snapshot-unreadable",
      observation: "typed-upload-rejection" },
    { id: "duplicate-columns", content: Buffer.from(
      row("Member number", "First name", "Last name", "Email", "First name")
        + row("4711", "Jane", "Doe", "jane.doe@example.org", "Jane")),
      status: 400, problemType: "urn:courtside:error:import-snapshot-unreadable",
      observation: "typed-upload-rejection" },
    { id: "oversized-cell", content: Buffer.from(
      header + row("4711", "J".repeat(4096), "Doe", "jane.doe@example.org")),
      status: 201, observation: "row-level-rejection" },
    { id: "conflicting-reference", content: Buffer.from(
      header + row("4711", "Jane", "Doe", "jane.doe@example.org")
        + row("4711", "John", "Roe", "john.roe@example.org")),
      status: 201, observation: "row-level-rejection" }
  ];
}

export async function runOpenApiImportCases(plan, fixture, context) {
  const cases = securityImportCases();
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
  const observations = [...evidence.counterexamples, ...evidence.dispositions];
  if (observations.some((observation) => {
    const operation = operationById.get(observation.operationId);
    return operation == null || operation.method !== observation.method
      || operation.path !== observation.pathTemplate || !operation.modes.includes(observation.mode);
  })) throw new Error("OpenAPI fuzz evidence contains an unbound observation");
  if (observations.some((observation) => observation.reproductionDigest !== reproductionDigestFor(observation))) {
    throw new Error("OpenAPI fuzz evidence contains an invalid reproduction digest");
  }
  if (evidence.dispositions.some((disposition) => disposition.reason.kind !== "status"
      || counterexampleDisposition(disposition) !== disposition.disposition)) {
    throw new Error("OpenAPI fuzz evidence contains an invalid disposition");
  }
  const actionableDigests = new Set(evidence.counterexamples.map(({ reproductionDigest }) => reproductionDigest));
  if (evidence.dispositions.some(({ reproductionDigest }) => actionableDigests.has(reproductionDigest))) {
    throw new Error("OpenAPI fuzz evidence classifies one observation twice");
  }
  const candidateFingerprints = evidence.candidates.map(({ fingerprint }) => fingerprint);
  if (evidence.inputCases.some((entry) => (entry.status === undefined) === (entry.transportError === undefined))) {
    throw new Error("OpenAPI input evidence must contain exactly one transport outcome");
  }
  if (new Set(candidateFingerprints).size !== candidateFingerprints.length) {
    throw new Error("OpenAPI fuzz evidence contains duplicate lifecycle candidates");
  }
  const expectedCandidates = mergeCandidates([
    ...evidence.counterexamples.map((counterexample) => counterexampleCandidate(counterexample,
      { runId: "validation", targetFingerprint: evidence.targetFingerprint }, { attempt: 1 },
      "2000-01-01T00:00:00.000Z")),
    ...evidence.undocumentedRoutes.map((route) => undocumentedRouteCandidate(route,
      { runId: "validation", targetFingerprint: evidence.targetFingerprint }, { attempt: 1 },
      "2000-01-01T00:00:00.000Z"))
  ]);
  const expectedFingerprints = new Set(expectedCandidates.map(({ fingerprint }) => fingerprint));
  if (expectedFingerprints.size !== candidateFingerprints.length
      || candidateFingerprints.some((fingerprint) => !expectedFingerprints.has(fingerprint))) {
    throw new Error("OpenAPI fuzz evidence omits a lifecycle candidate");
  }
  const expectedEvidence = new Map(expectedCandidates.map((candidate) => [candidate.fingerprint,
    candidate.evidence.map(candidateEvidenceIdentity).toSorted()]));
  if (evidence.candidates.some((candidate) => JSON.stringify(candidate.evidence
    .map(candidateEvidenceIdentity).toSorted()) !== JSON.stringify(expectedEvidence.get(candidate.fingerprint)))) {
    throw new Error("OpenAPI fuzz lifecycle candidate evidence is incomplete");
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
  const statusObservation = counterexample.reason.kind === "status";
  const identity = statusObservation
    ? JSON.stringify({ mode: counterexample.mode, observedStatus: counterexample.reason.observedStatus,
      requestShape: counterexample.requestShape })
    : JSON.stringify(counterexample.reason);
  const reasonDigest = createHash("sha256").update(identity).digest("hex");
  return createCandidate({
    scanner: "schemathesis",
    ruleId: statusObservation ? "http-status-observation" : counterexample.check,
    normalizedSurface: `${counterexample.method} ${counterexample.pathTemplate}`,
    parameter: `reason-${reasonDigest.slice(0, 16)}`,
    attackClass: "contract-boundary",
    provenance: {
      tool: "schemathesis",
      version: "4.25.2",
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

function counterexampleDisposition(counterexample) {
  if (counterexample.reason.kind !== "status") return null;
  const status = counterexample.reason.observedStatus;
  if (status >= 500) return null;
  const qualifiedProxyRejection = ["negative-data-rejection", "status-code-conformance"]
    .includes(counterexample.check);
  if (counterexample.mode === "negative" && qualifiedProxyRejection
      && openApiFuzzPolicy.negativeInputProxyStatuses.includes(status)) {
    return "proxy-negative-input-rejection";
  }
  const businessRejection = counterexample.mode === "positive"
    && counterexample.check === "positive-data-acceptance"
    && status >= 400 && status < 500 && ![401, 403, 421, 429].includes(status);
  return businessRejection && operationAcceptsStatus(counterexample.operationId, status)
    ? "documented-status" : null;
}

function dispositionProjection(counterexample, disposition) {
  return {
    operationId: counterexample.operationId,
    mode: counterexample.mode,
    caseId: counterexample.caseId,
    check: counterexample.check,
    method: counterexample.method,
    pathTemplate: counterexample.pathTemplate,
    reason: counterexample.reason,
    requestShape: counterexample.requestShape,
    reproductionDigest: counterexample.reproductionDigest,
    disposition
  };
}

function operationAcceptsStatus(operationId, status) {
  const responses = operationResponses.get(operationId);
  if (!responses) throw new Error(`OpenAPI operation ${operationId} has no response contract`);
  return responses.has(String(status)) || responses.has(`${Math.floor(status / 100)}XX`) || responses.has("DEFAULT");
}

function reproductionDigestFor(counterexample) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ seed: openApiFuzzPolicy.seed, operationId: counterexample.operationId,
      mode: counterexample.mode, check: counterexample.check, reason: counterexample.reason,
      requestShape: counterexample.requestShape }))
    .digest("hex")}`;
}

function undocumentedRouteCandidate(route, plan, context, observedAt) {
  return createCandidate({
    scanner: "schemathesis",
    ruleId: "undocumented-route",
    normalizedSurface: `${route.method} ${route.pathTemplate}`,
    parameter: "route",
    attackClass: "unexpected-api-route",
    provenance: {
      tool: "schemathesis", version: "4.25.2", runId: plan.runId, attempt: context.attempt,
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

function safeCounterexample(operation, mode, sequence, check, generatedCase) {
  const normalizedCheck = String(check.name).replaceAll("_", "-").toLowerCase();
  const reason = failureReasonProjection(normalizedCheck, check.failure_info?.reason);
  const requestShape = requestShapeProjection(generatedCase);
  const counterexample = {
    operationId: operation.operationId,
    mode,
    caseId: `case-${sequence}`,
    check: normalizedCheck.slice(0, 80),
    method: operation.method,
    pathTemplate: operation.path,
    reason,
    requestShape,
    reproductionDigest: ""
  };
  counterexample.reproductionDigest = reproductionDigestFor(counterexample);
  return counterexample;
}

function failureReasonProjection(check, reason) {
  const allowedKinds = {
    "not-a-server-error": ["status"],
    "status-code-conformance": ["status"],
    "negative-data-rejection": ["status"],
    "positive-data-acceptance": ["status"],
    "content-type-conformance": ["media-type"],
    "response-schema-conformance": ["schema"],
    "response-headers-conformance": ["schema", "protocol"],
    "missing-required-header": ["protocol"],
    "unsupported-method": ["status", "protocol"],
    "allow-header-conformance": ["protocol"]
  };
  const keys = reason && typeof reason === "object" && !Array.isArray(reason)
    ? Object.keys(reason).toSorted() : [];
  const exactKeys = (expected) => JSON.stringify(keys) === JSON.stringify(expected.toSorted());
  const statusSelector = (value) => Number.isInteger(value) && value >= 100 && value <= 599
    || ["1xx", "2xx", "3xx", "4xx", "5xx", "non-5xx"].includes(value);
  const pointerSegments = (value) => typeof value === "string" && value.length <= 300
    && (value === "" || /^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/.test(value))
    ? value.slice(1).split("/").filter(Boolean).map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    : undefined;
  const mediaType = (value) => typeof value === "string" && value.length <= 100
    && publicMediaTypes.has(value);
  const validationKeywords = new Set(["additionalProperties", "allOf", "anyOf", "const", "contains",
    "dependentRequired", "enum", "exclusiveMaximum", "exclusiveMinimum", "format", "json-syntax",
    "maxContains", "maximum", "maxItems", "maxLength", "maxProperties", "minContains", "minimum",
    "minItems", "minLength", "minProperties", "multipleOf", "not", "oneOf", "pattern", "propertyNames",
    "required", "schema", "type", "unevaluatedProperties", "uniqueItems"]);
  let valid = allowedKinds[check]?.includes(reason?.kind) ?? false;
  if (reason?.kind === "status") {
    valid &&= exactKeys(["kind", "observedStatus", "expectedStatuses"])
      && Number.isInteger(reason.observedStatus) && reason.observedStatus >= 100 && reason.observedStatus <= 599
      && Array.isArray(reason.expectedStatuses)
      && reason.expectedStatuses.length > 0 && reason.expectedStatuses.length <= 20
      && reason.expectedStatuses.every(statusSelector)
      && new Set(reason.expectedStatuses).size === reason.expectedStatuses.length;
  } else if (reason?.kind === "media-type") {
    valid &&= exactKeys(["kind", "observed", "expected"])
      && ["missing", "malformed", "undocumented"].includes(reason.observed) && Array.isArray(reason.expected)
      && reason.expected.length > 0 && reason.expected.length <= 20
      && reason.expected.every(mediaType) && new Set(reason.expected).size === reason.expected.length;
  } else if (reason?.kind === "schema") {
    const instanceSegments = pointerSegments(reason.instancePointer);
    valid &&= exactKeys(["kind", "instancePointer", "validationKeyword", "missingProperties"])
      && instanceSegments !== undefined
      && instanceSegments.every((segment) => segment === "*" || publicPropertyNames.has(segment))
      && validationKeywords.has(reason.validationKeyword)
      && Array.isArray(reason.missingProperties) && reason.missingProperties.length <= 20
      && reason.missingProperties.every((value) => publicPropertyNames.has(value))
      && new Set(reason.missingProperties).size === reason.missingProperties.length
      && (reason.validationKeyword === "required" ? reason.missingProperties.length > 0
        : reason.missingProperties.length === 0);
  } else if (reason?.kind === "protocol") {
    valid &&= exactKeys(["kind", "disagreement"])
      && ["missing-required-header", "unsupported-method-status", "missing-allow-header",
        "allow-header-mismatch"].includes(reason.disagreement);
  }
  if (!valid) {
    const diagnostic = reason?.kind === "schema"
      ? schemaReasonDiagnostic(reason, exactKeys, pointerSegments, validationKeywords)
      : "closed-shape-mismatch";
    throw new Error(`Unsupported Schemathesis failure reason for ${check} (${diagnostic})`);
  }
  return structuredClone(reason);
}

function schemaReasonDiagnostic(reason, exactKeys, pointerSegments, validationKeywords) {
  if (!exactKeys(["kind", "instancePointer", "validationKeyword", "missingProperties"])) {
    return "schema-fields";
  }
  const instanceSegments = pointerSegments(reason.instancePointer);
  if (instanceSegments === undefined) return "instance-pointer-shape";
  if (!instanceSegments.every((segment) => segment === "*" || publicPropertyNames.has(segment))) {
    return "instance-pointer-not-public";
  }
  if (!validationKeywords.has(reason.validationKeyword)) return "validation-keyword";
  if (!Array.isArray(reason.missingProperties)) return "missing-properties-shape";
  if (!reason.missingProperties.every((value) => publicPropertyNames.has(value))) {
    return "missing-properties-not-public";
  }
  return "missing-properties-relationship";
}

function collectPropertyNames(value, names = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectPropertyNames(entry, names));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "properties" && entry && typeof entry === "object" && !Array.isArray(entry)) {
        Object.keys(entry).forEach((name) => names.add(name));
      }
      collectPropertyNames(entry, names);
    }
  }
  return names;
}

function collectMediaTypes(value, mediaTypes = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectMediaTypes(entry, mediaTypes));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "content" && entry && typeof entry === "object" && !Array.isArray(entry)) {
        Object.keys(entry).forEach((mediaType) => mediaTypes.add(mediaType.toLowerCase()));
      }
      collectMediaTypes(entry, mediaTypes);
    }
  }
  return mediaTypes;
}

function collectOperationResponses(document) {
  const responses = new Map();
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method) || !operation.operationId) continue;
      const declared = new Set(Object.keys(operation.responses ?? {}).map((status) => status.toUpperCase()));
      if (declared.size === 0) throw new Error(`OpenAPI operation ${operation.operationId} has no responses`);
      responses.set(operation.operationId, declared);
    }
  }
  return responses;
}

function requestShapeProjection(generatedCase) {
  const locations = [
    generatedCase.path_parameters && "path",
    generatedCase.query && "query",
    generatedCase.body !== undefined && "body"
  ].filter(Boolean);
  return { locations: [...new Set(locations)].toSorted() };
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

function candidateEvidenceIdentity(evidence) {
  return JSON.stringify({ id: evidence.id, digest: evidence.digest });
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
