import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createCandidate } from "./security-triage.mjs";
import { authorizationRequest, SecurityCookieJar } from "./security-authorization.mjs";

const methods = new Set(["get", "post", "put", "patch", "delete"]);
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const Ajv = require("ajv/dist/2020").default;
const specification = readFileSync(new URL("../src/main/resources/api/openapi.yaml", import.meta.url));
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

export function normalizeSchemathesisEvents(events, inventory, mode) {
  if (!events.length) throw new Error("Schemathesis produced no operation inventory");
  const loading = events.find(({ LoadingFinished }) => LoadingFinished)?.LoadingFinished;
  if (loading?.statistic?.operations?.total !== inventory.length) {
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
    scenarios.set(entry.operationId, scenario);
  }
  const counterexamples = [];
  const operationResults = expected.map((entry) => {
    const scenario = scenarios.get(entry.operationId);
    if (!scenario) throw new Error(`Schemathesis omitted operation ${entry.operationId}`);
    const observedModes = new Set(Object.values(scenario.recorder?.cases ?? {})
      .map(({ value }) => value?.meta?.generation?.mode).filter(Boolean));
    if (!observedModes.has(mode)) throw new Error(`Schemathesis omitted ${mode} inputs for ${entry.operationId}`);
    for (const [caseId, checks] of Object.entries(scenario.recorder?.checks ?? {})) {
      for (const check of checks.filter(({ status }) => status === "failure")) {
        counterexamples.push(safeCounterexample(entry, mode, caseId, check.name));
      }
    }
    const outcome = scenario.status === "success" ? "passed" : "incomplete";
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
  const scanner = await context.runFuzzer(plan, {
    inventory,
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
    normalizeSchemathesisEvents(scanner.events[mode], inventory, mode));
  const operationOutcomes = normalized.flatMap(({ operationResults }) => operationResults);
  const counterexamples = normalized.flatMap(({ counterexamples: values }) => values);
  const undocumentedRoutes = normalized.flatMap(({ undocumentedRoutes: values }) => values)
    .filter((value, index, values) => values.findIndex((candidate) =>
      candidate.method === value.method && candidate.pathTemplate === value.pathTemplate) === index);
  const operations = inventory.map((entry) => ({ ...entry,
    outcomes: operationOutcomes.filter(({ operationId }) => operationId === entry.operationId)
      .map(({ mode, outcome, observation }) => ({ mode, outcome, observation }))
  }));
  const observedAt = (context.now?.() ?? new Date()).toISOString();
  const candidates = counterexamples.map((counterexample) => counterexampleCandidate(counterexample, plan, context,
    observedAt));
  candidates.push(...undocumentedRoutes.map((route) => undocumentedRouteCandidate(route, plan, context, observedAt)));
  const stateChanged = scanner.stateBefore !== scanner.stateAfter;
  const incomplete = counterexamples.length > 0 || undocumentedRoutes.length > 0
    || operationOutcomes.some(({ outcome }) => outcome === "incomplete")
    || scanner.importCases.some(({ outcome }) => outcome === "incomplete");
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
    importCases: scanner.importCases,
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
    headers: { "content-type": "application/json" }, body: JSON.stringify({
      sourceKey: `security-fuzz-${context.attempt}`,
      displayName: "Security fuzz source",
      columns: { "Member number": "EXTERNAL_ID", "First name": "FIRST_NAME",
        "Last name": "LAST_NAME", Email: "EMAIL" },
      defaultMembershipTypeId: "cccccccc-0000-0000-0000-000000000001",
      removalWarningPercent: 10
    }) }, { csrf: true });
  if (source.status !== 201 || !source.json?.id) throw new Error("Synthetic import source setup failed");
  return { client, sourceId: source.json.id, requestCount, close: () => control.close() };
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
  for (const entry of cases) {
    const response = await authorizationRequest(plan.target, fixture.client,
      multipartProbe(fixture.sourceId, entry.id, entry.content), {
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
  return { cases: results, requestCount: cases.length };
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
  if (evidence.candidates.length !== evidence.counterexamples.length + evidence.undocumentedRoutes.length) {
    throw new Error("OpenAPI fuzz evidence omits a lifecycle candidate");
  }
  const expectedImportCases = ["invalid-utf8", "duplicate-columns", "oversized-cell", "conflicting-reference"];
  if (JSON.stringify(evidence.importCases.map(({ id }) => id).toSorted())
      !== JSON.stringify(expectedImportCases.toSorted())) {
    throw new Error("OpenAPI fuzz evidence omits a curated import case");
  }
  const derived = evidence.stateBefore !== evidence.stateAfter ? "failed"
    : evidence.counterexamples.length > 0 || evidence.undocumentedRoutes.length > 0
      || evidence.operations.some(({ outcomes }) => outcomes.some(({ outcome }) => outcome === "incomplete"))
      || evidence.importCases.some(({ outcome }) => outcome === "incomplete") ? "incomplete" : "passed";
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

function safeCounterexample(operation, mode, caseId, check) {
  const normalizedCheck = String(check).replaceAll("_", "-").toLowerCase();
  const reproductionDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify({ operationId: operation.operationId, mode, caseId, check: normalizedCheck }))
    .digest("hex")}`;
  return {
    operationId: operation.operationId,
    mode,
    caseId: String(caseId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32),
    check: normalizedCheck.slice(0, 80),
    method: operation.method,
    pathTemplate: operation.path,
    reproductionDigest
  };
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
