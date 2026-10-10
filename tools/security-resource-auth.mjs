import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { resourceIntegritySnapshotFingerprint, resourceSessionAttributeDigest } from "./security-resource-integrity.mjs";
import { failureCode } from "./failure-reason.mjs";

const classRoot = "/app/BOOT-INF/classes/org/courtside/securityassessment/SecuritySessionAttributeProjection";
export const resourceSessionProjectionClassPaths = Object.freeze([
  `${classRoot}.class`, `${classRoot}$RestrictedStream.class`
]);
export const resourceAuthenticationLimits = Object.freeze({
  snapshotBytes: 32 * 1024 * 1024, journalBytes: 8 * 1024 * 1024,
  decoderInputBytes: 262144, decoderOutputBytes: 32768, bindingOutputBytes: 4096,
  sessions: 512, operations: 10000, depth: 32, nodes: 1000000, timeoutMilliseconds: 10000
});
const names = ["SPRING_SECURITY_CONTEXT", "courtside.authenticated-at", "courtside.browser-family"];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const rawSession = /^[A-Za-z0-9_-]{36}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const families = ["CHROME", "EDGE", "FIREFOX", "SAFARI", "OTHER"];
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const lexical = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const safe = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value, max) => typeof value === "string" && value.length <= max;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => object(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

class EvidenceRejection extends Error {
  constructor(code, outcome = "incomplete", cause = undefined) {
    super(code);
    this.code = code;
    this.outcome = outcome;
    this.failureCause = cause;
  }
}

function requireEvidence(condition, code, outcome) {
  if (!condition) throw new EvidenceRejection(code, outcome);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function boundedClone(value, maxBytes) {
  const ancestors = new Set();
  let nodes = 0;
  let bytes = 0;
  const charge = (amount) => {
    bytes += amount;
    requireEvidence(bytes <= maxBytes, "authentication-input-budget-exceeded");
  };
  const visit = (item, depth) => {
    requireEvidence(++nodes <= resourceAuthenticationLimits.nodes && depth <= resourceAuthenticationLimits.depth,
      "authentication-input-budget-exceeded");
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) {
      charge(Buffer.byteLength(JSON.stringify(item)));
      return item;
    }
    if (typeof item === "string") {
      charge(Buffer.byteLength(item) + 2);
      charge(Buffer.byteLength(JSON.stringify(item)) - Buffer.byteLength(item) - 2);
      return item;
    }
    requireEvidence(object(item) || Array.isArray(item), "authentication-input-invalid");
    requireEvidence(!ancestors.has(item), "authentication-input-invalid");
    requireEvidence(Array.isArray(item) || [Object.prototype, null].includes(Object.getPrototypeOf(item)), "authentication-input-invalid");
    ancestors.add(item);
    charge(2);
    const result = Array.isArray(item) ? [] : Object.create(null);
    for (const key of Object.keys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      requireEvidence(descriptor && Object.hasOwn(descriptor, "value"), "authentication-input-invalid");
      charge(1 + (Array.isArray(item) ? 0 : Buffer.byteLength(JSON.stringify(key)) + 1));
      result[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
    return result;
  };
  return JSON.parse(JSON.stringify(visit(value, 0)));
}

function strictJson(source) {
  let offset = 0;
  let nodes = 0;
  const whitespace = () => { while (/\s/.test(source[offset] ?? "") && offset < source.length) offset++; };
  const string = () => {
    const match = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(source.slice(offset));
    requireEvidence(match, "session-decoder-output-invalid");
    offset += match[0].length;
    return JSON.parse(match[0]);
  };
  const read = (depth) => {
    whitespace();
    requireEvidence(depth <= 16 && ++nodes <= 4096, "session-decoder-output-invalid");
    if (source[offset] === '"') return string();
    if (source[offset] === "{" || source[offset] === "[") {
      const isObject = source[offset++] === "{";
      const end = isObject ? "}" : "]";
      const result = isObject ? Object.create(null) : [];
      whitespace();
      if (source[offset] === end) { offset++; return result; }
      while (true) {
        whitespace();
        let key;
        if (isObject) {
          key = string();
          requireEvidence(!Object.hasOwn(result, key), "session-decoder-output-invalid");
          whitespace();
          requireEvidence(source[offset++] === ":", "session-decoder-output-invalid");
        }
        const value = read(depth + 1);
        if (isObject) result[key] = value;
        else result.push(value);
        whitespace();
        const separator = source[offset++];
        if (separator === end) return result;
        requireEvidence(separator === ",", "session-decoder-output-invalid");
      }
    }
    const token = /^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.slice(offset));
    requireEvidence(token, "session-decoder-output-invalid");
    offset += token[0].length;
    return JSON.parse(token[0]);
  };
  const result = read(0);
  whitespace();
  requireEvidence(offset === source.length, "session-decoder-output-invalid");
  return result;
}

function nativeInstant(value) {
  if (typeof value !== "string" || value.length > 30) return false;
  const parts = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.[0-9]{3}(?:[0-9]{3}){0,2})?Z$/.exec(value);
  if (!parts || parts[0] !== value) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && epoch >= 0 && new Date(epoch).toISOString().slice(0, 19) === parts[1];
}

function validateProjection(name, value) {
  const invalid = "session-decoder-projection-invalid";
  if (name === names[1] || name === names[2]) {
    requireEvidence(exact(value, ["className", "value"]), invalid);
    requireEvidence(name === names[1] ? value.className === "java.lang.Long" && safe(value.value)
      : value.className === "java.lang.String" && families.includes(value.value), invalid);
    return;
  }
  requireEvidence(exact(value, ["contextClass", "authenticationClass", "principalClass", "authenticated",
    "accountId", "username", "securityEpoch", "authorities", "principalAuthorities", "passwordFactorIssuedAt",
    "credentials", "details", "principalPassword",
    "enabled", "accountNonExpired", "accountNonLocked", "credentialsNonExpired"]), invalid);
  requireEvidence(value.contextClass === "org.springframework.security.core.context.SecurityContextImpl"
    && value.authenticationClass === "org.springframework.security.authentication.UsernamePasswordAuthenticationToken"
    && value.principalClass === "org.courtside.identity.internal.CourtsideUserDetails"
    && typeof value.accountId === "string" && uuid.test(value.accountId) && text(value.username, 256)
    && safe(value.securityEpoch) && value.credentials === null && value.principalPassword === null
    && ["authenticated", "enabled", "accountNonExpired", "accountNonLocked", "credentialsNonExpired"]
      .every((key) => typeof value[key] === "boolean"), invalid);
  for (const authorities of [value.authorities, value.principalAuthorities]) {
    requireEvidence(Array.isArray(authorities) && authorities.length <= 32
      && authorities.every((authority) => text(authority, 64))
      && new Set(authorities).size === authorities.length
      && canonical(authorities) === canonical([...authorities].sort()), invalid);
  }
  requireEvidence(value.passwordFactorIssuedAt === null || nativeInstant(value.passwordFactorIssuedAt), invalid);
  if (value.details !== null) requireEvidence(exact(value.details, ["className", "remoteAddress", "sessionId"])
    && value.details.className === "org.springframework.security.web.authentication.WebAuthenticationDetails"
    && text(value.details.remoteAddress, 64)
    && (value.details.sessionId === null || typeof value.details.sessionId === "string" && rawSession.test(value.details.sessionId)), invalid);
}

function policies(input) {
  const session = input.sessionPolicy;
  const login = input.loginPolicy;
  const sessionFields = ["inactivitySeconds", "absoluteLifetimeMilliseconds", "concurrentLimit", "cookieName", "browserFamily"];
  requireEvidence(typeof input.sourceAddress === "string" && input.sourceAddress.length <= 64 && isIP(input.sourceAddress),
    "authentication-source-address-incomplete");
  requireEvidence(object(session) && sessionFields.every((key) => Object.hasOwn(session, key))
    && Object.keys(session).every((key) => [...sessionFields, "passwordFactorRequired"].includes(key))
    && (!Object.hasOwn(session, "passwordFactorRequired") || typeof session.passwordFactorRequired === "boolean")
    && safe(session.inactivitySeconds, 60) && safe(session.absoluteLifetimeMilliseconds, 60000, 2592000000)
    && safe(session.concurrentLimit, 1, 50) && ["SESSION", "__Host-SESSION"].includes(session.cookieName)
    && families.includes(session.browserFamily), "authentication-session-policy-incomplete");
  requireEvidence(object(login) && Object.keys(login).every((key) => ["address", "global", "proofMode", "sourceAddress", "verificationConcurrency"].includes(key))
    && safe(login.verificationConcurrency, 1)
    && exact(login.address, ["maxFailures", "windowMilliseconds", "blockMilliseconds"])
    && object(login.global) && Object.hasOwn(login.global, "windowMilliseconds")
    && Object.keys(login.global).every((key) => ["windowMilliseconds", "threshold"].includes(key))
    && (!Object.hasOwn(login.global, "threshold") || safe(login.global.threshold, 1)) && safe(login.address.maxFailures, 1)
    && [login.address.windowMilliseconds, login.address.blockMilliseconds, login.global.windowMilliseconds]
      .every((value) => safe(value, 1000))
    && (login.sourceAddress === undefined || login.sourceAddress === input.sourceAddress)
    && (login.proofMode === undefined || login.proofMode === "http-bounded-v1"), "authentication-login-policy-incomplete");
  return { sessionPolicy: structuredClone(session), loginPolicy: { ...structuredClone(login),
    sourceAddress: input.sourceAddress, proofMode: "http-bounded-v1" } };
}

function validateBinding(binding) {
  requireEvidence(exact(binding, ["sourceDigest", "classDigests"]) && typeof binding.sourceDigest === "string"
    && digest.test(binding.sourceDigest) && exact(binding.classDigests, resourceSessionProjectionClassPaths)
    && Object.values(binding.classDigests).every((value) => typeof value === "string" && digest.test(value)),
  "session-decoder-runtime-binding-incomplete");
}

async function output(command, args, options) {
  let result;
  try { result = await command(args, options); }
  catch (failure) { throw new EvidenceRejection("session-decoder-execution-incomplete", "incomplete", failureCode(failure)); }
  requireEvidence(result && (result.exitCode === undefined || result.exitCode === 0)
    && !result.truncated && !result.timedOut
    && (result.code === undefined || result.code === 0) && typeof result.stdout === "string"
    && Buffer.byteLength(result.stdout) <= options.outputLimitBytes, "session-decoder-output-invalid");
  return result.stdout;
}

async function mountedBinding(input, command) {
  const result = await output(command, ["exec", input.decoderContainer, "sha256sum", ...resourceSessionProjectionClassPaths],
    { outputLimitBytes: resourceAuthenticationLimits.bindingOutputBytes,
      timeoutMilliseconds: resourceAuthenticationLimits.timeoutMilliseconds });
  const lines = result.endsWith("\n") ? result.slice(0, -1).split("\n") : result.split("\n");
  requireEvidence(lines.length === resourceSessionProjectionClassPaths.length, "session-decoder-class-binding-incomplete");
  const observed = {};
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (\/app\/BOOT-INF\/classes\/[^\r\n]+)$/.exec(line);
    requireEvidence(match && resourceSessionProjectionClassPaths.includes(match[2]) && !Object.hasOwn(observed, match[2]),
      "session-decoder-class-binding-incomplete");
    observed[match[2]] = `sha256:${match[1]}`;
  }
  requireEvidence(canonical(observed) === canonical(input.runtimeBinding.classDigests), "session-decoder-class-binding-mismatch", "failed");
  return { sourceDigest: input.runtimeBinding.sourceDigest, classDigests: observed };
}

function prepareJournal(input) {
  const journal = input.journal;
  requireEvidence(journal.schemaVersion === 1 && Array.isArray(journal.operations)
    && journal.operations.length <= resourceAuthenticationLimits.operations
    && Array.isArray(journal.ownedSessionIds) && journal.ownedSessionIds.length <= resourceAuthenticationLimits.sessions,
  "authentication-journal-incomplete");
  const owned = new Set(journal.ownedSessionIds);
  const usernames = new Set();
  const ids = new Set();
  const accounts = new Map();
  for (const row of input.before.tables.user_account.rows) {
    requireEvidence(typeof row.username === "string" && !accounts.has(row.username), "authentication-account-baseline-incomplete");
    accounts.set(row.username, row.id);
  }
  for (const operation of journal.operations) {
    requireEvidence(object(operation) && text(operation.id, 256) && operation.id.length > 0 && !ids.has(operation.id),
      "authentication-journal-incomplete");
    ids.add(operation.id);
    delete operation.sourceAddress;
    for (const key of ["sessionId", "requestSessionId", "responseSessionId"]) {
      if (operation[key] !== null && operation[key] !== undefined) {
        requireEvidence(typeof operation[key] === "string" && rawSession.test(operation[key]), "authentication-session-id-incomplete");
        owned.add(operation[key]);
      }
    }
    if (operation.kind === "login") {
      requireEvidence(operation.method === "POST" && operation.path === "/api/session", "authentication-login-operation-incomplete");
      operation.sourceAddress = input.sourceAddress;
      if (operation.username !== null && operation.username !== undefined) {
        requireEvidence(text(operation.username, 256), "authentication-login-username-incomplete");
        usernames.add(operation.username);
      }
      if (operation.status === 200) {
        const accountId = accounts.get(operation.username);
        requireEvidence(typeof accountId === "string" && uuid.test(accountId), "authentication-login-baseline-incomplete");
        requireEvidence(operation.accountId !== null && operation.accountId !== undefined, "authentication-login-identity-incomplete");
        requireEvidence(operation.accountId === accountId, "authentication-login-account-mismatch", "failed");
        operation.accountId = accountId;
      }
    }
  }
  requireEvidence(owned.size <= resourceAuthenticationLimits.sessions
    && [...owned].every((id) => typeof id === "string" && rawSession.test(id)) && usernames.size <= 8,
  "authentication-session-budget-exceeded");
  delete journal.sessions;
  delete journal.loginTransitions;
  delete journal.loginTransitionsComplete;
  journal.ownedSessionIds = [...owned].sort();
  journal.loginUsernames = [...usernames].sort();
  return { journal, owned };
}

function sessionPlan(input, owned) {
  const phases = [["before", input.before], ["after", input.effects]];
  const byRaw = new Map();
  const byPrimary = new Map();
  const maps = [];
  const ownedPrimary = new Set();
  for (const [phase, snapshot] of phases) {
    const map = new Map();
    const rawIds = new Set();
    for (const row of snapshot.tables.spring_session.rows) {
      requireEvidence(typeof row.primary_id === "string" && uuid.test(row.primary_id)
        && typeof row.session_id === "string" && rawSession.test(row.session_id) && !rawIds.has(row.session_id),
      "authentication-session-mapping-incomplete");
      rawIds.add(row.session_id);
      requireEvidence(!byRaw.has(row.session_id) || byRaw.get(row.session_id) === row.primary_id, "authentication-session-mapping-incomplete");
      requireEvidence(!byPrimary.has(row.primary_id) || byPrimary.get(row.primary_id) === row.session_id, "authentication-session-mapping-incomplete");
      byRaw.set(row.session_id, row.primary_id);
      byPrimary.set(row.primary_id, row.session_id);
      if (owned.has(row.session_id)) ownedPrimary.add(row.primary_id);
      map.set(row.primary_id, { phase, row, attributes: [] });
    }
    for (const attribute of snapshot.tables.spring_session_attributes.rows) {
      requireEvidence(map.has(attribute.session_primary_id), "authentication-orphan-attribute-incomplete");
      map.get(attribute.session_primary_id).attributes.push(attribute);
    }
    maps.push(map);
  }
  const changed = new Set([...new Set([...maps[0].keys(), ...maps[1].keys()])].filter((id) =>
    canonical(maps[0].get(id)?.row ?? null) !== canonical(maps[1].get(id)?.row ?? null)
    || canonical([...(maps[0].get(id)?.attributes ?? [])].sort((a, b) => lexical(a.attribute_name, b.attribute_name)))
      !== canonical([...(maps[1].get(id)?.attributes ?? [])].sort((a, b) => lexical(a.attribute_name, b.attribute_name)))));
  const selected = new Set([...ownedPrimary, ...changed]);
  requireEvidence(selected.size <= resourceAuthenticationLimits.sessions, "authentication-session-budget-exceeded");
  const plan = maps.flatMap((map) => [...map.values()].filter((entry) => selected.has(entry.row.primary_id))
    .sort((a, b) => a.row.primary_id.localeCompare(b.row.primary_id)));
  for (const entry of plan) {
    entry.attributes.sort((a, b) => lexical(a.attribute_name, b.attribute_name));
    requireEvidence(canonical(entry.attributes.map((attribute) => attribute.attribute_name)) === canonical(names),
      "authentication-session-attributes-incomplete");
    for (const attribute of entry.attributes) {
      try { resourceSessionAttributeDigest(attribute.attribute_bytes); }
      catch (failure) { throw new EvidenceRejection("authentication-session-attribute-bytes-incomplete", "incomplete", failureCode(failure)); }
    }
  }
  return { plan, ownedPrimary: [...ownedPrimary].sort() };
}

async function decodeAttribute(input, command, attribute) {
  const payload = JSON.stringify({ attributes: [{ name: attribute.attribute_name, attributeBytes: attribute.attribute_bytes }] });
  requireEvidence(Buffer.byteLength(payload) <= resourceAuthenticationLimits.decoderInputBytes, "session-decoder-input-budget-exceeded");
  const source = await output(command, ["exec", "-i", "-w", "/app", input.decoderContainer, "java",
    "--sun-misc-unsafe-memory-access=deny", "-Dloader.main=org.courtside.securityassessment.SecuritySessionAttributeProjection",
    "-cp", ".", "org.springframework.boot.loader.launch.PropertiesLauncher"], {
    input: payload, outputLimitBytes: resourceAuthenticationLimits.decoderOutputBytes,
    timeoutMilliseconds: resourceAuthenticationLimits.timeoutMilliseconds
  });
  const parsed = strictJson(source);
  requireEvidence(exact(parsed, ["attributes"]) && Array.isArray(parsed.attributes) && parsed.attributes.length === 1,
    "session-decoder-output-invalid");
  const projection = parsed.attributes[0];
  requireEvidence(exact(projection, ["name", "decoder", "bytesDigest", "value"])
    && projection.name === attribute.attribute_name && projection.decoder === "spring-jdbc-java-serialization-v1",
  "session-decoder-output-invalid");
  requireEvidence(projection.bytesDigest === resourceSessionAttributeDigest(attribute.attribute_bytes),
    "session-decoder-byte-binding-mismatch", "failed");
  validateProjection(projection.name, projection.value);
  return JSON.parse(JSON.stringify(projection));
}

export async function captureResourceAuthentication(options, command) {
  try {
    requireEvidence(object(options) && typeof command === "function", "authentication-input-incomplete");
    const input = {
      before: boundedClone(options.before, resourceAuthenticationLimits.snapshotBytes),
      effects: boundedClone(options.effects, resourceAuthenticationLimits.snapshotBytes),
      journal: boundedClone(options.journal, resourceAuthenticationLimits.journalBytes),
      ...boundedClone(Object.fromEntries(["sourceAddress", "sessionPolicy", "loginPolicy", "decoderContainer", "runtimeBinding"]
        .filter((key) => Object.hasOwn(options, key)).map((key) => [key, options[key]])), 16384)
    };
    requireEvidence(typeof input.decoderContainer === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(input.decoderContainer),
      "session-decoder-container-incomplete");
    validateBinding(input.runtimeBinding);
    const policy = policies(input);
    try {
      resourceIntegritySnapshotFingerprint(input.before);
      resourceIntegritySnapshotFingerprint(input.effects);
    } catch (failure) { throw new EvidenceRejection("authentication-snapshot-incomplete", "incomplete", failureCode(failure)); }
    const { journal, owned } = prepareJournal(input);
    const { plan, ownedPrimary } = sessionPlan(input, owned);
    const runtimeBinding = await mountedBinding(input, command);
    const sessions = [];
    for (const { phase, row, attributes } of plan) {
      const projections = [];
      for (const attribute of attributes) projections.push(await decodeAttribute(input, command, attribute));
      sessions.push({ phase, primaryId: row.primary_id, sessionId: row.session_id,
        cookieName: policy.sessionPolicy.cookieName, cookieValue: Buffer.from(row.session_id).toString("base64"),
        operationIds: phase === "before" ? [] : journal.operations.filter((operation) =>
          operation.sessionId === row.session_id || operation.kind === "login" && operation.status === 200
            && operation.responseSessionId === row.session_id).map((operation) => operation.id), attributes: projections });
    }
    await mountedBinding(input, command);
    journal.sessions = sessions;
    const authentication = { ownedSessionPrimaryIds: ownedPrimary,
      loginSubjects: [{ scope: "ADDRESS", subjectHash: hash(`login:${input.sourceAddress}`).slice(7) },
        { scope: "GLOBAL", subjectHash: hash("all").slice(7) }], ...policy };
    return { schemaVersion: 1, outcome: "passed", journal, authentication,
      ownedSessionIds: journal.ownedSessionIds, loginUsernames: journal.loginUsernames,
      runtimeBinding, runtimeDigest: hash(canonical(runtimeBinding)),
      privateProof: { runtimeBinding }, findings: [] };
  } catch (error) {
    return { schemaVersion: 1, outcome: error instanceof EvidenceRejection ? error.outcome : "incomplete",
      journal: null, authentication: null, ownedSessionIds: [], loginUsernames: [],
      runtimeBinding: null, runtimeDigest: null, privateProof: null,
      findings: [error instanceof EvidenceRejection
        ? { code: error.code, ...(error.failureCause ? { cause: error.failureCause } : {}) }
        : { code: "authentication-evidence-incomplete", cause: failureCode(error) }] };
  }
}
