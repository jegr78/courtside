import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  authorizationActors,
  buildOperationAuthorizationMatrix,
  buildOperationProbe,
  evaluateOperationResult,
  executeMutationBoundaryChecks,
  evaluateLoginTiming,
  loginTimingSampleOrder,
  executeObjectAuthorizationChecks,
  executeOperationMatrix,
  SecurityCookieJar,
  validateAuthorizationEvidence
} from "./security-authorization.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const api = yaml.load(readFileSync(new URL("../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));

test("given the OpenAPI contract, when generating authorization cases, then every operation covers every actor", () => {
  // when
  const matrix = buildOperationAuthorizationMatrix(api);

  // then
  assert.equal(matrix.length, 89);
  assert.equal(new Set(matrix.map((entry) => entry.operationId)).size, 89);
  assert.deepEqual(Object.keys(matrix[0].expectations).toSorted(), [...authorizationActors].toSorted());
  assert.ok(matrix.every((entry) => Object.keys(entry.expectations).length === authorizationActors.length));
});

test("given two members and an administrator, when substituting owned identifiers and fields, then state stays unchanged", async () => {
  // given
  const standaloneId = "10000000-0000-0000-0000-000000000001";
  const seriesBookingId = "10000000-0000-0000-0000-000000000002";
  const seriesId = "20000000-0000-0000-0000-000000000001";
  const personId = "30000000-0000-0000-0000-000000000001";
  const bookings = { items: [
    { id: standaloneId, seriesId: null, status: "CONFIRMED" },
    { id: seriesBookingId, seriesId, status: "CONFIRMED" }
  ] };
  const roster = { entries: [{ personId, username: "security.member.1", firstName: "Security",
    lastName: "Member1", email: "security.member.1@example.org", enabled: true, roles: ["MEMBER"],
    accountId: "40000000-0000-0000-0000-000000000001",
    membershipTypeId: "50000000-0000-0000-0000-000000000001" }] };
  const calls = [];

  // when
  const checks = await executeObjectAuthorizationChecks(async (actor, probe) => {
    calls.push({ actor, probe });
    if (probe.path === "/api/my/bookings?limit=100") return { status: 200, json: bookings };
    if (probe.path === "/api/admin/roster?limit=200" && probe.method === "GET") return { status: 200, json: roster };
    if (probe.path === `/api/admin/roster/${personId}` && probe.method === "PUT") return { status: 200, json: roster.entries[0] };
    if (actor === "ADMIN") return { status: 200 };
    if (probe.path.includes("00000000-0000-0000-0000-000000000000")) {
      return { status: 404, problemType: "urn:courtside:error:booking-not-found" };
    }
    return { status: 403, problemType: "urn:courtside:error:booking-not-owned" };
  });

  // then
  assert.ok(checks.length >= 7);
  assert.ok(checks.every(({ outcome }) => outcome === "passed"));
  const massAssignment = calls.find(({ probe }) => probe.path === `/api/admin/roster/${personId}`
    && probe.method === "PUT");
  assert.deepEqual(JSON.parse(massAssignment.probe.body).roles, ["ADMIN"]);
  assert.equal(JSON.parse(massAssignment.probe.body).enabled, false);
});

test("given mutating operations, when attacking request boundaries, then each operation proves CSRF CORS and proxy trust", async () => {
  // given
  const matrix = buildOperationAuthorizationMatrix({ paths: {
    "/api/example": { post: {
      operationId: "createExample",
      requestBody: { content: { "application/json": { schema: { type: "object" } } } }
    } },
    "/api/example/{id}": { get: { operationId: "readExample",
      parameters: [{ name: "id", in: "path", required: true, schema: { format: "uuid" } }] } }
  } });
  const calls = [];

  // when
  const checks = await executeMutationBoundaryChecks(matrix, async (operation, boundary, probe) => {
    calls.push({ operationId: operation.operationId, boundary, probe });
    if (boundary === "csrf") {
      return { status: 403, problemType: "urn:courtside:error:access-denied" };
    }
    if (boundary === "cors") return { status: 403, accessControlAllowed: false };
    if (boundary === "host") return { status: 400, observedHost: "localhost" };
    return { status: 421 };
  });

  // then
  assert.deepEqual(checks.map(({ boundary }) => boundary), ["csrf", "cors", "host", "forwarded-host"]);
  assert.ok(checks.every(({ outcome }) => outcome === "passed"));
  assert.equal(calls[1].probe.method, "OPTIONS");
  assert.equal(calls[1].probe.headers.origin, "https://attacker.example");
  assert.equal(calls[2].probe.path, "/__security/request-observation");
  assert.equal(calls[2].probe.headers.host, "attacker.example");
  assert.equal(calls[3].probe.headers["x-forwarded-host"], "attacker.example");
});

test("given paired login timing samples, when ordering requests, then class order alternates", () => {
  // when / then
  assert.deepEqual(loginTimingSampleOrder(0), ["known", "unknown"]);
  assert.deepEqual(loginTimingSampleOrder(1), ["unknown", "known"]);
  assert.deepEqual(loginTimingSampleOrder(2), ["known", "unknown"]);
});

test("given session cookies, when rotating and expiring them, then the request jar keeps only current values", () => {
  // given
  const jar = new SecurityCookieJar();

  // when
  jar.update(["SESSION=first; Path=/; Secure; HttpOnly", "XSRF-TOKEN=one%20two; Path=/; Secure"]);
  jar.update(["SESSION=second; Path=/; Secure; HttpOnly"]);

  // then
  assert.equal(jar.header(), "SESSION=second; XSRF-TOKEN=one%20two");
  assert.equal(jar.csrfToken(), "one two");
  jar.update(["SESSION=; Max-Age=0; Path=/"]);
  assert.equal(jar.header(), "XSRF-TOKEN=one%20two");
});

test("given public authenticated and administrative operations, when classifying actors, then access is explicit", () => {
  // given
  const matrix = buildOperationAuthorizationMatrix(api);
  const byId = (operationId) => matrix.find((entry) => entry.operationId === operationId);

  // when / then
  assert.equal(byId("listCourts").expectations.ANONYMOUS, "allow");
  assert.equal(byId("listBookableCards").expectations.ANONYMOUS, "deny-unauthenticated");
  assert.equal(byId("listBookableCards").expectations.MEMBER, "allow");
  assert.equal(byId("listCourtsForAdmin").expectations.TREASURER, "deny-forbidden");
  assert.equal(byId("listCourtsForAdmin").expectations.ADMIN, "allow");
  assert.equal(byId("changeInitialPassword").expectations.ADMIN, "deny-forbidden");
  assert.equal(byId("changeInitialPassword").expectations.INITIAL_PASSWORD, "allow");
  assert.equal(byId("logOut").expectations.ANONYMOUS, "allow");
  assert.equal(byId("logOut").expectations.INITIAL_PASSWORD, "allow");
});

test("given typed authorization responses, when evaluating them, then status alone cannot prove denial", () => {
  // when / then
  assert.deepEqual(evaluateOperationResult("deny-unauthenticated", {
    status: 401, problemType: "urn:courtside:error:unauthenticated"
  }), { outcome: "passed", observation: "typed-unauthenticated" });
  assert.deepEqual(evaluateOperationResult("deny-forbidden", {
    status: 403, problemType: "urn:courtside:error:access-denied"
  }), { outcome: "passed", observation: "typed-access-denied" });
  assert.equal(evaluateOperationResult("deny-forbidden", { status: 403 }).outcome, "failed");
  assert.equal(evaluateOperationResult("allow", {
    status: 401, problemType: "urn:courtside:error:unauthenticated"
  }).outcome, "failed");
  assert.equal(evaluateOperationResult("allow", { status: 400 }).outcome, "passed");
});

test("given a generated matrix, when executing it, then logout is last and every pair is observed once", async () => {
  // given
  const matrix = buildOperationAuthorizationMatrix({ paths: {
    "/api/session/logout": { post: { operationId: "logOut" } },
    "/api/public/example": { get: { operationId: "readExample", security: [] } }
  } });
  const calls = [];

  // when
  const results = await executeOperationMatrix(matrix, async (operation, actor) => {
    calls.push(`${operation.operationId}:${actor}`);
    const expectation = operation.expectations[actor];
    if (expectation === "deny-unauthenticated") {
      return { status: 401, problemType: "urn:courtside:error:unauthenticated" };
    }
    if (expectation === "deny-forbidden") {
      return { status: 403, problemType: "urn:courtside:error:access-denied" };
    }
    return { status: 200 };
  });

  // then
  assert.equal(results.length, matrix.length * authorizationActors.length);
  assert.equal(new Set(calls).size, calls.length);
  assert.ok(calls.slice(-authorizationActors.length).every((call) => call.startsWith("logOut:")));
  assert.ok(results.every((result) => result.outcome === "passed"));
});

test("given path query and body parameters, when creating a harmless probe, then all placeholders are bounded", () => {
  // given
  const matrix = buildOperationAuthorizationMatrix(api);

  // when
  const booking = buildOperationProbe(matrix.find((entry) => entry.operationId === "cancelBooking"));
  const allocations = buildOperationProbe(matrix.find((entry) => entry.operationId === "listAllocations"));
  const create = buildOperationProbe(matrix.find((entry) => entry.operationId === "createBooking"));
  const upload = buildOperationProbe(matrix.find((entry) => entry.operationId === "createImportPreview"));

  // then
  assert.equal(booking.path, "/api/bookings/00000000-0000-0000-0000-000000000000");
  assert.equal(allocations.path, "/api/bookings?date=2026-01-15");
  assert.equal(create.headers["content-type"], "application/json");
  assert.equal(create.headers["idempotency-key"], "security-authorization-probe");
  assert.equal(create.body, "{}");
  assert.match(upload.headers["content-type"], /^multipart\/form-data; boundary=/);
  assert.match(upload.body, /name="file"; filename="empty.csv"/);
});

test("given authorization evidence, when one operation actor pair is absent, then validation fails closed", () => {
  // given
  const matrix = buildOperationAuthorizationMatrix({ paths: {
    "/api/public/example": { get: { operationId: "readExample", security: [] } }
  } });
  const results = authorizationActors.map((actor) => ({
    operationId: "readExample", actor, expected: "allow", status: 200, outcome: "passed",
    observation: "authorization-gate-passed"
  }));
  const objectChecks = ["horizontal-booking-cancel", "horizontal-managed-detail", "horizontal-series-cancel",
    "identifier-substitution", "vertical-admin-management", "mass-assignment", "rejected-attacks-preserve-bookings"]
    .map((id) => ({ id, status: 200, outcome: "passed", observation: "boundary-proven" }));
  const bruteForce = { outcome: "passed", attemptsBeforeLimit: 20, status: 429,
    problemType: "urn:courtside:error:login-rate-limited",
    observation: "encoded-and-canonical-login-share-rate-limit" };
  const identityChecks = ["MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER",
    "TREASURER", "ADMIN"].map((actor) => ({ actor, sessionStatus: 200,
    adminStatus: actor === "ADMIN" ? 200 : 403, outcome: "passed",
    observation: "independent-identity-boundary-proven" }));
  identityChecks.push(...[1, 2].map((index) => ({ actor: `MANAGER_COMBINATION_${index}`,
    sessionStatus: 200, managedStatus: 200, adminStatus: 403, outcome: "passed",
    observation: "independent-identity-boundary-proven" })));

  // when / then
  assert.doesNotThrow(() => validateAuthorizationEvidence({
    schemaVersion: 1, testIds: ["CSA-AUTHN-001", "CSA-AUTHZ-001"], targetFingerprint: `sha256:${"a".repeat(64)}`,
    results, identityChecks, objectChecks, boundaryChecks: [], timing: { outcome: "passed", samplesPerClass: 12,
      medianKnownMilliseconds: 20, medianUnknownMilliseconds: 21, medianRelativeDifference: 0.05 },
    bruteForce, requestCount: 100, outcome: "passed"
  }, matrix));
  assert.throws(() => validateAuthorizationEvidence({
    schemaVersion: 1, testIds: ["CSA-AUTHN-001", "CSA-AUTHZ-001"], targetFingerprint: `sha256:${"a".repeat(64)}`,
    results: results.slice(1), identityChecks, objectChecks, boundaryChecks: [], timing: { outcome: "passed", samplesPerClass: 12,
      medianKnownMilliseconds: 20, medianUnknownMilliseconds: 21, medianRelativeDifference: 0.05 },
    bruteForce, requestCount: 100, outcome: "passed"
  }, matrix), /operation and actor/);
});

test("given paired login samples, when comparing medians, then account timing remains bounded", () => {
  // given
  const known = [100, 101, 99, 102, 98, 100, 103, 97, 101, 99, 102, 98];
  const unknown = [103, 98, 102, 99, 101, 97, 104, 100, 98, 102, 99, 101];

  // when
  const result = evaluateLoginTiming(known, unknown);

  // then
  assert.equal(result.outcome, "passed");
  assert.equal(result.samplesPerClass, 12);
  assert.equal(evaluateLoginTiming(known, unknown.map((sample) => sample * 3)).outcome, "failed");
  assert.throws(() => evaluateLoginTiming(known.slice(1), unknown.slice(1)), /twelve positive paired/);
});
