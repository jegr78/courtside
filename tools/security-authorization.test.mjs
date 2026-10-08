import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  executeAuthorizationProbe,
  rosterListingProbe,
  authorizationActors,
  buildOperationAuthorizationMatrix,
  buildOperationProbe,
  evaluateOperationResult,
  executeMutationBoundaryChecks,
  evaluateLoginTiming,
  loginTimingSampleOrder,
  executeObjectAuthorizationChecks,
  executeOperationMatrix,
  operationMatrixHooks,
  reauthenticateActor,
  recentProofKeeper,
  recentProofRenewalMilliseconds,
  SecurityCookieJar,
  authorizationRequest,
  deriveAuthorizationOutcome,
  executeSecondaryIdentityChecks,
  sendPacedByAdmission,
  validateAuthorizationEvidence
} from "./security-authorization.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const api = yaml.load(readFileSync(new URL("../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));

test("given the OpenAPI contract, when generating authorization cases, then every operation covers every actor", () => {
  // when
  const matrix = buildOperationAuthorizationMatrix(api);

  // then
  assert.equal(matrix.length, 122);
  assert.equal(new Set(matrix.map((entry) => entry.operationId)).size, 122);
  assert.deepEqual(Object.keys(matrix[0].expectations).toSorted(), [...authorizationActors].toSorted());
  assert.ok(matrix.every((entry) => Object.keys(entry.expectations).length === authorizationActors.length));
  assert.deepEqual(matrix.find((entry) => entry.operationId === "getBookingEligibility").expectations, {
    ANONYMOUS: "deny-unauthenticated",
    MEMBER: "allow",
    TRAINER: "allow",
    SPORT_DIRECTOR: "allow",
    YOUTH_DIRECTOR: "allow",
    GROUNDSKEEPER: "allow",
    TREASURER: "allow",
    ADMIN: "allow",
    INITIAL_PASSWORD: "deny-forbidden"
  });
  assert.deepEqual(matrix.find((entry) => entry.operationId === "facilityUtilisation").expectations, {
    ANONYMOUS: "deny-unauthenticated",
    MEMBER: "deny-forbidden",
    TRAINER: "deny-forbidden",
    SPORT_DIRECTOR: "deny-forbidden",
    YOUTH_DIRECTOR: "deny-forbidden",
    GROUNDSKEEPER: "deny-forbidden",
    TREASURER: "deny-forbidden",
    ADMIN: "allow",
    INITIAL_PASSWORD: "deny-forbidden"
  });
  for (const operationId of ["changeOwnPassword", "listOwnSessions",
    "endOwnSessions", "endOwnSession"]) {
    assert.deepEqual(matrix.find((entry) => entry.operationId === operationId).expectations, {
      ANONYMOUS: "deny-unauthenticated",
      MEMBER: "allow",
      TRAINER: "allow",
      SPORT_DIRECTOR: "allow",
      YOUTH_DIRECTOR: "allow",
      GROUNDSKEEPER: "allow",
      TREASURER: "allow",
      ADMIN: "allow",
      INITIAL_PASSWORD: "deny-forbidden"
    });
  }
  assert.deepEqual(matrix.find((entry) => entry.operationId === "reauthenticate").expectations, {
    ANONYMOUS: "deny-unauthenticated",
    MEMBER: "allow",
    TRAINER: "allow",
    SPORT_DIRECTOR: "allow",
    YOUTH_DIRECTOR: "allow",
    GROUNDSKEEPER: "allow",
    TREASURER: "allow",
    ADMIN: "allow",
    INITIAL_PASSWORD: "deny-forbidden"
  });
  for (const operationId of ["endAccountSessions", "endAllSessions"]) {
    const expectations = matrix.find((entry) => entry.operationId === operationId).expectations;
    assert.equal(expectations.ANONYMOUS, "deny-unauthenticated");
    assert.equal(expectations.ADMIN, "allow");
    assert.ok(authorizationActors
      .filter((actor) => !["ANONYMOUS", "ADMIN"].includes(actor))
      .every((actor) => expectations[actor] === "deny-forbidden"));
  }
});

test("given one protected operation admits an anonymous actor, when executing the matrix, then the bypass fails the assessment", async () => {
  // given
  const matrix = buildOperationAuthorizationMatrix({ paths: {
    "/api/admin/utilisation": { get: { operationId: "facilityUtilisation", security: [{}] } }
  } });

  // when
  const results = await executeOperationMatrix(matrix, async (operation, actor) => {
    const expected = operation.expectations[actor];
    if (actor === "ANONYMOUS") return { status: 200 };
    if (expected === "deny-forbidden") {
      return { status: 403, problemType: "urn:courtside:error:access-denied" };
    }
    return { status: 200 };
  });

  // then
  assert.equal(results.find(({ actor }) => actor === "ANONYMOUS").outcome, "failed");
  assert.ok(results.filter(({ actor }) => actor !== "ANONYMOUS")
    .every(({ outcome }) => outcome === "passed"));
});

test("given an actor proven at sign-in, when its cases pass the renewal margin, then it renews once and not before", async () => {
  // given
  let clock = 1_000;
  const renewals = [];
  const proofs = recentProofKeeper(async (actor) => renewals.push({ actor, at: clock }), () => clock);
  proofs.proven("ADMIN");

  // when
  clock += recentProofRenewalMilliseconds - 1;
  await proofs.beforeCase("ADMIN");
  const beforeMargin = renewals.length;
  clock += 1;
  await proofs.beforeCase("ADMIN");
  clock += 1;
  await proofs.beforeCase("ADMIN");

  // then
  assert.equal(beforeMargin, 0, "a proof younger than the margin must not be renewed");
  assert.deepEqual(renewals, [{ actor: "ADMIN", at: 1_000 + recentProofRenewalMilliseconds }],
    "a proof at the margin is renewed exactly once, and the renewal counts as the new proof");
  assert.ok(recentProofRenewalMilliseconds < 5 * 60 * 1000,
    "the margin must lie under the application's five-minute reauthentication window");
});

test("given a matrix that runs past the margin, when an administrator reaches a sensitive operation, then its proof is renewed first", async () => {
  // given
  const matrix = buildOperationAuthorizationMatrix({ paths: {
    "/api/admin/utilisation": { get: { operationId: "facilityUtilisation", security: [{ sessionCookie: [] }] } },
    "/api/admin/accounts/{accountId}/sessions": { delete: { operationId: "endAccountSessions",
      security: [{ sessionCookie: [], csrfToken: [] }],
      parameters: [{ name: "accountId", in: "path", required: true, schema: { type: "string", format: "uuid" } }] } }
  } });
  let clock = 0;
  const events = [];
  const clients = Object.fromEntries(authorizationActors.map((actor) => [actor, new SecurityCookieJar()]));
  const proofs = recentProofKeeper(async (actor) => events.push(`renew ${actor}`), () => clock);
  const hooks = operationMatrixHooks({ clients, signIn: async () => {}, proofs, resetLoginAttempts: async () => {} });
  proofs.proven("ADMIN");

  // when
  await executeOperationMatrix(matrix, async (operation, actor) => {
    events.push(`${operation.operationId} ${actor}`);
    clock += recentProofRenewalMilliseconds / 10;
    return operation.expectations[actor] === "allow" ? { status: 204 }
      : actor === "ANONYMOUS" ? { status: 401, problemType: "urn:courtside:error:unauthenticated" }
        : { status: 403, problemType: "urn:courtside:error:access-denied" };
  }, hooks.beforeOperation, hooks.beforeCase);

  // then
  const renewal = events.indexOf("renew ADMIN");
  assert.ok(renewal >= 0, `the administrator's proof must be renewed once the matrix passes the margin, got ${events.join(", ")}`);
  assert.equal(events[renewal + 1], "endAccountSessions ADMIN",
    "the renewal comes directly before the administrator's case, so the sensitive operation sees a fresh proof");
});

test("given an actor that never signed in, when its cases run past the margin, then nothing renews it", async () => {
  // given
  let clock = 0;
  const renewals = [];
  const proofs = recentProofKeeper(async (actor) => renewals.push(actor), () => clock);

  // when
  clock += 2 * recentProofRenewalMilliseconds;
  await proofs.beforeCase("ANONYMOUS");

  // then
  assert.deepEqual(renewals, [], "an anonymous or unproven actor has no proof to renew");
});

test("given a signed-in actor, when its proof is renewed, then it proves the password again with CSRF on its current client", async () => {
  // given
  const replaced = new SecurityCookieJar();
  const clients = { ADMIN: new SecurityCookieJar() };
  const requests = [];
  const request = async (client, probe, options) => {
    requests.push({ client, probe, options });
    return { status: 204 };
  };
  const renew = reauthenticateActor(request, clients, "example-password");

  // when
  clients.ADMIN = replaced;
  await renew("ADMIN");

  // then
  assert.equal(requests.length, 1);
  assert.equal(requests[0].client, replaced, "the renewal must use the actor's current client, which carries the replacement cookie");
  assert.deepEqual(requests[0].probe, { method: "POST", path: "/api/session/reauthentication",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "example-password" }) });
  assert.deepEqual(requests[0].options, { csrf: true }, "the reauthentication is a mutation and needs the CSRF token");
});

test("given a refused reauthentication, when an actor's proof is renewed, then the assessment stops with the status", async () => {
  // given
  const renew = reauthenticateActor(async () => ({ status: 401 }), { ADMIN: new SecurityCookieJar() }, "example-password");

  // when / then
  await assert.rejects(renew("ADMIN"), /Synthetic ADMIN reauthentication failed with 401/,
    "a renewal that does not succeed must not let the matrix measure a stale proof");
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
    if (probe.path === `/api/admin/roster/${personId}` && probe.method === "PUT") {
      return { status: 400, problemType: "urn:courtside:error:validation-failed" };
    }
    if (actor === "ADMIN") return { status: 200 };
    if (probe.path.includes("00000000-0000-0000-0000-000000000000")) {
      return { status: 404, problemType: "urn:courtside:error:booking-not-found" };
    }
    return { status: 404, problemType: "urn:courtside:error:booking-not-found" };
  }, (limit) => ({ method: "GET", path: `/api/admin/roster?limit=${limit}`, headers: {} }));

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
  jar.update(["__Host-SESSION=first; Path=/; Secure; HttpOnly", "__Host-XSRF-TOKEN=one%20two; Path=/; Secure"]);
  jar.update(["__Host-SESSION=second; Path=/; Secure; HttpOnly"]);

  // then
  assert.equal(jar.header(), "__Host-SESSION=second; __Host-XSRF-TOKEN=one%20two");
  assert.equal(jar.csrfToken(), "one two");
  jar.update(["__Host-SESSION=; Max-Age=0; Path=/"]);
  assert.equal(jar.header(), "__Host-XSRF-TOKEN=one%20two");
});

test("given an anonymous client without a CSRF token, when probing a protected mutation, then bootstrap through the budgeted sender first", async () => {
  // given
  const jar = new SecurityCookieJar();
  const calls = [];
  const probe = { method: "POST", path: "/api/session", headers: { host: "untrusted.example" } };
  const send = async (client, request, options = {}) => {
    calls.push({ request, options });
    if (request.method === "GET") client.update(["__Host-XSRF-TOKEN=fresh; Path=/; Secure"]);
    else assert.equal(client.csrfToken(), "fresh");
    return { status: request.method === "GET" ? 401 : 421 };
  };
  // when
  const result = await executeAuthorizationProbe(send, jar, probe, { csrf: true });
  // then
  assert.equal(result.status, 421);
  assert.deepEqual(calls[0], { request: { method: "GET", path: "/api/session", headers: {} }, options: {} });
  assert.equal(calls[1].request, probe);
  assert.deepEqual(calls[1].options, { csrf: true });
  assert.equal(calls.length, 2);
});

test("given a missing-CSRF boundary probe, when sending it, then do not bootstrap or inject a token", async () => {
  // given
  const jar = new SecurityCookieJar();
  const calls = [];
  const probe = { method: "POST", path: "/api/session", headers: {} };
  // when
  await executeAuthorizationProbe(async (...args) => { calls.push(args); }, jar, probe, { csrf: false });
  // then
  assert.equal(calls.length, 1);
  assert.equal(jar.csrfToken(), undefined);
  assert.equal(calls[0][1], probe);
});

test("given a bootstrap without a host-bound token, when probing a protected mutation, then fail before the mutation", async () => {
  // given
  const jar = new SecurityCookieJar();
  let requests = 0;
  // when / then
  await assert.rejects(executeAuthorizationProbe(async () => { requests++; }, jar,
    { method: "POST", path: "/api/session", headers: {} }, { csrf: true }), /CSRF token/);
  assert.equal(requests, 1);
});

test("given a current host-bound token, when probing a protected mutation, then preserve the token and avoid a redundant bootstrap", async () => {
  // given
  const jar = new SecurityCookieJar();
  jar.update(["__Host-XSRF-TOKEN=current; Path=/; Secure"]);
  const requests = [];
  const probe = { method: "POST", path: "/api/session", headers: {} };
  // when
  await executeAuthorizationProbe(async (client, request) => { requests.push(request); }, jar, probe, { csrf: true });
  // then
  assert.deepEqual(requests, [probe]);
  assert.equal(jar.csrfToken(), "current");
});

test("given an exhausted request budget during CSRF bootstrap, when probing a mutation, then the mutation never runs", async () => {
  // given
  let requests = 0;
  // when / then
  await assert.rejects(executeAuthorizationProbe(async () => { requests++; throw new Error("Request budget exceeded"); },
    new SecurityCookieJar(), { method: "POST", path: "/api/session", headers: {} }, { csrf: true }), /Request budget exceeded/);
  assert.equal(requests, 1);
});

test("given host and legacy CSRF cookies, when reading the token, then the host-bound value wins", () => {
  // given
  const hostOnly = new SecurityCookieJar();
  hostOnly.update(["__Host-XSRF-TOKEN=host%20only; Path=/; Secure"]);
  const legacyOnly = new SecurityCookieJar();
  legacyOnly.update(["XSRF-TOKEN=legacy-only; Path=/; Secure"]);
  const collision = new SecurityCookieJar();
  collision.update([
    "XSRF-TOKEN=planted-legacy; Path=/; Secure",
    "__Host-XSRF-TOKEN=trusted-host; Path=/; Secure"
  ]);

  // when / then
  assert.equal(hostOnly.csrfToken(), "host only");
  assert.equal(legacyOnly.csrfToken(), undefined);
  assert.equal(collision.csrfToken(), "trusted-host");
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

test("given session-ending operations, when executing the matrix, then their side effects cannot poison later cases",
  async () => {
  // given
  const matrix = buildOperationAuthorizationMatrix({ paths: {
    "/api/session/logout": { post: { operationId: "logOut" } },
    "/api/account/sessions": { delete: { operationId: "endOwnSessions", security: [{}] } },
    "/api/admin/sessions": { delete: { operationId: "endAllSessions", security: [{}] } },
    "/api/public/example": { get: { operationId: "readExample", security: [] } }
  } });
  const calls = [];
  const prepared = [];
  let activeActors = new Set(authorizationActors.filter((actor) => actor !== "ANONYMOUS"));

  // when
  const results = await executeOperationMatrix(matrix, async (operation, actor) => {
    calls.push(`${operation.operationId}:${actor}`);
    const expectation = operation.expectations[actor];
    if (["endOwnSessions", "endAllSessions"].includes(operation.operationId)
        && actor !== "ANONYMOUS" && !activeActors.has(actor)) {
      return { status: 401, problemType: "urn:courtside:error:unauthenticated" };
    }
    if (expectation === "deny-unauthenticated") {
      return { status: 401, problemType: "urn:courtside:error:unauthenticated" };
    }
    if (expectation === "deny-forbidden") {
      return { status: 403, problemType: "urn:courtside:error:access-denied" };
    }
    if (operation.operationId === "endOwnSessions" && actor !== "ANONYMOUS") activeActors.delete(actor);
    if (operation.operationId === "endAllSessions" && actor === "ADMIN") activeActors.clear();
    return { status: 200 };
  }, async (operation) => {
    if (["endOwnSessions", "endAllSessions", "logOut"].includes(operation.operationId)) {
      prepared.push(operation.operationId);
      activeActors = new Set(authorizationActors.filter((actor) => actor !== "ANONYMOUS"));
    }
  });

  // then
  assert.equal(results.length, matrix.length * authorizationActors.length);
  assert.equal(new Set(calls).size, calls.length);
  assert.deepEqual(prepared, ["endOwnSessions", "endAllSessions", "logOut"]);
  assert.deepEqual(calls.slice(-2 * authorizationActors.length, -authorizationActors.length),
    authorizationActors.filter((actor) => actor !== "ADMIN")
      .map((actor) => `endAllSessions:${actor}`).concat("endAllSessions:ADMIN"));
  assert.ok(calls.slice(-authorizationActors.length).every((call) => call.startsWith("logOut:")));
  assert.ok(results.every((result) => result.outcome === "passed"));
  });

test("given credential-proof operations, when executing the matrix, then every actor has an isolated rate budget",
  async () => {
  // given
  const matrix = buildOperationAuthorizationMatrix({ paths: {
    "/api/session/reauthentication": { post: { operationId: "reauthenticate", security: [{}] } }
  } });
  let attempts = 0;
  const resets = [];

  // when
  const results = await executeOperationMatrix(matrix, async (operation, actor) => {
    attempts += 1;
    if (attempts > 1) {
      return { status: 429, problemType: "urn:courtside:error:password-verification-rate-limited" };
    }
    const expectation = operation.expectations[actor];
    if (expectation === "deny-unauthenticated") {
      return { status: 401, problemType: "urn:courtside:error:unauthenticated" };
    }
    if (expectation === "deny-forbidden") {
      return { status: 403, problemType: "urn:courtside:error:access-denied" };
    }
    return { status: 400 };
  }, undefined, async (operation, actor) => {
    resets.push(`${operation.operationId}:${actor}`);
    attempts = 0;
  });

  // then
  assert.deepEqual(resets, authorizationActors.map((actor) => `reauthenticate:${actor}`));
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

// The producer decides which object boundaries exist; a list repeated here would only ever be as
// current as the last person to edit both of them.
async function producedObjectCheckIds() {
  const personId = "30000000-0000-0000-0000-000000000001";
  const bookings = { items: [
    { id: "10000000-0000-0000-0000-000000000001", seriesId: null, status: "CONFIRMED" },
    { id: "10000000-0000-0000-0000-000000000002",
      seriesId: "20000000-0000-0000-0000-000000000001", status: "CONFIRMED" }
  ] };
  const roster = { entries: [{ personId, username: "security.member.1", firstName: "Security",
    lastName: "Member1", email: "security.member.1@example.org", enabled: true, roles: ["MEMBER"],
    accountId: "40000000-0000-0000-0000-000000000001",
    membershipTypeId: "50000000-0000-0000-0000-000000000001" }] };
  const checks = await executeObjectAuthorizationChecks(async (actor, probe) => {
    if (probe.path === "/api/my/bookings?limit=100") return { status: 200, json: bookings };
    if (probe.path === "/api/admin/roster?limit=200" && probe.method === "GET") {
      return { status: 200, json: roster };
    }
    if (probe.path === `/api/admin/roster/${personId}` && probe.method === "PUT") {
      return { status: 400, problemType: "urn:courtside:error:validation-failed" };
    }
    if (actor === "ADMIN") return { status: 200 };
    return { status: 404, problemType: "urn:courtside:error:booking-not-found" };
  }, (limit) => ({ method: "GET", path: `/api/admin/roster?limit=${limit}`, headers: {} }));
  return checks.map(({ id }) => id);
}

test("given authorization evidence, when one operation actor pair is absent, then validation fails closed", async () => {
  // given
  const matrix = buildOperationAuthorizationMatrix({ paths: {
    "/api/public/example": { get: { operationId: "readExample", security: [] } }
  } });
  const results = authorizationActors.map((actor) => ({
    operationId: "readExample", actor, expected: "allow", status: 200, outcome: "passed",
    observation: "authorization-gate-passed"
  }));
  const objectChecks = (await producedObjectCheckIds())
    .map((id) => ({ id, status: 200, outcome: "passed", observation: "boundary-proven" }));
  const bruteForce = { outcome: "passed", attemptsBeforeLimit: 5, status: 429,
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
    specificationDigest: `sha256:${"b".repeat(64)}`,
    results, identityChecks, objectChecks, boundaryChecks: [], timing: { outcome: "passed", samplesPerClass: 12,
      medianKnownMilliseconds: 20, medianUnknownMilliseconds: 21, medianRelativeDifference: 0.05 },
    bruteForce, requestCount: 100, outcome: "passed"
  }, matrix));
  assert.throws(() => validateAuthorizationEvidence({
    schemaVersion: 1, testIds: ["CSA-AUTHN-001", "CSA-AUTHZ-001"], targetFingerprint: `sha256:${"a".repeat(64)}`,
    specificationDigest: `sha256:${"b".repeat(64)}`,
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

test("given a peer that closes while an oversized body is going out, when a reset is accepted, then the close is an observation", async (t) => {
  // given
  const server = await startSilentlyClosingServer();
  t.after(server.close);

  // when
  const response = await authorizationRequest(server.origin, new SecurityCookieJar(),
    oversizedProbe(), { ca: server.ca, acceptConnectionReset: true });

  // then
  assert.equal(response.transportError, "connection-reset");
});

test("given a peer that closes while an oversized body is going out, when no reset is accepted, then the probe fails", async (t) => {
  // given
  const server = await startSilentlyClosingServer();
  t.after(server.close);

  // when / then
  await assert.rejects(() => authorizationRequest(server.origin, new SecurityCookieJar(),
    oversizedProbe(), { ca: server.ca }), /Authorization POST \/api\/admin\/courts failed/);
});

function oversizedProbe() {
  return { method: "POST", path: "/api/admin/courts", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "x".repeat(32 * 1024 * 1024) }) };
}

async function startSilentlyClosingServer() {
  const directory = mkdtempSync(join(tmpdir(), "courtside-authorization-"));
  const created = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "1",
    "-keyout", "key.pem", "-out", "cert.pem", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost"], { cwd: directory, encoding: "utf8" });
  if (created.status !== 0) throw new Error(`openssl could not create a test certificate: ${created.stderr}`);
  const certificate = readFileSync(join(directory, "cert.pem"));
  const server = createServer({ key: readFileSync(join(directory, "key.pem")), cert: certificate },
    (incoming) => incoming.socket.destroy());
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  return {
    origin: `https://localhost:${server.address().port}`,
    ca: certificate,
    close: () => { server.closeAllConnections(); return new Promise((closed) => server.close(closed)); }
  };
}

test("given a contract that spells the roster listing differently, when the probe is derived, "
  + "then it follows the document rather than a path this tool remembers", () => {
  // given
  const page = { responses: { "200": { content: { "application/json": {
    schema: { $ref: "#/components/schemas/RosterPage" } } } } } };
  const listing = { paths: { "/api/admin/roster": { get: {
    operationId: "listRoster", parameters: [{ name: "limit", in: "query" }], ...page } } } };
  const search = { paths: { "/api/admin/roster-search": { post: {
    operationId: "searchRoster",
    requestBody: { content: { "application/json": { schema: { properties: { limit: {} } } } } },
    ...page } } } };

  // when / then
  assert.deepEqual(rosterListingProbe(listing, 200),
    { method: "GET", path: "/api/admin/roster?limit=200", headers: {} });
  assert.deepEqual(rosterListingProbe(search, 200),
    { method: "POST", path: "/api/admin/roster-search",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 200 }) });
  assert.throws(() => rosterListingProbe({ paths: {} }, 1), /exactly one operation answering a roster page/);
  assert.throws(() => rosterListingProbe({ paths: { "/api/admin/roster/{personId}": { get: {
    operationId: "readPerson", parameters: [{ name: "limit", in: "query" }], ...page } } } }, 1),
  /whose template this probe cannot fill/);
  assert.throws(() => rosterListingProbe({ paths: { "/api/public/roster": { get: {
    operationId: "publicRoster", parameters: [{ name: "limit", in: "query" }], ...page } } } }, 1),
  /outside the prefix the checks beside this probe expect/);
  assert.throws(() => rosterListingProbe({ paths: { "/api/admin/roster": { get: {
    operationId: "listRoster", ...page } } } }, 1), /declares no limit/);
});

const rateLimited = { status: 429, problemType: "urn:courtside:error:request-rate-limited", retryAfterSeconds: 1 };

test("given an admission refusal, when evaluating any expectation, then the case is incomplete and never passed", () => {
  // given
  const capacity = { status: 429, problemType: "urn:courtside:error:operation-capacity-exhausted", retryAfterSeconds: 1 };

  // when / then
  for (const expected of ["allow", "deny-forbidden", "deny-unauthenticated"]) {
    for (const refusal of [rateLimited, capacity]) {
      assert.deepEqual(evaluateOperationResult(expected, refusal),
        { outcome: "incomplete", observation: "admission-refused" },
        `an admission refusal of a ${expected} case must not be read as its authorization answer`);
    }
  }
  assert.equal(evaluateOperationResult("deny-forbidden", { status: 429 }).outcome, "failed",
    "a 429 without an admission problem type is not an admission refusal");
});

test("given typed admission refusals, when sending through the paced sender, then it honours Retry-After at most twice", async () => {
  // given
  const answers = [rateLimited, { ...rateLimited, retryAfterSeconds: 2 }, rateLimited, { status: 200 }];
  const waits = [];
  let sent = 0;

  // when
  const response = await sendPacedByAdmission(async () => answers[sent++], async (milliseconds) => {
    waits.push(milliseconds);
  });

  // then
  assert.equal(sent, 3, "the first send and two retries are the bound");
  assert.deepEqual(waits, [1000, 2000], "each retry waits for the Retry-After the refusal named");
  assert.equal(response.problemType, "urn:courtside:error:request-rate-limited",
    "a refusal that survives both retries is returned as the observation");
});

test("given refusals the pacer must not wait for, when sending, then it returns them without a retry", async () => {
  // given
  const cases = [
    { status: 429, retryAfterSeconds: 1 },
    { status: 429, problemType: "urn:courtside:error:login-rate-limited", retryAfterSeconds: 1 },
    { ...rateLimited, retryAfterSeconds: 6 },
    { status: 429, problemType: "urn:courtside:error:request-rate-limited" }
  ];

  for (const answer of cases) {
    let sent = 0;
    const waits = [];

    // when
    const response = await sendPacedByAdmission(async () => { sent++; return answer; },
      async (milliseconds) => { waits.push(milliseconds); });

    // then
    assert.equal(sent, 1, `${JSON.stringify(answer)} must not be retried`);
    assert.deepEqual(waits, []);
    assert.equal(response, answer);
  }
});

test("given a target that refuses with Retry-After, when probing it, then the response carries the advertised delay", async (t) => {
  // given
  const server = await startAnsweringServer((incoming, outgoing) => {
    outgoing.writeHead(429, { "content-type": "application/problem+json", "retry-after": "3" });
    outgoing.end(JSON.stringify({ type: "urn:courtside:error:request-rate-limited", status: 429 }));
  });
  t.after(server.close);

  // when
  const response = await authorizationRequest(server.origin, new SecurityCookieJar(),
    { method: "GET", path: "/api/my/bookings", headers: {} }, { ca: server.ca });

  // then
  assert.equal(response.retryAfterSeconds, 3);
  assert.equal(response.problemType, "urn:courtside:error:request-rate-limited");
});

test("given an admission refusal inside an object attack, when checking object boundaries, then no check that saw it passes", async () => {
  // given
  const standaloneId = "10000000-0000-0000-0000-000000000001";
  const personId = "30000000-0000-0000-0000-000000000001";
  const bookings = { items: [
    { id: standaloneId, seriesId: null, status: "CONFIRMED" },
    { id: "10000000-0000-0000-0000-000000000002", seriesId: "20000000-0000-0000-0000-000000000001",
      status: "CONFIRMED" }
  ] };
  const roster = { entries: [{ personId, username: "security.member.1", firstName: "Jane",
    lastName: "Doe", email: "jane.doe@example.org", enabled: true, roles: ["MEMBER"],
    accountId: "40000000-0000-0000-0000-000000000001", membershipTypeId: null }] };
  let rosterReads = 0;

  // when
  const checks = await executeObjectAuthorizationChecks(async (actor, probe) => {
    if (probe.path === "/api/my/bookings?limit=100") return { status: 200, json: bookings };
    if (probe.path.startsWith("/api/admin/roster?") && rosterReads++ === 0) return { status: 200, json: roster };
    if (probe.path.startsWith("/api/admin/roster?")) return rateLimited;
    if (probe.method === "PUT") return { status: 400, problemType: "urn:courtside:error:validation-failed" };
    if (probe.path === `/api/managed/bookings/${standaloneId}` && actor === "MEMBER_NON_OWNER") return rateLimited;
    if (actor === "ADMIN") return { status: 200 };
    return { status: 404, problemType: "urn:courtside:error:booking-not-found" };
  }, (limit) => ({ method: "GET", path: `/api/admin/roster?limit=${limit}`, headers: {} }));

  // then
  const check = (id) => checks.find((candidate) => candidate.id === id);
  for (const id of ["horizontal-managed-detail", "existence-not-disclosed", "mass-assignment"]) {
    assert.equal(check(id).outcome, "incomplete", `${id} saw an admission refusal and cannot be proven`);
    assert.equal(check(id).observation, "admission-refused");
  }
  assert.equal(check("horizontal-booking-cancel").outcome, "passed",
    "a check that never met a refusal keeps its own answer");
});

test("given admission refusals during identity checks, when executing them, then the identity is incomplete", async () => {
  // given
  const send = async (client, probe) => {
    if (probe.method === "POST") return { status: 200 };
    if (probe.path === "/api/session" && client.signedIn) return rateLimited;
    if (probe.path === "/api/session") {
      client.signedIn = true;
      client.update(["__Host-XSRF-TOKEN=token"]);
      return { status: 200 };
    }
    return { status: 403, problemType: "urn:courtside:error:access-denied" };
  };

  // when
  const checks = await executeSecondaryIdentityChecks(send, "secret", async () => {},
    () => ({ method: "GET", path: "/api/admin/roster?limit=1", headers: {} }));

  // then
  assert.equal(checks.length, 9);
  for (const check of checks) {
    assert.equal(check.outcome, "incomplete", `${check.actor} was refused before its boundary answered`);
    assert.equal(check.observation, "admission-refused");
  }
});

test("given authorization evidence with admission refusals, when validating it, then incomplete is the only consistent outcome", async () => {
  // given
  const matrix = buildOperationAuthorizationMatrix({ paths: {
    "/api/public/example": { get: { operationId: "readExample", security: [] } }
  } });
  const evidence = await minimalEvidence();
  evidence.results[0] = { ...evidence.results[0], status: 429,
    problemType: "urn:courtside:error:request-rate-limited", outcome: "incomplete", observation: "admission-refused" };
  evidence.identityChecks[0] = { ...evidence.identityChecks[0], sessionStatus: 429, outcome: "incomplete",
    observation: "admission-refused" };

  // when / then
  assert.equal(deriveAuthorizationOutcome([...evidence.results, ...evidence.identityChecks]), "incomplete");
  assert.doesNotThrow(() => validateAuthorizationEvidence({ ...evidence, outcome: "incomplete" }, matrix));
  assert.throws(() => validateAuthorizationEvidence({ ...evidence, outcome: "passed" }, matrix),
    /outcome is inconsistent/, "evidence with a refused case must not claim to have passed");
  evidence.identityChecks[0] = { ...evidence.identityChecks[0], sessionStatus: 200 };
  assert.throws(() => validateAuthorizationEvidence({ ...evidence, outcome: "incomplete" }, matrix),
    /independent identity/, "an incomplete identity needs a refusal status behind it");
});

async function minimalEvidence() {
  const results = authorizationActors.map((actor) => ({
    operationId: "readExample", actor, expected: "allow", status: 200, outcome: "passed",
    observation: "authorization-gate-passed"
  }));
  const identityChecks = ["MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER",
    "TREASURER", "ADMIN"].map((actor) => ({ actor, sessionStatus: 200,
    adminStatus: actor === "ADMIN" ? 200 : 403, outcome: "passed",
    observation: "independent-identity-boundary-proven" }));
  identityChecks.push(...[1, 2].map((index) => ({ actor: `MANAGER_COMBINATION_${index}`,
    sessionStatus: 200, managedStatus: 200, adminStatus: 403, outcome: "passed",
    observation: "independent-identity-boundary-proven" })));
  return {
    schemaVersion: 1, testIds: ["CSA-AUTHN-001", "CSA-AUTHZ-001"], targetFingerprint: `sha256:${"a".repeat(64)}`,
    specificationDigest: `sha256:${"b".repeat(64)}`, results, identityChecks,
    objectChecks: (await producedObjectCheckIds())
      .map((id) => ({ id, status: 200, outcome: "passed", observation: "boundary-proven" })),
    boundaryChecks: [],
    timing: { outcome: "passed", samplesPerClass: 12, medianKnownMilliseconds: 20, medianUnknownMilliseconds: 21,
      medianRelativeDifference: 0.05 },
    bruteForce: { outcome: "passed", attemptsBeforeLimit: 20, status: 429,
      problemType: "urn:courtside:error:login-rate-limited",
      observation: "encoded-and-canonical-login-share-rate-limit" },
    requestCount: 100, outcome: "passed"
  };
}

async function startAnsweringServer(answer) {
  const directory = mkdtempSync(join(tmpdir(), "courtside-authorization-"));
  const created = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "1",
    "-keyout", "key.pem", "-out", "cert.pem", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost"], { cwd: directory, encoding: "utf8" });
  if (created.status !== 0) throw new Error(`openssl could not create a test certificate: ${created.stderr}`);
  const certificate = readFileSync(join(directory, "cert.pem"));
  const server = createServer({ key: readFileSync(join(directory, "key.pem")), cert: certificate }, answer);
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  return {
    origin: `https://localhost:${server.address().port}`,
    ca: certificate,
    close: () => { server.closeAllConnections(); return new Promise((closed) => server.close(closed)); }
  };
}
