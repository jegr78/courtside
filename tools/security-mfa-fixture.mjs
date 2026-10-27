import * as crypto from "node:crypto";

export function requireMfaSuccess(response, operation) {
  if (!Number.isInteger(response?.status) || response.status < 200 || response.status >= 300 || response.problemType) {
    throw new Error(`MFA fixture ${operation} requires 2xx, received ${response?.status ?? "no response"}`);
  }
  return response;
}

export function totpCode(secret, instant = Date.now(), offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  if (typeof secret !== "string" || !/^[A-Z2-7]+=*$/.test(secret) || !Number.isFinite(Number(instant)) || !Number.isInteger(offset)) {
    throw new Error("Invalid TOTP fixture input");
  }
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of secret.replace(/=+$/, "")) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); value &= (1 << bits) - 1; }
  }
  const step = Math.floor(Number(instant) / 30_000) + offset;
  if (!Number.isSafeInteger(step) || step < 0) throw new Error("Invalid TOTP fixture time");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const position = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function cbor(value) {
  function head(major, length) {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 256) return Buffer.from([(major << 5) | 24, length]);
    if (length > 65_535) throw new Error("Fixture CBOR field exceeds its limit");
    const output = Buffer.alloc(3); output[0] = (major << 5) | 25; output.writeUInt16BE(length, 1); return output;
  }
  if (Number.isSafeInteger(value)) return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === "string") { const bytes = Buffer.from(value); return Buffer.concat([head(3, bytes.length), bytes]); }
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, entry]) => [cbor(key), cbor(entry)])]);
  throw new Error("Unsupported fixture CBOR value");
}

function trustedOrigin(value) {
  const origin = new URL(value);
  if (origin.protocol !== "https:" || origin.origin !== value) throw new Error("The MFA fixture requires the configured HTTPS origin");
  return origin;
}

export function createWebauthnAuthenticator(origin) {
  const trusted = trustedOrigin(origin);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const id = crypto.randomBytes(32).toString("base64url");
  let userHandle;
  let relyingParty;
  let counter = 0;
  const hash = (value) => crypto.createHash("sha256").update(value).digest();
  function validateRp(rpId) {
    if (typeof rpId !== "string" || !(trusted.hostname === rpId || trusted.hostname.endsWith(`.${rpId}`))) {
      throw new Error("The fixture RP is outside its configured origin");
    }
  }
  function clientData(type, challenge) {
    if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]+$/.test(challenge)) throw new Error("Invalid fixture WebAuthn challenge");
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }
  function data(rpId, flags) {
    const output = Buffer.alloc(37);
    hash(rpId).copy(output); output[32] = flags; output.writeUInt32BE(counter, 33); return output;
  }
  function credential(response) { return { id, rawId: id, type: "public-key", response, clientExtensionResults: {}, authenticatorAttachment: "cross-platform" }; }
  return {
    credentialId: id,
    publicKey,
    register(options) {
      validateRp(options?.rp?.id);
      if (userHandle || !options?.pubKeyCredParams?.some((entry) => entry.alg === -7)
        || typeof options?.user?.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(options.user.id)
        || options.excludeCredentials?.some((entry) => entry.id === id)) throw new Error("Invalid fixture registration options");
      const client = clientData("webauthn.create", options.challenge);
      const jwk = publicKey.export({ format: "jwk" });
      const key = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
      const credentialId = Buffer.from(id, "base64url");
      const length = Buffer.alloc(2); length.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([data(options.rp.id, 69), Buffer.alloc(16), length, credentialId, key]);
      userHandle = options.user.id;
      relyingParty = options.rp.id;
      return credential({ attestationObject: cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]])).toString("base64url"), clientDataJSON: client.toString("base64url"), transports: ["usb"] });
    },
    assertion(options) {
      validateRp(options?.rpId);
      if (!userHandle || relyingParty !== options.rpId || counter >= 0xffffffff
        || options.allowCredentials?.length && !options.allowCredentials.some((entry) => entry.id === id)) throw new Error("Invalid fixture assertion options");
      const client = clientData("webauthn.get", options.challenge);
      counter += 1;
      const authData = data(relyingParty, 5);
      const signature = crypto.sign("sha256", Buffer.concat([authData, hash(client)]), privateKey);
      return credential({ authenticatorData: authData.toString("base64url"), clientDataJSON: client.toString("base64url"), signature: signature.toString("base64url"), userHandle });
    }
  };
}

export const mfaFixtureOperationIds = Object.freeze([
  "getOwnMfaStatus", "disableOwnMfa", "beginTotpEnrollment", "confirmTotpEnrollment", "removeOwnTotp",
  "replaceOwnRecoveryCodes", "beginWebauthnEnrollment", "confirmWebauthnEnrollment", "removeOwnWebauthnCredential",
  "renameOwnWebauthnCredential", "beginWebauthnReauthentication", "beginWebauthnLogin", "completeWebauthnLogin",
  "completeMfaLogin", "getAdministrativeMfaStatus", "initiateMfaRecovery", "redeemMfaRecovery"
]);
const mfaFixtureLogicalRequests = Object.freeze({
  getOwnMfaStatus: 12, disableOwnMfa: 18, beginTotpEnrollment: 12, confirmTotpEnrollment: 14,
  removeOwnTotp: 18, replaceOwnRecoveryCodes: 19, beginWebauthnEnrollment: 12,
  confirmWebauthnEnrollment: 14, removeOwnWebauthnCredential: 18, renameOwnWebauthnCredential: 19,
  beginWebauthnReauthentication: 19, beginWebauthnLogin: 21, completeWebauthnLogin: 22,
  completeMfaLogin: 21, getAdministrativeMfaStatus: 31, initiateMfaRecovery: 43, redeemMfaRecovery: 43
});

export function mfaFixtureFirstAttemptRequests(operationId) {
  const requests = mfaFixtureLogicalRequests[operationId];
  if (!Number.isSafeInteger(requests)) throw new Error("Unsupported MFA fixture operation");
  const bootstrap = ["initiateMfaRecovery", "redeemMfaRecovery"].includes(operationId) ? 1 : 0;
  return requests + bootstrap;
}

export function mfaFixtureRequestLimit(operationId) {
  return mfaFixtureFirstAttemptRequests(operationId) * 3;
}
export const mfaFixtureMaxRequestsPerExercise = Math.max(...mfaFixtureOperationIds.map(mfaFixtureRequestLimit));

const actorNames = {
  MEMBER: "security.member.2", TRAINER: "security.trainer.2", SPORT_DIRECTOR: "security.sport.director.2",
  YOUTH_DIRECTOR: "security.youth.director.2", GROUNDSKEEPER: "security.groundskeeper.2",
  TREASURER: "security.treasurer.2", ADMIN: "security.admin.2"
};
const jsonHeaders = { "content-type": "application/json" };

export function createMfaFixture({ request, makeClient, clients, sharedPassword, origin, resetLoginAttempts, readRecoveryCode, beginMailScope, now = Date.now }) {
  trustedOrigin(origin);
  if (typeof beginMailScope !== "function") throw new Error("MFA fixtures require a bounded mail scope");
  if (typeof request !== "function" || typeof makeClient !== "function" || typeof sharedPassword !== "string") throw new Error("Incomplete MFA fixture configuration");
  const observedRecoveryCodes = new Set();
  async function send(client, method, path, body) {
    return request(client, { method, path, headers: body === undefined ? {} : jsonHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { csrf: method !== "GET" });
  }
  async function successful(client, method, path, body) { return requireMfaSuccess(await send(client, method, path, body), `${method} ${path}`); }
  function json(response) {
    const value = response.json ?? (typeof response.body === "string" && response.body ? JSON.parse(response.body) : undefined);
    if (!value || typeof value !== "object") throw new Error("MFA fixture expected a structured response");
    return value;
  }
  function holder(actor) {
    if (!actorNames[actor]) throw new Error("Unsupported MFA fixture role");
    return { username: actorNames[actor], role: actor, password: sharedPassword, codes: [], client: undefined, authenticator: undefined, recoveryPending: false };
  }
  async function login(account, pending = false) {
    await resetLoginAttempts?.();
    const client = makeClient();
    await successful(client, "GET", "/api/session");
    const response = await request(client, { method: "POST", path: "/api/session", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: account.username, password: account.password }).toString() }, { csrf: true });
    requireMfaSuccess(response, "password login");
    account.client = client;
    if (pending) {
      if (response.status !== 202) throw new Error("The fixture did not enter a pending MFA session");
      return client;
    }
    if (response.status === 202) {
      if (account.codes.length) await successful(client, "POST", "/api/session/mfa", { code: account.codes.shift() });
      else if (account.authenticator) {
        const options = json(await successful(client, "POST", "/api/session/mfa/webauthn/options"));
        await successful(client, "POST", "/api/session/mfa/webauthn", account.authenticator.assertion(options));
      } else throw new Error("No second factor remains for fixture login");
    } else if (response.status !== 200) throw new Error("Unexpected fixture login status");
    const status = json(await successful(client, "GET", "/api/session"));
    if (!status.authenticated || status.username !== account.username) throw new Error("The fixture login did not authenticate its holder");
    if (!Array.isArray(status.roles) || status.roles.length !== 1 || status.roles[0] !== account.role) throw new Error("The fixture holder role does not match its authorization boundary");
    return client;
  }
  async function enrollTotp(account) {
    await login(account);
    const options = json(await successful(account.client, "POST", "/api/account/mfa/totp"));
    account.secret = options.secret;
    const result = await successful(account.client, "POST", "/api/account/mfa/totp/confirmation", { code: totpCode(account.secret, now(), -1) });
    account.codes = [...json(result).codes];
    await login(account);
  }
  async function enrollKey(account) {
    await login(account);
    const options = json(await successful(account.client, "POST", "/api/account/mfa/webauthn/registration-options"));
    account.authenticator = createWebauthnAuthenticator(origin);
    const result = await successful(account.client, "POST", "/api/account/mfa/webauthn", { label: "Assessment fixture key", credential: account.authenticator.register(options) });
    account.codes = [...json(result).codes];
    await login(account);
  }
  async function recoveryCode(account) {
    if (account.recoveryCode) return account.recoveryCode;
    if (typeof readRecoveryCode !== "function") throw new Error("Controlled MFA recovery requires the owned-mail readRecoveryCode port");
    const code = await readRecoveryCode(account.username, { excludedCodes: [...observedRecoveryCodes], after: account.recoveryAfter });
    if (typeof code !== "string" || !/^[2-9A-HJKMNP-TV-Z]{4}(?:-[2-9A-HJKMNP-TV-Z]{4}){5}$/.test(code) || observedRecoveryCodes.has(code)) throw new Error("No newly issued controlled-recovery mail code was supplied");
    observedRecoveryCodes.add(code);
    account.recoveryCode = code;
    return code;
  }
  async function accountId(account) {
    const response = await successful(clients.ADMIN, "POST", "/api/admin/roster-search", { role: account.role, limit: 100 });
    const entry = json(response).entries?.find((candidate) => candidate.username === account.username);
    if (!entry?.accountId) throw new Error("The synthetic MFA fixture holder was not found");
    return entry.accountId;
  }
  async function initiate(target, administrator) {
    const id = await accountId(target);
    target.recoveryAfter = Date.now();
    const response = await successful(administrator.client, "POST", `/api/admin/accounts/${id}/mfa-recovery`, { identityChecked: true });
    target.recoveryPending = true;
    return response;
  }
  async function redeem(account, code) {
    const nextPassword = `Assessment-rescue-${crypto.randomBytes(20).toString("base64url")}`;
    const response = await successful(makeClient(), "POST", "/api/account-recovery/mfa/redemption", { username: account.username, code, password: nextPassword });
    account.password = nextPassword;
    account.recoveryPending = false;
    account.recoveryCode = undefined;
    account.codes = [];
    account.authenticator = undefined;
    return response;
  }
  async function cleanup(account) {
    if (account.recoveryPending) await redeem(account, await recoveryCode(account));
    await login(account);
    await successful(account.client, "DELETE", "/api/account/mfa");
    account.codes = []; account.authenticator = undefined;
    await login(account);
    if (account.password !== sharedPassword) {
      await successful(account.client, "PUT", "/api/account/password", { currentPassword: account.password, newPassword: sharedPassword });
      account.password = sharedPassword;
      await login(account);
    }
    await successful(account.client, "DELETE", "/api/account/sessions");
  }
  return {
    supports: (operationId) => mfaFixtureOperationIds.includes(operationId),
    async exercise(operation, actor, probe) {
      if (!mfaFixtureOperationIds.includes(operation.operationId)) throw new Error("Unsupported MFA fixture operation");
      if (operation.expectations?.[actor] !== "allow") return request(clients[actor], probe, { csrf: operation.mutation });
      const id = operation.operationId;
      const publicProof = ["completeMfaLogin", "beginWebauthnLogin", "completeWebauthnLogin", "redeemMfaRecovery"].includes(id);
      const account = holder(publicProof || id === "getAdministrativeMfaStatus" || id === "initiateMfaRecovery" ? "MEMBER" : actor);
      const accounts = [account];
      const finishMail = await beginMailScope([account.username,
        ...(["getAdministrativeMfaStatus", "initiateMfaRecovery", "redeemMfaRecovery"].includes(id) ? [actorNames.ADMIN] : [])]);
      if (typeof finishMail !== "function") throw new Error("MFA fixtures require a bounded mail scope");
      let response;
      let failure;
      try {
        if (["getAdministrativeMfaStatus", "initiateMfaRecovery", "redeemMfaRecovery"].includes(id)) {
          await enrollTotp(account);
          const administrator = holder("ADMIN"); accounts.push(administrator);
          if (id === "getAdministrativeMfaStatus") await login(administrator);
          else await enrollTotp(administrator);
          const target = await accountId(account);
          if (id === "getAdministrativeMfaStatus") response = await send(administrator.client, "GET", `/api/admin/accounts/${target}/mfa`);
          else if (id === "initiateMfaRecovery") response = await initiate(account, administrator);
          else { await initiate(account, administrator); response = await redeem(account, await recoveryCode(account)); }
        } else if (["confirmWebauthnEnrollment", "beginWebauthnEnrollment"].includes(id)) {
          await login(account);
          const options = await successful(account.client, "POST", "/api/account/mfa/webauthn/registration-options");
          if (id === "beginWebauthnEnrollment") response = options;
          else {
            account.authenticator = createWebauthnAuthenticator(origin);
            response = await send(account.client, "POST", "/api/account/mfa/webauthn", { label: "Assessment fixture key", credential: account.authenticator.register(json(options)) });
            requireMfaSuccess(response, id); account.codes = [...json(response).codes];
          }
        } else if (["removeOwnWebauthnCredential", "renameOwnWebauthnCredential", "beginWebauthnReauthentication", "beginWebauthnLogin", "completeWebauthnLogin"].includes(id)) {
          await enrollKey(account);
          if (id === "beginWebauthnLogin" || id === "completeWebauthnLogin") {
            await login(account, true);
            const options = await successful(account.client, "POST", "/api/session/mfa/webauthn/options");
            response = id === "beginWebauthnLogin" ? options : await send(account.client, "POST", "/api/session/mfa/webauthn", account.authenticator.assertion(json(options)));
          } else if (id === "beginWebauthnReauthentication") response = await send(account.client, "POST", "/api/account/mfa/webauthn/authentication-options");
          else response = await send(account.client, id === "removeOwnWebauthnCredential" ? "DELETE" : "PATCH", `/api/account/mfa/webauthn/credentials/${account.authenticator.credentialId}`, id === "renameOwnWebauthnCredential" ? { label: "Renamed assessment key" } : undefined);
        } else if (id === "beginTotpEnrollment" || id === "confirmTotpEnrollment") {
          await login(account);
          const options = await successful(account.client, "POST", "/api/account/mfa/totp");
          if (id === "beginTotpEnrollment") response = options;
          else {
            response = await send(account.client, "POST", "/api/account/mfa/totp/confirmation", { code: totpCode(json(options).secret, now(), -1) });
            requireMfaSuccess(response, id); account.codes = [...json(response).codes];
          }
        } else if (id === "getOwnMfaStatus") {
          await login(account); response = await send(account.client, "GET", "/api/account/mfa");
        } else if (["disableOwnMfa", "removeOwnTotp", "replaceOwnRecoveryCodes", "completeMfaLogin"].includes(id)) {
          await enrollTotp(account);
          if (id === "completeMfaLogin") { await login(account, true); response = await send(account.client, "POST", "/api/session/mfa", { code: totpCode(account.secret, now()) }); }
          else if (id === "replaceOwnRecoveryCodes") { response = await send(account.client, "POST", "/api/account/mfa/recovery-codes"); requireMfaSuccess(response, id); account.codes = [...json(response).codes]; }
          else response = await send(account.client, "DELETE", id === "removeOwnTotp" ? "/api/account/mfa/totp" : "/api/account/mfa");
        } else throw new Error(`Unsupported MFA fixture operation ${id}`);
        requireMfaSuccess(response, id);
      } catch (error) { failure = error; }
      for (const account of accounts) {
        try { await cleanup(account); } catch (error) { failure = failure ? new AggregateError([failure, error], "MFA fixture operation and cleanup failed") : error; }
      }
      if (failure) throw failure;
      await finishMail();
      return response;
    }
  };
}
