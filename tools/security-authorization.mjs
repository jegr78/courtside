import https from "node:https";
import { createRequire } from "node:module";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAssessmentControl } from "./security-passive-deployment.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const Ajv2020 = require("ajv/dist/2020");
const authorizationEvidenceSchema = JSON.parse(readFileSync(
  new URL("../security/authorization-evidence.schema.json", import.meta.url), "utf8"));
const validateEvidenceSchema = new Ajv2020({ allErrors: true, strict: true }).compile(authorizationEvidenceSchema);
const multipartBoundary = "courtside-security-boundary";
const methods = new Set(["get", "post", "put", "patch", "delete"]);
const roles = ["MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER", "TREASURER", "ADMIN"];
export const authorizationActors = Object.freeze(["ANONYMOUS", ...roles, "INITIAL_PASSWORD"]);
const actorUsernames = Object.freeze({
  MEMBER: "security.member.1",
  TRAINER: "security.trainer.1",
  SPORT_DIRECTOR: "security.sport.director.1",
  YOUTH_DIRECTOR: "security.youth.director.1",
  GROUNDSKEEPER: "security.groundskeeper.1",
  TREASURER: "security.treasurer.1",
  ADMIN: "security.admin.1",
  INITIAL_PASSWORD: "security.bootstrap"
});

export function buildOperationAuthorizationMatrix(api) {
  const inheritedSecurity = api.security ?? [];
  return Object.entries(api.paths ?? {}).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([method]) => methods.has(method))
      .map(([method, operation]) => {
        if (!operation.operationId) throw new Error(`${method.toUpperCase()} ${path} has no operationId`);
        return {
          operationId: operation.operationId,
          method: method.toUpperCase(),
          path,
          mutation: method !== "get",
          parameters: [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])],
          requestBody: operation.requestBody,
          security: operation.security ?? inheritedSecurity,
          expectations: operationExpectations(path, method, operation.security ?? inheritedSecurity)
        };
      }));
}

function operationExpectations(path, method, security) {
  const expectations = Object.fromEntries(authorizationActors.map((actor) => [actor, "deny-forbidden"]));
  if (path === "/api/account/initial-password") {
    expectations.ANONYMOUS = "deny-unauthenticated";
    expectations.INITIAL_PASSWORD = "allow";
    return expectations;
  }
  if (path === "/api/session" && ["get", "post"].includes(method)) {
    return Object.fromEntries(authorizationActors.map((actor) => [actor, "allow"]));
  }
  if (path === "/api/session/logout") {
    expectations.ANONYMOUS = "allow";
    for (const role of roles) expectations[role] = "allow";
    expectations.INITIAL_PASSWORD = "allow";
    return expectations;
  }
  if (security.length === 0) {
    return Object.fromEntries(authorizationActors.map((actor) => [actor, "allow"]));
  }
  expectations.ANONYMOUS = "deny-unauthenticated";
  if (path.startsWith("/api/admin")) {
    expectations.ADMIN = "allow";
    return expectations;
  }
  for (const role of roles) expectations[role] = "allow";
  return expectations;
}

export async function executeOperationMatrix(matrix, send) {
  const ordered = [...matrix].sort((left, right) =>
    Number(left.operationId === "logOut") - Number(right.operationId === "logOut"));
  const results = [];
  for (const operation of ordered) {
    for (const actor of authorizationActors) {
      const expected = operation.expectations[actor];
      const response = await send(operation, actor, buildOperationProbe(operation));
      const evaluated = evaluateOperationResult(expected, response);
      results.push({ operationId: operation.operationId, actor, expected, status: response.status,
        ...(response.problemType ? { problemType: response.problemType } : {}), ...evaluated });
    }
  }
  return results;
}

export function evaluateOperationResult(expected, response) {
  if (expected === "deny-unauthenticated") {
    const passed = response.status === 401
      && response.problemType === "urn:courtside:error:unauthenticated";
    return { outcome: passed ? "passed" : "failed",
      observation: passed ? "typed-unauthenticated" : "unauthenticated-boundary-mismatch" };
  }
  if (expected === "deny-forbidden") {
    const passed = response.status === 403
      && response.problemType === "urn:courtside:error:access-denied";
    return { outcome: passed ? "passed" : "failed",
      observation: passed ? "typed-access-denied" : "forbidden-boundary-mismatch" };
  }
  const passed = ![401, 403].includes(response.status);
  return { outcome: passed ? "passed" : "failed",
    observation: passed ? "authorization-gate-passed" : "authorized-actor-rejected" };
}

export async function executeMutationBoundaryChecks(matrix, send) {
  const checks = [];
  for (const operation of matrix.filter(({ mutation }) => mutation)) {
    const probe = buildOperationProbe(operation);
    const csrf = await send(operation, "csrf", probe);
    const csrfPassed = typedResponse(csrf, 403, "urn:courtside:error:access-denied");
    checks.push(boundaryResult(operation.operationId, "csrf", csrf,
      csrfPassed, "missing-csrf-rejected"));
    const corsProbe = { method: "OPTIONS", path: probe.path, headers: {
      origin: "https://attacker.example", "access-control-request-method": operation.method
    } };
    const cors = await send(operation, "cors", corsProbe);
    checks.push(boundaryResult(operation.operationId, "cors", cors,
      cors.accessControlAllowed === false, "cross-origin-preflight-not-authorized"));
    const host = await send(operation, "host", {
      method: "GET", path: "/__security/request-observation", headers: { host: "attacker.example" }
    });
    checks.push(boundaryResult(operation.operationId, "host", host,
      host.observedHost === "localhost", "host-header-canonicalized"));
    const forwarded = await send(operation, "forwarded-host", {
      ...probe, headers: { ...probe.headers, "x-forwarded-host": "attacker.example" }
    });
    checks.push(boundaryResult(operation.operationId, "forwarded-host", forwarded,
      forwarded.status === 421, "forwarded-host-rejected"));
  }
  return checks;
}

function boundaryResult(operationId, boundary, response, passed, secureObservation) {
  return { operationId, boundary, status: response.status, outcome: passed ? "passed" : "failed",
    ...(response.problemType ? { problemType: response.problemType } : {}),
    observation: passed ? secureObservation : `${boundary}-boundary-mismatch` };
}

export async function executeObjectAuthorizationChecks(send) {
  const checks = [];
  const beforeBookings = await send("MEMBER_OWNER", { method: "GET", path: "/api/my/bookings?limit=100", headers: {} });
  const items = beforeBookings.json?.items;
  const standalone = items?.find(({ seriesId }) => seriesId == null);
  const seriesOccurrence = items?.find(({ seriesId }) => seriesId != null);
  if (beforeBookings.status !== 200 || !standalone?.id || !seriesOccurrence?.id || !seriesOccurrence.seriesId) {
    throw new Error("The synthetic ownership fixtures are incomplete");
  }
  const bookingSnapshot = bookingState(items);
  const horizontalCancel = await send("MEMBER_NON_OWNER", {
    method: "DELETE", path: `/api/bookings/${standalone.id}`, headers: {}
  });
  checks.push(objectCheck("horizontal-booking-cancel", horizontalCancel,
    typedResponse(horizontalCancel, 403, "urn:courtside:error:booking-not-owned"), "non-owner-cancel-rejected"));
  const managedDetail = await send("MEMBER_NON_OWNER", {
    method: "GET", path: `/api/managed/bookings/${standalone.id}`, headers: {}
  });
  checks.push(objectCheck("horizontal-managed-detail", managedDetail,
    typedResponse(managedDetail, 403, "urn:courtside:error:booking-not-owned"), "non-manager-detail-rejected"));
  const seriesCancel = await send("MEMBER_NON_OWNER", {
    method: "DELETE",
    path: `/api/booking-series/${seriesOccurrence.seriesId}?fromBookingId=${seriesOccurrence.id}&scope=WHOLE_SERIES`,
    headers: {}
  });
  checks.push(objectCheck("horizontal-series-cancel", seriesCancel,
    typedResponse(seriesCancel, 403, "urn:courtside:error:booking-not-owned"), "non-owner-series-rejected"));
  const unknown = await send("MEMBER_NON_OWNER", {
    method: "DELETE", path: "/api/bookings/00000000-0000-0000-0000-000000000000", headers: {}
  });
  checks.push(objectCheck("identifier-substitution", unknown,
    typedResponse(unknown, 404, "urn:courtside:error:booking-not-found"), "unknown-identifier-rejected"));
  const adminDetail = await send("ADMIN", {
    method: "GET", path: `/api/managed/bookings/${standalone.id}`, headers: {}
  });
  checks.push(objectCheck("vertical-admin-management", adminDetail,
    adminDetail.status === 200, "admin-management-allowed"));
  const rosterBefore = await send("ADMIN", { method: "GET", path: "/api/admin/roster?limit=200", headers: {} });
  const member = rosterBefore.json?.entries?.find(({ username }) => username === "security.member.1");
  if (rosterBefore.status !== 200 || !member?.personId) throw new Error("The synthetic roster fixture is incomplete");
  const massAssignment = await send("ADMIN", { method: "PUT", path: `/api/admin/roster/${member.personId}`,
    headers: { "content-type": "application/json" }, body: JSON.stringify({
      firstName: member.firstName, lastName: member.lastName, email: member.email,
      roles: ["ADMIN"], enabled: false, accountId: "00000000-0000-0000-0000-000000000000"
    }) });
  const rosterAfter = await send("ADMIN", { method: "GET", path: "/api/admin/roster?limit=200", headers: {} });
  const memberAfter = rosterAfter.json?.entries?.find(({ personId }) => personId === member.personId);
  const assignmentIgnored = massAssignment.status === 200 && rosterAfter.status === 200
    && memberAfter?.enabled === member.enabled
    && memberAfter?.accountId === member.accountId
    && memberAfter?.membershipTypeId === member.membershipTypeId
    && JSON.stringify(memberAfter?.roles) === JSON.stringify(member.roles);
  checks.push(objectCheck("mass-assignment", massAssignment, assignmentIgnored,
    "unbound-account-fields-ignored"));
  const bookingsAfter = await send("MEMBER_OWNER", { method: "GET", path: "/api/my/bookings?limit=100", headers: {} });
  checks.push(objectCheck("rejected-attacks-preserve-bookings", bookingsAfter,
    bookingsAfter.status === 200 && bookingState(bookingsAfter.json?.items) === bookingSnapshot,
    "booking-state-unchanged"));
  return checks;
}

function typedResponse(response, status, problemType) {
  return response.status === status && response.problemType === problemType;
}

function objectCheck(id, response, passed, secureObservation) {
  return { id, status: response.status, outcome: passed ? "passed" : "failed",
    ...(response.problemType ? { problemType: response.problemType } : {}),
    observation: passed ? secureObservation : `${id}-mismatch` };
}

function bookingState(items) {
  return JSON.stringify((items ?? []).map(({ id, seriesId, status }) => ({ id, seriesId, status }))
    .toSorted((left, right) => left.id.localeCompare(right.id)));
}

export function buildOperationProbe(operation) {
  let path = operation.path;
  const query = new URLSearchParams();
  for (const parameter of operation.parameters ?? []) {
    const value = parameterValue(parameter);
    if (parameter.in === "path") path = path.replace(`{${parameter.name}}`, encodeURIComponent(value));
    if (parameter.in === "query" && parameter.required) query.set(parameter.name, value);
  }
  const headers = {};
  if ((operation.parameters ?? []).some((parameter) => parameter.in === "header"
      && parameter.name.toLowerCase() === "idempotency-key")) {
    headers["idempotency-key"] = "security-authorization-probe";
  }
  let body;
  if (operation.requestBody) {
    const contentTypes = Object.keys(operation.requestBody.content ?? {});
    const contentType = contentTypes.includes("application/json") ? "application/json" : contentTypes[0];
    if (contentType === "multipart/form-data") {
      headers["content-type"] = `multipart/form-data; boundary=${multipartBoundary}`;
      body = `--${multipartBoundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\nFULL\r\n`
        + `--${multipartBoundary}\r\nContent-Disposition: form-data; name="file"; filename="empty.csv"\r\n`
        + `Content-Type: text/csv\r\n\r\nexternal_id\r\n--${multipartBoundary}--\r\n`;
    } else {
      if (contentType) headers["content-type"] = contentType;
      body = contentType === "application/x-www-form-urlencoded" ? "username=&password=" : "{}";
    }
  }
  return { method: operation.method, path: `${path}${query.size ? `?${query}` : ""}`, headers, body };
}

function parameterValue(parameter) {
  const schema = parameter.schema ?? {};
  if (schema.enum?.length) return String(schema.enum[0]);
  if (schema.format === "uuid") return "00000000-0000-0000-0000-000000000000";
  if (schema.format === "date") return "2026-01-15";
  if (schema.type === "integer") return String(schema.minimum ?? 1);
  return "security-probe";
}

export function evaluateLoginTiming(knownSamples, unknownSamples) {
  if (knownSamples.length !== unknownSamples.length || knownSamples.length < 12
      || [...knownSamples, ...unknownSamples].some((sample) => !Number.isFinite(sample) || sample <= 0)) {
    throw new Error("Login timing requires twelve positive paired samples per class");
  }
  const medianKnownMilliseconds = median(knownSamples);
  const medianUnknownMilliseconds = median(unknownSamples);
  const medianRelativeDifference = Math.abs(medianKnownMilliseconds - medianUnknownMilliseconds)
    / Math.max(medianKnownMilliseconds, medianUnknownMilliseconds);
  return {
    outcome: medianRelativeDifference <= 0.5 ? "passed" : "failed",
    samplesPerClass: knownSamples.length,
    medianKnownMilliseconds: rounded(medianKnownMilliseconds),
    medianUnknownMilliseconds: rounded(medianUnknownMilliseconds),
    medianRelativeDifference: rounded(medianRelativeDifference)
  };
}

export async function executeAuthenticationChecks(send, password) {
  const client = new SecurityCookieJar();
  await send(client, { method: "GET", path: "/api/session", headers: {} });
  const knownSamples = [];
  const unknownSamples = [];
  for (let sample = 0; sample < 12; sample += 1) {
    const responses = {};
    for (const identity of loginTimingSampleOrder(sample)) {
      responses[identity] = await failedLogin(send, client, "/api/session",
        identity === "known" ? "security.member.1" : "security.missing", `${password}-wrong`);
    }
    const { known, unknown } = responses;
    if (!typedResponse(known, 401, "urn:courtside:error:unauthenticated")
        || !typedResponse(unknown, 401, "urn:courtside:error:unauthenticated")) {
      throw new Error("Login timing samples did not return the typed authentication failure");
    }
    knownSamples.push(known.elapsedMilliseconds);
    unknownSamples.push(unknown.elapsedMilliseconds);
    await signInSecurityUsername(send, client, "security.member.1", password, "MEMBER");
    await send(client, { method: "POST", path: "/api/session/logout", headers: {} }, { csrf: true });
    await send(client, { method: "GET", path: "/api/session", headers: {} });
  }
  const timing = evaluateLoginTiming(knownSamples, unknownSamples);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await failedLogin(send, client, "/api/sessio%6E", "security.member.1", `${password}-wrong`);
    if (!typedResponse(response, 401, "urn:courtside:error:unauthenticated")) {
      throw new Error(`Encoded login attempt ${attempt + 1} did not reach the shared limiter`);
    }
  }
  const limited = await failedLogin(send, client, "/api/session", "security.member.1", `${password}-wrong`);
  const bruteForce = {
    outcome: typedResponse(limited, 429, "urn:courtside:error:login-rate-limited") ? "passed" : "failed",
    attemptsBeforeLimit: 20,
    status: limited.status,
    ...(limited.problemType ? { problemType: limited.problemType } : {}),
    observation: "encoded-and-canonical-login-share-rate-limit"
  };
  return { timing, bruteForce };
}

export function loginTimingSampleOrder(sample) {
  return sample % 2 === 0 ? ["known", "unknown"] : ["unknown", "known"];
}

export async function executeSecondaryIdentityChecks(send, password) {
  const checks = [];
  for (const role of roles) {
    const client = new SecurityCookieJar();
    const username = `security.${role.toLowerCase().replaceAll("_", ".")}.2`;
    await signInSecurityUsername(send, client, username, password, role);
    const session = await send(client, { method: "GET", path: "/api/session", headers: {} });
    const admin = await send(client, { method: "GET", path: "/api/admin/roster?limit=1", headers: {} });
    const expectedAdminStatus = role === "ADMIN" ? 200 : 403;
    const passed = session.status === 200 && session.json?.roles?.length === 1
      && session.json.roles[0] === role && admin.status === expectedAdminStatus
      && (role === "ADMIN" || admin.problemType === "urn:courtside:error:access-denied");
    checks.push({ actor: role, sessionStatus: session.status, adminStatus: admin.status,
      outcome: passed ? "passed" : "failed", observation: passed
        ? "independent-identity-boundary-proven" : "independent-identity-boundary-mismatch" });
  }
  const managerRoles = ["MEMBER", "SPORT_DIRECTOR", "TRAINER", "YOUTH_DIRECTOR"];
  for (let index = 1; index <= 2; index += 1) {
    const client = new SecurityCookieJar();
    await signInSecurityUsername(send, client, `security.manager.${index}`, password, "MANAGER_COMBINATION");
    const session = await send(client, { method: "GET", path: "/api/session", headers: {} });
    const managed = await send(client, { method: "GET", path: "/api/managed/bookings?limit=1", headers: {} });
    const admin = await send(client, { method: "GET", path: "/api/admin/roster?limit=1", headers: {} });
    const passed = session.status === 200
      && JSON.stringify(session.json?.roles?.toSorted()) === JSON.stringify(managerRoles)
      && managed.status === 200 && typedResponse(admin, 403, "urn:courtside:error:access-denied");
    checks.push({ actor: `MANAGER_COMBINATION_${index}`, sessionStatus: session.status,
      managedStatus: managed.status, adminStatus: admin.status, outcome: passed ? "passed" : "failed",
      observation: passed ? "independent-identity-boundary-proven"
        : "independent-identity-boundary-mismatch" });
  }
  return checks;
}

async function failedLogin(send, client, path, username, password) {
  const body = new URLSearchParams({ username, password }).toString();
  return send(client, { method: "POST", path,
    headers: { "content-type": "application/x-www-form-urlencoded" }, body }, { csrf: true });
}

function median(values) {
  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rounded(value) {
  return Number(value.toFixed(3));
}

export function validateAuthorizationEvidence(evidence, matrix) {
  if (!validateEvidenceSchema(evidence)) throw new Error("The authorization assessment evidence is invalid");
  const expectedPairs = matrix.flatMap(({ operationId }) =>
    authorizationActors.map((actor) => `${operationId}:${actor}`)).toSorted();
  const actualPairs = evidence.results.map(({ operationId, actor }) => `${operationId}:${actor}`).toSorted();
  if (new Set(actualPairs).size !== actualPairs.length
      || JSON.stringify(expectedPairs) !== JSON.stringify(actualPairs)) {
    throw new Error("The authorization evidence is missing an operation and actor result");
  }
  const expectations = new Map(matrix.flatMap((operation) => authorizationActors.map((actor) =>
    [`${operation.operationId}:${actor}`, operation.expectations[actor]])));
  if (evidence.results.some((result) => expectations.get(`${result.operationId}:${result.actor}`) !== result.expected)) {
    throw new Error("The authorization evidence contradicts the generated policy");
  }
  if (evidence.results.some((result) => {
    const evaluated = evaluateOperationResult(result.expected, result);
    return result.outcome !== evaluated.outcome || result.observation !== evaluated.observation;
  })) throw new Error("The authorization evidence contains an invalid operation result");
  const expectedObjects = ["horizontal-booking-cancel", "horizontal-managed-detail", "horizontal-series-cancel",
    "identifier-substitution", "vertical-admin-management", "mass-assignment", "rejected-attacks-preserve-bookings"];
  if (JSON.stringify(evidence.objectChecks.map(({ id }) => id).toSorted())
      !== JSON.stringify(expectedObjects.toSorted())) {
    throw new Error("The authorization evidence is missing an object boundary");
  }
  const expectedBoundaries = matrix.filter(({ mutation }) => mutation).flatMap(({ operationId }) =>
    ["csrf", "cors", "host", "forwarded-host"].map((boundary) => `${operationId}:${boundary}`)).toSorted();
  const actualBoundaries = evidence.boundaryChecks
    .map(({ operationId, boundary }) => `${operationId}:${boundary}`).toSorted();
  if (new Set(actualBoundaries).size !== actualBoundaries.length
      || JSON.stringify(expectedBoundaries) !== JSON.stringify(actualBoundaries)) {
    throw new Error("The authorization evidence is missing a mutation boundary");
  }
  const expectedIdentities = [...roles, "MANAGER_COMBINATION_1", "MANAGER_COMBINATION_2"].toSorted();
  if (JSON.stringify(evidence.identityChecks.map(({ actor }) => actor).toSorted())
      !== JSON.stringify(expectedIdentities)) {
    throw new Error("The authorization evidence is missing an independent role identity");
  }
  if (evidence.identityChecks.some((check) => {
    const manager = check.actor.startsWith("MANAGER_COMBINATION_");
    const expectedAdminStatus = check.actor === "ADMIN" ? 200 : 403;
    return check.sessionStatus !== 200 || check.adminStatus !== expectedAdminStatus
      || (manager && check.managedStatus !== 200) || check.outcome !== "passed";
  })) throw new Error("The authorization evidence contains an invalid independent identity result");
  const checks = [...evidence.results, ...evidence.identityChecks, ...evidence.objectChecks, ...evidence.boundaryChecks,
    evidence.timing, evidence.bruteForce];
  const derivedOutcome = checks.some(({ outcome }) => outcome === "failed") ? "failed"
    : checks.some(({ outcome }) => outcome === "incomplete") ? "incomplete" : "passed";
  if (evidence.outcome !== derivedOutcome) throw new Error("The authorization evidence outcome is inconsistent");
  const minimumRequests = evidence.results.length + evidence.identityChecks.length * 2
    + evidence.objectChecks.length + evidence.boundaryChecks.length
    + evidence.timing.samplesPerClass * 2 + evidence.bruteForce.attemptsBeforeLimit + 1;
  if (evidence.requestCount < minimumRequests) {
    throw new Error("The authorization evidence request count is inconsistent");
  }
}

export async function runAuthorizationAssessment(plan, context) {
  if (plan.profile !== "active" || plan.environment !== "SECURITY"
      || !["CSA-AUTHN-001", "CSA-AUTHZ-001", "CSA-DAST-001"]
        .every((testId) => plan.selectedTests.includes(testId))) {
    throw new Error("The authorization suite requires active authentication and authorization tests in SECURITY");
  }
  const api = yaml.load(readFileSync(new URL("../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));
  const matrix = buildOperationAuthorizationMatrix(api);
  const control = createAssessmentControl(context.stopFile, context.deadline);
  if (!Number.isSafeInteger(context.maxRequests) || context.maxRequests < 1) {
    throw new Error("The authorization suite has no remaining request budget");
  }
  let requestCount = 0;
  const request = async (client, probe, options = {}) => {
    control.beforeRequest();
    if (++requestCount > context.maxRequests) throw new Error("The authorization request budget was exceeded");
    return authorizationRequest(plan.target, client, probe, {
      ca: context.ca,
      signal: control.signal,
      timeoutMilliseconds: control.remainingMilliseconds(),
      ...options
    });
  };
  try {
    const clients = Object.fromEntries(authorizationActors.map((actor) => [actor, new SecurityCookieJar()]));
    for (const actor of authorizationActors.filter((candidate) => candidate !== "ANONYMOUS")) {
      await signInSecurityActor(request, clients[actor], actor, context.sharedPassword);
    }
    const secondMember = new SecurityCookieJar();
    await signInSecurityUsername(request, secondMember, "security.member.2", context.sharedPassword, "MEMBER");
    const identityChecks = await executeSecondaryIdentityChecks(request, context.sharedPassword);
    const boundaryChecks = await executeMutationBoundaryChecks(matrix, async (operation, boundary, probe) => {
      const allowedActor = authorizationActors.find((actor) => actor !== "ANONYMOUS"
        && operation.expectations[actor] === "allow") ?? "ANONYMOUS";
      const csrfActor = operation.operationId === "logIn" ? "ANONYMOUS" : allowedActor;
      const actor = boundary === "csrf" ? csrfActor : "ANONYMOUS";
      return request(clients[actor], probe, { csrf: boundary === "host" });
    });
    const objectClients = { MEMBER_OWNER: clients.MEMBER, MEMBER_NON_OWNER: secondMember, ADMIN: clients.ADMIN };
    const objectChecks = await executeObjectAuthorizationChecks((actor, probe) =>
      request(objectClients[actor], probe, { csrf: probe.method !== "GET" }));
    const results = await executeOperationMatrix(matrix, async (operation, actor, probe) => {
      if (operation.operationId === "logIn") {
        const client = actor === "ANONYMOUS" ? new SecurityCookieJar() : clients[actor];
        const loginActor = actor === "ANONYMOUS" ? "MEMBER" : actor;
        return signInSecurityActor(request, client, loginActor, context.sharedPassword);
      }
      return request(clients[actor], probe, { csrf: operation.mutation });
    });
    const authentication = await executeAuthenticationChecks(request, context.sharedPassword);
    const evidence = {
      schemaVersion: 1,
      testIds: ["CSA-AUTHN-001", "CSA-AUTHZ-001"],
      targetFingerprint: plan.targetFingerprint,
      results,
      identityChecks,
      objectChecks,
      boundaryChecks,
      timing: authentication.timing,
      bruteForce: authentication.bruteForce,
      requestCount,
      outcome: [...results, ...identityChecks, ...objectChecks, ...boundaryChecks, authentication.timing,
        authentication.bruteForce].some((result) => result.outcome === "failed") ? "failed" : "passed"
    };
    validateAuthorizationEvidence(evidence, matrix);
    retainAuthorizationEvidence(context.evidenceDirectory, evidence, plan.budgets.evidenceMegabytes);
    return evidence;
  } finally {
    control.close();
  }
}

async function signInSecurityActor(request, client, actor, password) {
  return signInSecurityUsername(request, client, actorUsernames[actor], password, actor);
}

async function signInSecurityUsername(request, client, username, password, actor) {
  await request(client, { method: "GET", path: "/api/session", headers: {} });
  const body = new URLSearchParams({ username, password }).toString();
  const response = await request(client, { method: "POST", path: "/api/session",
    headers: { "content-type": "application/x-www-form-urlencoded" }, body }, { csrf: true });
  if (response.status !== 200) throw new Error(`Synthetic ${actor} authentication failed with ${response.status}`);
  return response;
}

export class SecurityCookieJar {
  #cookies = new Map();

  update(setCookies = []) {
    for (const value of setCookies) {
      const pair = /^([^=;]+)=([^;]*)/.exec(value);
      if (!pair) throw new Error("The target returned an invalid cookie");
      if (value.includes("Max-Age=0") || !pair[2]) this.#cookies.delete(pair[1]);
      else this.#cookies.set(pair[1], pair[2]);
    }
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  csrfToken() {
    const encoded = this.#cookies.get("XSRF-TOKEN");
    return encoded ? decodeURIComponent(encoded) : undefined;
  }
}

export function authorizationRequest(origin, client, probe, options = {}) {
  const target = new URL(probe.path, origin);
  if (target.origin !== origin) throw new Error("The authorization probe left the target origin");
  const headers = { ...probe.headers };
  const cookie = client.header();
  if (cookie) headers.cookie = cookie;
  if (options.csrf) {
    const token = client.csrfToken();
    if (token) headers["x-xsrf-token"] = token;
  }
  if (probe.body !== undefined) headers["content-length"] = Buffer.byteLength(probe.body);
  return new Promise((resolve, reject) => {
    const maxResponseBytes = options.maxResponseBytes ?? 64 * 1024;
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 2 * 1024 * 1024) {
      throw new Error("Authorization response limit is invalid");
    }
    const startedAt = performance.now();
    const chunks = [];
    let bytes = 0;
    const call = https.request(target, { method: probe.method, headers, agent: false, ca: options.ca,
      servername: target.hostname, signal: options.signal,
      timeout: Math.max(1, Math.min(10_000, options.timeoutMilliseconds ?? 10_000)) }, (response) => {
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxResponseBytes) call.destroy(new Error("Authorization response exceeded its size limit"));
        else chunks.push(chunk);
      });
      response.once("end", () => {
        client.update(response.headers["set-cookie"] ?? []);
        const body = Buffer.concat(chunks).toString("utf8");
        let json;
        if (body && /application\/(?:[a-z0-9.-]+\+)?json/i.test(response.headers["content-type"] ?? "")) {
          try { json = JSON.parse(body); } catch { }
        }
        const problemType = /application\/problem\+json/i.test(response.headers["content-type"] ?? "")
          ? json?.type : undefined;
        resolve({ status: response.statusCode, elapsedMilliseconds: performance.now() - startedAt,
          ...(problemType ? { problemType } : {}),
          ...(json ? { json } : {}),
          ...(response.headers["x-courtside-observed-host"]
            ? { observedHost: response.headers["x-courtside-observed-host"] } : {}),
          accessControlAllowed: response.headers["access-control-allow-origin"] !== undefined,
          redirected: response.statusCode >= 300 && response.statusCode < 400 });
      });
    });
    call.once("timeout", () => call.destroy(new Error("Authorization request timed out")));
    call.once("error", (failure) => reject(new Error(
      `Authorization ${probe.method} ${target.pathname} failed: ${failure.message}`)));
    if (probe.body !== undefined) call.write(probe.body);
    call.end();
  });
}

function retainAuthorizationEvidence(directory, evidence, evidenceMegabytes) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > evidenceMegabytes * 1024 * 1024) {
    throw new Error("The authorization evidence budget was exceeded");
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "authorization-matrix.json");
  writeFileSync(path, serialized, { mode: 0o600 });
  chmodSync(path, 0o600);
}
