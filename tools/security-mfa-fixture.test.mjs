import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { test } from "node:test";
import { createMfaFixture, createWebauthnAuthenticator, mfaFixtureFirstAttemptRequests, mfaFixtureMaxRequestsPerExercise, mfaFixtureRequestLimit, requireMfaSuccess, totpCode } from "./security-mfa-fixture.mjs";

test("given the RFC6238 secret, when calculating the first reference timestep, then produce its six digit SHA1 code", () => {
  // given
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  // when / then
  assert.equal(totpCode(secret, 59_000), "287082");
  assert.equal(totpCode(secret, 89_000, -1), "287082");
  assert.throws(() => totpCode("INVALID!", 59_000));
});

test("given a virtual fixture authenticator, when registering and asserting, then bind the UV signature to the challenge origin RP and increasing counter", () => {
  // given
  const authenticator = createWebauthnAuthenticator("https://courtside.example");
  const options = { rp: { id: "courtside.example", name: "Example" }, user: { id: "AQI", name: "jane.doe" }, challenge: "AwQ", pubKeyCredParams: [{ type: "public-key", alg: -7 }] };
  // when
  const registration = authenticator.register(options);
  const assertion = authenticator.assertion({ rpId: options.rp.id, challenge: "BQY", allowCredentials: [{ id: registration.id, type: "public-key" }] });
  const data = Buffer.from(assertion.response.authenticatorData, "base64url");
  const client = Buffer.from(assertion.response.clientDataJSON, "base64url");
  const signed = Buffer.concat([data, crypto.createHash("sha256").update(client).digest()]);
  // then
  assert.deepEqual(JSON.parse(client), { type: "webauthn.get", challenge: "BQY", origin: "https://courtside.example", crossOrigin: false });
  assert.equal(data[32], 5);
  assert.equal(data.readUInt32BE(33), 1);
  assert.deepEqual(data.subarray(0, 32), crypto.createHash("sha256").update("courtside.example").digest());
  assert.equal(crypto.verify("sha256", signed, authenticator.publicKey, Buffer.from(assertion.response.signature, "base64url")), true);
  const tampered = Buffer.from(signed); tampered[32] ^= 4;
  assert.equal(crypto.verify("sha256", tampered, authenticator.publicKey, Buffer.from(assertion.response.signature, "base64url")), false);
  const second = authenticator.assertion({ rpId: options.rp.id, challenge: "Bwg", allowCredentials: [{ id: registration.id, type: "public-key" }] });
  assert.equal(Buffer.from(second.response.authenticatorData, "base64url").readUInt32BE(33), 2);
  assert.equal(JSON.stringify(authenticator).includes("PRIVATE"), false);
  const attestation = decodeCbor(Buffer.from(registration.response.attestationObject, "base64url"));
  assert.equal(attestation.get("fmt"), "none");
  assert.equal(attestation.get("attStmt").size, 0);
  const attested = attestation.get("authData");
  assert.equal(attested[32], 69);
  const idLength = attested.readUInt16BE(53);
  assert.deepEqual(attested.subarray(55, 55 + idLength), Buffer.from(registration.rawId, "base64url"));
  const cose = decodeCbor(attested.subarray(55 + idLength));
  assert.equal(cose.get(1), 2);
  assert.equal(cose.get(3), -7);
  assert.equal(cose.get(-1), 1);
  const publicJwk = authenticator.publicKey.export({ format: "jwk" });
  assert.equal(cose.get(-2).toString("base64url"), publicJwk.x);
  assert.equal(cose.get(-3).toString("base64url"), publicJwk.y);
});

test("given another origin or credential, when asking the fixture to sign, then refuse the mismatched ceremony", () => {
  // given
  const authenticator = createWebauthnAuthenticator("https://courtside.example");
  // when / then
  assert.throws(() => authenticator.assertion({ rpId: "courtside.example", challenge: "AQ" }));
  assert.throws(() => authenticator.register({ rp: { id: "attacker.example" }, user: { id: "AQ" }, challenge: "Ag", pubKeyCredParams: [{ alg: -7 }] }));
  authenticator.register({ rp: { id: "courtside.example" }, user: { id: "AQ" }, challenge: "Ag", pubKeyCredParams: [{ alg: -7 }] });
  assert.throws(() => authenticator.assertion({ rpId: "attacker.example", challenge: "AQ" }));
  assert.throws(() => authenticator.assertion({ rpId: "courtside.example", challenge: "AQ", allowCredentials: [{ id: "other" }] }));
});

test("given generic errors and redirects, when evaluating a positive MFA proof, then accept only successful responses", () => {
  // given
  const statuses = [200, 202, 204, 302, 400, 401, 403, 404, 409, 429, 500];
  // when / then
  for (const status of statuses) {
    if (status >= 200 && status < 300) assert.equal(requireMfaSuccess({ status }, "fixture").status, status);
    else assert.throws(() => requireMfaSuccess({ status }, "fixture"));
  }
  assert.throws(() => requireMfaSuccess({ status: 200, problemType: "urn:unexpected" }, "fixture"));
});

test("given a normal denied actor, when exercising an MFA operation, then keep its original client and refusal", async () => {
  // given
  const anonymous = {};
  const sent = [];
  const fixture = createMfaFixture({ beginMailScope: async () => async () => {}, request: async (...args) => { sent.push(args); return { status: 401 }; }, makeClient: () => ({}), clients: { ANONYMOUS: anonymous }, sharedPassword: "fixture-original-password", origin: "https://courtside.example" });
  // when
  const response = await fixture.exercise({ operationId: "disableOwnMfa", mutation: true, expectations: { ANONYMOUS: "deny-unauthenticated" } }, "ANONYMOUS", { method: "DELETE", path: "/api/account/mfa", headers: {} });
  // then
  assert.equal(response.status, 401);
  assert.equal(sent[0][0], anonymous);
  assert.equal(sent.length, 1);
});

function decodeCbor(buffer) {
  let position = 0;
  function next() {
    const initial = buffer[position++];
    const major = initial >> 5;
    const additional = initial & 31;
    let length = additional;
    if (additional === 24) length = buffer[position++];
    else if (additional === 25) { length = buffer.readUInt16BE(position); position += 2; }
    else if (additional > 25) throw new Error("Unexpected fixture CBOR length");
    if (major === 0) return length;
    if (major === 1) return -1 - length;
    if (major === 2 || major === 3) { const value = buffer.subarray(position, position + length); position += length; return major === 2 ? value : value.toString(); }
    if (major === 5) { const result = new Map(); for (let index = 0; index < length; index++) result.set(next(), next()); return result; }
    throw new Error("Unexpected fixture CBOR type");
  }
  const result = next();
  assert.equal(position, buffer.length);
  return result;
}

const logicalRequestCounts = {
  getOwnMfaStatus: 12, disableOwnMfa: 18, beginTotpEnrollment: 12, confirmTotpEnrollment: 14,
  removeOwnTotp: 18, replaceOwnRecoveryCodes: 19, beginWebauthnEnrollment: 12,
  confirmWebauthnEnrollment: 14, removeOwnWebauthnCredential: 18, renameOwnWebauthnCredential: 19,
  beginWebauthnReauthentication: 19, beginWebauthnLogin: 21, completeWebauthnLogin: 22,
  completeMfaLogin: 21, getAdministrativeMfaStatus: 31, initiateMfaRecovery: 43, redeemMfaRecovery: 43
};

for (const operationId of ["getOwnMfaStatus", "disableOwnMfa", "beginTotpEnrollment", "confirmTotpEnrollment", "removeOwnTotp", "replaceOwnRecoveryCodes", "beginWebauthnEnrollment", "confirmWebauthnEnrollment", "removeOwnWebauthnCredential", "renameOwnWebauthnCredential", "beginWebauthnReauthentication", "beginWebauthnLogin", "completeWebauthnLogin", "completeMfaLogin", "getAdministrativeMfaStatus", "initiateMfaRecovery", "redeemMfaRecovery"]) {
  test(`given scripted unit transport for ${operationId}, when its fixture runs, then use a successful proof and restore synthetic accounts`, async () => {
    // given
    const protocol = unitProtocol();
    const fixture = createMfaFixture(protocol.configuration);
    // when
    const response = await fixture.exercise({ operationId, mutation: !operationId.startsWith("get"), expectations: { ADMIN: "allow" } }, "ADMIN", {});
    // then
    assert.ok(response.status >= 200 && response.status < 300);
    for (const account of protocol.accounts.values()) {
      assert.equal(account.password, protocol.configuration.sharedPassword);
      assert.equal(account.enabled, false);
      assert.equal(account.pending, false);
      assert.equal(account.recoveryPending, false);
      assert.equal(account.key, undefined);
    }
    assert.equal(protocol.requests(), logicalRequestCounts[operationId]);
    const bootstrap = ["initiateMfaRecovery", "redeemMfaRecovery"].includes(operationId) ? 1 : 0;
    assert.equal(mfaFixtureFirstAttemptRequests(operationId), protocol.requests() + bootstrap);
    assert.equal(mfaFixtureRequestLimit(operationId), mfaFixtureFirstAttemptRequests(operationId) * 3);
    assert.ok(mfaFixtureRequestLimit(operationId) <= mfaFixtureMaxRequestsPerExercise);
  });
}

function unitProtocol({ sessionRoles } = {}) {
  const original = "Assessment-original-password";
  const accounts = new Map();
  let requests = 0;
  let serial = 0;
  const roles = {
    "security.member.2": "MEMBER", "security.trainer.2": "TRAINER", "security.sport.director.2": "SPORT_DIRECTOR",
    "security.youth.director.2": "YOUTH_DIRECTOR", "security.groundskeeper.2": "GROUNDSKEEPER",
    "security.treasurer.2": "TREASURER", "security.admin.2": "ADMIN"
  };
  const account = (username) => {
    if (!accounts.has(username)) accounts.set(username, { username, id: `account-${accounts.size}`, password: original, enabled: false, pending: false, recoveryPending: false, codes: [], key: undefined });
    return accounts.get(username);
  };
  const ok = (json, status = 200) => ({ status, ...(json === undefined ? {} : { json }) });
  const configuration = {
    makeClient: () => ({}), clients: { ADMIN: { administrator: true } }, sharedPassword: original,
    origin: "https://courtside.example", now: () => 59_000,
    beginMailScope: async () => async () => {},
    readRecoveryCode: async (username, { excludedCodes, after }) => {
      assert.ok(Number.isFinite(after));
      const holder = account(username);
      assert.equal(holder.recoveryPending, true);
      assert.equal(excludedCodes.includes(holder.rescueCode), false);
      return holder.rescueCode;
    },
    request: async (client, probe) => {
      requests += 1;
      const { method, path } = probe;
      const body = probe.body && probe.headers["content-type"] === "application/json" ? JSON.parse(probe.body) : undefined;
      if (method === "POST" && path === "/api/session") {
        const form = new URLSearchParams(probe.body);
        const holder = account(form.get("username"));
        assert.equal(form.get("password"), holder.password);
        assert.equal(holder.recoveryPending, false);
        client.account = holder; client.pending = holder.enabled;
        return ok(undefined, holder.enabled ? 202 : 200);
      }
      if (method === "GET" && path === "/api/session") return ok({ authenticated: Boolean(client.account && !client.pending), username: client.account?.username, roles: client.account && !client.pending ? sessionRoles ?? [roles[client.account.username]] : [] });
      if (method === "POST" && path === "/api/admin/roster-search") {
        const entries = [...accounts.values()]
          .filter((holder) => !body.role || roles[holder.username] === body.role)
          .filter((holder) => !body.query || ("Security " + roles[holder.username] + "2")
            .toLowerCase().includes(body.query.toLowerCase()))
          .map((holder) => ({ accountId: holder.id, username: holder.username }));
        return ok({ entries });
      }
      if (method === "POST" && path === "/api/account-recovery/mfa/redemption") {
        const holder = account(body.username);
        assert.equal(body.code, holder.rescueCode);
        assert.notEqual(body.password, holder.password);
        holder.password = body.password; holder.enabled = false; holder.recoveryPending = false; holder.codes = []; holder.key = undefined;
        return ok(undefined, 204);
      }
      const administrative = /^\/api\/admin\/accounts\/([^/]+)\/(mfa|mfa-recovery)$/.exec(path);
      if (administrative) {
        const holder = [...accounts.values()].find((candidate) => candidate.id === administrative[1]);
        if (method === "GET") return ok({ enabled: holder.enabled, recoveryPending: holder.recoveryPending });
        assert.equal(body.identityChecked, true); assert.equal(client.account.username, "security.admin.2"); assert.equal(client.pending, false);
        holder.recoveryPending = true; holder.rescueCode = "ABCD-EFGH-JKMP-QRST-VWXY-2345"; return ok(undefined, 202);
      }
      const holder = client.account;
      assert.ok(holder, `unit protocol needs a holder for ${method} ${path}`);
      if (path === "/api/account/sessions" && method === "DELETE") { client.account = undefined; return ok(undefined, 204); }
      if (method === "POST" && path === "/api/session/mfa") {
        if (holder.codes.includes(body.code)) holder.codes.splice(holder.codes.indexOf(body.code), 1);
        else assert.equal(body.code, totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000));
        client.pending = false; return ok();
      }
      if (path === "/api/session/mfa/webauthn/options" || path === "/api/account/mfa/webauthn/authentication-options") return ok({ rpId: "courtside.example", challenge: "AQI", allowCredentials: [{ id: holder.credentialId, type: "public-key" }], userVerification: "required" });
      if (path === "/api/session/mfa/webauthn") {
        const data = Buffer.from(body.response.authenticatorData, "base64url");
        const clientData = Buffer.from(body.response.clientDataJSON, "base64url");
        assert.equal(data[32], 5);
        assert.equal(JSON.parse(clientData).challenge, "AQI");
        assert.equal(crypto.verify("sha256", Buffer.concat([data, crypto.createHash("sha256").update(clientData).digest()]), holder.key, Buffer.from(body.response.signature, "base64url")), true);
        client.pending = false; return ok();
      }
      assert.equal(client.pending, false);
      if (path === "/api/account/mfa" && method === "GET") return ok({ enabled: holder.enabled });
      if (path === "/api/account/mfa" && method === "DELETE") { holder.enabled = false; holder.pending = false; holder.key = undefined; holder.codes = []; return ok(undefined, 204); }
      if (path === "/api/account/password") { assert.equal(body.currentPassword, holder.password); holder.password = body.newPassword; return ok(undefined, 204); }
      if (path === "/api/account/mfa/totp" && method === "POST") { holder.pending = true; return ok({ secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" }); }
      if (path === "/api/account/mfa/totp" && method === "DELETE") { holder.enabled = false; holder.pending = false; return ok(undefined, 204); }
      if (path === "/api/account/mfa/totp/confirmation") { assert.equal(body.code, totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000, -1)); holder.enabled = true; holder.pending = false; holder.codes = Array.from({ length: 10 }, () => `unit-recovery-${++serial}`); return ok({ codes: [...holder.codes] }); }
      if (path === "/api/account/mfa/recovery-codes") { holder.codes = Array.from({ length: 10 }, () => `unit-recovery-${++serial}`); return ok({ codes: [...holder.codes] }); }
      if (path === "/api/account/mfa/webauthn/registration-options") return ok({ rp: { id: "courtside.example" }, user: { id: "AQI" }, challenge: "AwQ", pubKeyCredParams: [{ alg: -7 }] });
      if (path === "/api/account/mfa/webauthn") {
        const attestation = decodeCbor(Buffer.from(body.credential.response.attestationObject, "base64url"));
        const authData = attestation.get("authData");
        const length = authData.readUInt16BE(53);
        const cose = decodeCbor(authData.subarray(55 + length));
        holder.key = crypto.createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: cose.get(-2).toString("base64url"), y: cose.get(-3).toString("base64url") } });
        holder.enabled = true; holder.credentialId = body.credential.id;
        holder.codes = Array.from({ length: 10 }, () => `unit-recovery-${++serial}`); return ok({ codes: [...holder.codes] });
      }
      if (path.startsWith("/api/account/mfa/webauthn/credentials/")) { if (method === "DELETE") { holder.key = undefined; holder.enabled = false; } return ok(undefined, 204); }
      throw new Error(`Unsupported unit protocol request ${method} ${path}`);
    }
  };
  return { configuration, accounts, requests: () => requests };
}

for (const operationId of ["completeMfaLogin", "beginWebauthnLogin", "completeWebauthnLogin", "redeemMfaRecovery"]) {
  test(`given a generic error at ${operationId}, when the positive fixture runs, then reject the proof and still restore the synthetic holder`, async () => {
    // given
    const protocol = unitProtocol();
    const request = protocol.configuration.request;
    let refused = false;
    const paths = { completeMfaLogin: "/api/session/mfa", beginWebauthnLogin: "/api/session/mfa/webauthn/options", completeWebauthnLogin: "/api/session/mfa/webauthn", redeemMfaRecovery: "/api/account-recovery/mfa/redemption" };
    protocol.configuration.request = async (client, probe, options) => {
      const target = probe.path === paths[operationId] && (operationId !== "completeMfaLogin" || /^[0-9]{6}$/.test(JSON.parse(probe.body).code));
      if (target && !refused) { refused = true; return { status: 400, problemType: "urn:courtside:error:bad-request" }; }
      return request(client, probe, options);
    };
    const fixture = createMfaFixture(protocol.configuration);
    // when / then
    await assert.rejects(fixture.exercise({ operationId, mutation: true, expectations: { ANONYMOUS: "allow" } }, "ANONYMOUS", {}), /requires 2xx/);
    assert.equal(refused, true);
    for (const account of protocol.accounts.values()) {
      assert.equal(account.password, protocol.configuration.sharedPassword);
      assert.equal(account.enabled, false);
      assert.equal(account.recoveryPending, false);
    }
  });
}


test("given an authenticated account with another role, when the holder fixture proves its login, then reject the mismatched authorization boundary", async () => {
  // given
  const protocol = unitProtocol({ sessionRoles: ["MEMBER"] });
  const fixture = createMfaFixture(protocol.configuration);
  // when / then
  await assert.rejects(fixture.exercise({ operationId: "getOwnMfaStatus", expectations: { TRAINER: "allow" } }, "TRAINER", {}), (failure) => {
    const failures = failure instanceof AggregateError ? failure.errors : [failure];
    return failures.some((error) => /role/.test(error.message));
  });
});

test("given an extra administrator role, when the member fixture proves its login, then reject the elevated account", async () => {
  // given
  const protocol = unitProtocol({ sessionRoles: ["MEMBER", "ADMIN"] });
  const fixture = createMfaFixture(protocol.configuration);
  // when / then
  await assert.rejects(fixture.exercise({ operationId: "getOwnMfaStatus", expectations: { MEMBER: "allow" } }, "MEMBER", {}), (failure) => {
    const failures = failure instanceof AggregateError ? failure.errors : [failure];
    return failures.some((error) => /role/.test(error.message));
  });
});

for (const role of ["MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER", "TREASURER", "ADMIN"]) {
  test(`given the ${role} unit holder fixture, when response roles are checked, then use only its dedicated role account`, async () => {
    // given
    const protocol = unitProtocol();
    const fixture = createMfaFixture(protocol.configuration);
    // when
    const response = await fixture.exercise({ operationId: "getOwnMfaStatus", expectations: { [role]: "allow" } }, role, {});
    // then
    assert.equal(response.status, 200);
    assert.deepEqual([...protocol.accounts.keys()], [`security.${role.toLowerCase().replaceAll("_", ".")}.2`]);
    assert.equal(protocol.requests(), logicalRequestCounts.getOwnMfaStatus);
  });
}

test("given all direct positive MFA cases, when allocating bounded replays and CSRF bootstrap, then leave room in the existing active request contract", () => {
  // given
  const publicProofs = new Set(["completeMfaLogin", "beginWebauthnLogin", "completeWebauthnLogin", "redeemMfaRecovery"]);
  const administrative = new Set(["getAdministrativeMfaStatus", "initiateMfaRecovery"]);
  let limit = 0;
  let exercises = 0;
  let firstAttempts = 0;
  // when
  for (const operationId of Object.keys(logicalRequestCounts)) {
    const cases = publicProofs.has(operationId) || administrative.has(operationId) ? 1 : 7;
    limit += cases * mfaFixtureRequestLimit(operationId);
    firstAttempts += cases * mfaFixtureFirstAttemptRequests(operationId);
    exercises += cases;
  }
  // then
  assert.equal(exercises, 83);
  assert.equal(limit, 4224);
  assert.equal(firstAttempts, 1408);
  assert.ok(limit + 2492 < 10_000);
  assert.throws(() => mfaFixtureRequestLimit("untracked-operation"));
  assert.throws(() => mfaFixtureFirstAttemptRequests("untracked-operation"));
});

test("given roster search matches names rather than usernames, when resolving a rescue holder, then role filtering finds the exact synthetic account", async () => {
  // given
  const protocol = unitProtocol();
  const fixture = createMfaFixture(protocol.configuration);
  // when / then
  await assert.doesNotReject(() => fixture.exercise({
    operationId: "getAdministrativeMfaStatus", mutation: false, expectations: { ADMIN: "allow" }
  }, "ADMIN", {}));
});

test("given a real MFA fixture operation, when no bounded mail scope exists, then reject before any account request", () => {
  // given
  const protocol = unitProtocol();
  delete protocol.configuration.beginMailScope;
  // when / then
  assert.throws(() => createMfaFixture(protocol.configuration), /bounded mail scope/);
});

test("given an owned MFA fixture, when account cleanup succeeds, then finish its exact holder mail scope afterwards", async () => {
  // given
  const protocol = unitProtocol();
  const events = [];
  protocol.configuration.beginMailScope = async holders => {
    events.push(holders);
    return async () => { assert.ok(protocol.requests() > 0); events.push("finished"); };
  };
  // when
  await createMfaFixture(protocol.configuration).exercise({ operationId: "getOwnMfaStatus", expectations: { MEMBER: "allow" } }, "MEMBER", {});
  // then
  assert.deepEqual(events, [["security.member.2"], "finished"]);
});

test("given failed MFA account cleanup, when its fixture aborts, then retain the mail scope for diagnosis", async () => {
  // given
  const protocol = unitProtocol();
  let finished = false;
  protocol.configuration.beginMailScope = async () => async () => { finished = true; };
  const request = protocol.configuration.request;
  protocol.configuration.request = (client, probe, options) => probe.method === "DELETE" && probe.path === "/api/account/mfa"
    ? { status: 503 } : request(client, probe, options);
  // when / then
  await assert.rejects(createMfaFixture(protocol.configuration).exercise({ operationId: "getOwnMfaStatus", expectations: { MEMBER: "allow" } }, "MEMBER", {}), /requires 2xx/);
  assert.equal(finished, false);
});
