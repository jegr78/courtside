import { createHash } from "node:crypto";
import { constants, mkdirSync, lstatSync, openSync, closeSync, writeFileSync, fchmodSync,
  readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { captureResourceState } from "./security-resource-state.mjs";
import { compareResourceIntegrity, resourceIntegritySnapshotFingerprint,
  resourcePublicationLifecycleIsNativeDelete } from "./security-resource-integrity.mjs";
import { planResourceCleanup, verifyResourceCleanup, verifyResourceCleanupPrecondition } from "./security-resource-cleanup.mjs";
import { observeSecurityMail } from "./security-mail-observation.mjs";

export const resourceRuntimeLimits = Object.freeze({ evidenceBytes: 200 * 1024 * 1024,
  snapshotBytes: 32 * 1024 * 1024, journalBytes: 8 * 1024 * 1024, proofBytes: 262144,
  failureReserveBytes: 8192, settlementSamples: 20, settlementIntervalMilliseconds: 1000,
  commandMilliseconds: 10000 });

const handles = new WeakMap();
const evidenceHandles = new WeakMap();
const nativeEvidenceNames = new Set(["before-native.json", "mail-baseline-native.json", "journal-native.log",
  "decoder-binding-native.json", "k6-stdout.log", "k6-stderr.log"]);
const limits = resourceRuntimeLimits;
const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const combine = outcomes => outcomes.includes("failed") ? "failed" : outcomes.every(outcome => outcome === "passed") ? "passed" : "incomplete";

export function createResourceEvidence({ directory, maximumBytes } = {}) {
  try {
    const evidence = privateEvidence(directory, maximumBytes);
    const handle = Object.freeze(Object.create(null));
    evidenceHandles.set(handle, { evidence, directory, maximumBytes, adopted: false, terminal: false, ctx: null });
    return handle;
  } catch { throw new Error("resource-evidence-context-invalid"); }
}

function writeNative(evidence, entry) {
  if (!nativeEvidenceNames.has(entry?.name) || !Number.isSafeInteger(entry.bound)
    || entry.bound < 1 || entry.bound > limits.snapshotBytes) throw new Error("native-evidence-invalid");
  evidence.write(entry.name, entry.value, entry.bound);
}

export function writeNativeEvidence(handle, entry) {
  try {
    const state = evidenceHandles.get(handle);
    if (!state || state.adopted || state.terminal) throw new Error("resource-evidence-handle-invalid");
    writeNative(state.evidence, entry);
  } catch { throw new Error("resource-native-evidence-incomplete"); }
}

export function resourceEvidenceSummary(handle) {
  const state = evidenceHandles.get(handle);
  if (!state) throw new Error("resource-evidence-handle-invalid");
  return state.evidence.summary();
}

export function retainResourceEvidenceFailure(handle, options = {}) {
  const state = evidenceHandles.get(handle);
  if (!state) return { outcome: "incomplete", findings: ["resource-evidence-handle-invalid"] };
  state.terminal = true;
  const phase = ["environment", "before", "pressure", "decoder", "context", "effects", "recovery"].includes(options.phase)
    ? options.phase : "environment";
  const ctx = state.ctx ?? { evidence: state.evidence, findings: new Set(), outcome: "incomplete", integrity: null,
    runId: typeof options.runId === "string" && /^[a-z0-9][a-z0-9-]{5,47}$/.test(options.runId) ? options.runId : null,
    attempt: Number.isSafeInteger(options.attempt) && options.attempt > 0 ? options.attempt : null };
  failure(ctx, phase);
  return summary(ctx, phase);
}

function privateEvidence(directory, maximumBytes) {
  if (typeof directory !== "string" || !isAbsolute(directory) || basename(directory) === ""
    || !Number.isSafeInteger(maximumBytes) || maximumBytes <= limits.failureReserveBytes
    || maximumBytes > limits.evidenceBytes) throw new Error("evidence-context-invalid");
  const path = join(realpathSync(dirname(directory)), basename(directory));
  mkdirSync(path, { mode: 0o700 });
  const identity = lstatSync(path);
  const files = [];
  let bytes = 0;
  const check = () => {
    const current = lstatSync(path);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino
      || (current.mode & 0o777) !== 0o700 || JSON.stringify(readdirSync(path).sort()) !== JSON.stringify(files.map(file => file.name).sort())) {
      throw new Error("evidence-directory-changed");
    }
    for (const file of files) {
      const currentFile = lstatSync(join(path, file.name));
      if (!currentFile.isFile() || currentFile.nlink !== 1 || (currentFile.mode & 0o777) !== 0o600
        || currentFile.size !== file.bytes || hash(readFileSync(join(path, file.name))) !== file.digest) {
        throw new Error("evidence-file-changed");
      }
    }
  };
  const requireCapacity = size => {
    if (bytes + size > maximumBytes - limits.failureReserveBytes) throw new Error("evidence-budget-exceeded");
  };
  const write = (name, value, bound, terminal = false) => {
    check();
    if (!/^[a-z][a-z0-9.-]{0,63}$/.test(name)) throw new Error("evidence-name-invalid");
    const body = typeof value === "string" ? value : JSON.stringify(value) + "\n";
    const size = Buffer.byteLength(body);
    if (size > bound || bytes + size > maximumBytes - (terminal ? 0 : limits.failureReserveBytes)) {
      throw new Error("evidence-budget-exceeded");
    }
    const fd = openSync(join(path, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { fchmodSync(fd, 0o600); writeFileSync(fd, body, "utf8"); }
    finally { closeSync(fd); }
    bytes += size;
    files.push({ name, bytes: size, digest: hash(body) });
  };
  return { write, check, requireCapacity, summary: () => ({ bytes, maximumBytes, files: structuredClone(files) }) };
}

function context(options) {
  const { runId, attempt, command, composeArgs } = options;
  const args = typeof composeArgs === "function" ? composeArgs(runId) : composeArgs;
  if (typeof runId !== "string" || !/^[a-z0-9][a-z0-9-]{5,47}$/.test(runId)
    || !Number.isSafeInteger(attempt) || attempt < 1 || typeof command !== "function"
    || !Array.isArray(args) || args.length !== 5 || args[0] !== "compose" || args[1] !== "-p"
    || args[2] !== `courtside-security-${runId}` || args[3] !== "-f"
    || typeof args[4] !== "string" || !isAbsolute(args[4]) || basename(args[4]) !== "compose.security.yaml") {
    throw new Error("runtime-context-invalid");
  }
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  if (!Number.isSafeInteger(options.outerDeadlineMilliseconds)
    || typeof monotonicNow !== "function") throw new Error("runtime-outer-deadline-invalid");
  const started = monotonicNow();
  if (!Number.isFinite(started)) throw new Error("runtime-clock-invalid");
  const outerRemaining = options.outerDeadlineMilliseconds - Date.now();
  if (outerRemaining <= 0) throw new Error("runtime-outer-deadline-invalid");
  let lastClock = started;
  const clock = () => {
    const current = monotonicNow();
    if (!Number.isFinite(current) || current < lastClock) throw new Error("runtime-clock-invalid");
    lastClock = current;
    return current;
  };
  const samples = options.settlement?.samples ?? 10;
  const interval = options.settlement?.intervalMilliseconds ?? 250;
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > limits.settlementSamples
    || !Number.isSafeInteger(interval) || interval < 0 || interval > limits.settlementIntervalMilliseconds
    || options.wait !== undefined && typeof options.wait !== "function"
    || options.now !== undefined && typeof options.now !== "function") throw new Error("runtime-settlement-invalid");
  const ctx = { runId, attempt, composeArgs: [...args], samples, interval, consumed: false, clock,
    outerEnd: started + outerRemaining,
    wait: options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))),
    now: options.now ?? (() => new Date().toISOString()),
    projectSessions: options.projectAuthentication ?? options.projectSessions, findings: new Set(), outcome: "incomplete", integrity: null };
  ctx.command = async (args, supplied = {}) => {
    const bound = supplied.outputLimitBytes ?? limits.proofBytes;
    const timeoutMilliseconds = Math.floor(Math.min(supplied.timeoutMilliseconds ?? limits.commandMilliseconds,
      limits.commandMilliseconds, (ctx.recoveryEnd ?? ctx.outerEnd) - clock()));
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) throw new Error("runtime-command-bound-invalid");
    const result = await command(args, { ...supplied, outputLimitBytes: bound, timeoutMilliseconds, acceptedExitCodes: [0] });
    if ((ctx.recoveryEnd ?? ctx.outerEnd) - clock() <= 0) throw new Error("runtime-command-deadline-expired");
    if ((result?.exitCode !== undefined && result.exitCode !== 0) || (result?.code !== undefined && result.code !== 0)
      || result?.truncated || result?.timedOut || !(typeof result?.stdout === "string" || Buffer.isBuffer(result?.stdout))
      || Buffer.byteLength(result.stdout) > bound) throw new Error("runtime-command-incomplete");
    return result;
  };
  if (options.evidenceHandle !== undefined) {
    const state = evidenceHandles.get(options.evidenceHandle);
    if (!state || state.adopted || state.terminal
      || options.evidenceDirectory !== undefined && options.evidenceDirectory !== state.directory
      || options.evidenceLimitBytes !== undefined && options.evidenceLimitBytes !== state.maximumBytes) {
      throw new Error("runtime-evidence-handle-invalid");
    }
    state.evidence.check();
    state.adopted = true;
    state.ctx = ctx;
    ctx.evidence = state.evidence;
  } else ctx.evidence = privateEvidence(options.evidenceDirectory, options.evidenceLimitBytes);
  return ctx;
}

function summary(ctx, phase, extra = {}) {
  return { schemaVersion: 1, phase, outcome: ctx.outcome, findings: [...ctx.findings].sort(),
    integrity: ctx.integrity, journalDigest: ctx.journalDigest ?? null,
    stateBefore: ctx.integrity?.beforeFingerprint ?? null, stateAfter: ctx.integrity?.afterFingerprint ?? null,
    integrityEvidenceDigest: ctx.integrityEvidenceDigest ?? null,
    runtimeDigest: ctx.runtimeDigest ?? null, evidence: ctx.evidence.summary(), ...extra };
}

function failure(ctx, phase) {
  ctx.findings.add(`runtime-${phase}-incomplete`);
  if (ctx.outcome !== "failed") ctx.outcome = "incomplete";
  try {
    if (ctx.evidence.summary().files.some(file => file.name === "failure.json")) return;
    ctx.evidence.write("failure.json", { schemaVersion: 1, runId: ctx.runId, attempt: ctx.attempt,
      phase, outcome: ctx.outcome, findings: [...ctx.findings].sort(),
      ...(ctx.recoveryStatus ? { recovery: ctx.recoveryStatus } : {}) }, limits.failureReserveBytes, true);
  } catch { ctx.findings.add("private-evidence-retention-incomplete"); }
}

async function sessions(ctx, snapshot) {
  if (typeof ctx.projectSessions !== "function") return { complete: false, observations: [] };
  try {
    const result = await ctx.projectSessions({ phase: "after", snapshot: structuredClone(snapshot), before: structuredClone(ctx.before),
      journal: structuredClone(ctx.inputJournal), contract: structuredClone(ctx.contract),
      command: ctx.command, runId: ctx.runId });
    const wholeCapture = result?.journal !== undefined || result?.authentication !== undefined;
    const nativeProof = !wholeCapture || result?.journal && result?.authentication && result?.privateProof
      && /^sha256:[a-f0-9]{64}$/.test(result.runtimeDigest);
    const complete = (result?.outcome === "passed" || result?.complete === true) && Boolean(nativeProof);
    const observations = result?.journal?.sessions ?? result?.observations;
    if (!Array.isArray(observations) || observations.some(observation => !["before", "after"].includes(observation?.phase))) {
      return { ...structuredClone(result), complete: false, observations: [], outcome: result?.outcome === "failed" ? "failed" : "incomplete" };
    }
    return { ...structuredClone(result), complete, observations: structuredClone(observations) };
  } catch { return { complete: false, observations: [] }; }
}

function additions(before, after, table) {
  const ids = new Set(before.tables[table].rows.map(row => row.id));
  return after.tables[table].rows.filter(row => !ids.has(row.id));
}

function observeJournal(ctx, after, mail, projections) {
  const journal = structuredClone(projections.journal ?? ctx.inputJournal);
  if (projections.authentication) ctx.contract.authentication = structuredClone(projections.authentication);
  const messages = additions(ctx.before, after, "message_record");
  const publications = additions(ctx.before, after, "event_publication");
  const creates = new Set(journal.operations.filter(operation => operation.kind === "createBooking" && operation.status === 201)
    .map(operation => operation.responseBookingId));
  const wantsMail = ctx.contract.mailEnabled && !ctx.before.tables.message_optout.rows.some(row =>
    row.user_account_id === ctx.contract.managerAccountId && row.kind === "BOOKING_CONFIRMED");
  const expectedMail = wantsMail ? creates.size : 0;
  const emptyObserved = expectedMail === 0 && messages.length === 0 && mail.receipts.length === 0
    && mail.status === "incomplete" && JSON.stringify(mail.findings) === '["mail-new-messages-missing"]';
  const mailComplete = mail.status === "complete" || emptyObserved;
  journal.mailReceipts = mail.receipts.filter(receipt => {
    const matching = messages.filter(message => message.message_id === receipt.messageId);
    return !(matching.length === 1 && matching[0].state === "QUEUED" && matching[0].settled_at === null);
  }).map(receipt => {
    const matching = messages.filter(message => message.message_id === receipt.messageId);
    return { ...receipt, accountId: matching.length === 1 ? matching[0].account_id : null };
  });
  journal.publications = publications.map(row => {
    let serialized;
    try { serialized = JSON.parse(row.serialized_event); } catch { serialized = null; }
    return { id: row.id, listenerId: row.listener_id,
      bookingId: serialized && Object.keys(serialized).length === 1 ? serialized.bookingId : null };
  });
  journal.sessions = projections.observations;
  journal.effectsSettled = resourcePublicationLifecycleIsNativeDelete(ctx.contract.publicationLifecycle)
    && mailComplete && projections.complete
    && messages.length === expectedMail && journal.mailReceipts.length === expectedMail
    && messages.every(row => row.state === "HANDED_OVER" && row.settled_at !== null)
    && publications.length === 0;
  return { journal, mailComplete };
}

export async function observeResourceEffects(options = {}) {
  let ctx;
  try {
    ctx = context(options);
    const nativeEvidence = options.nativeEvidence ?? [];
    const names = new Set(nativeEvidenceNames);
    if (!Array.isArray(nativeEvidence) || nativeEvidence.length > names.size) throw new Error("native-evidence-invalid");
    for (const entry of nativeEvidence) {
      if (!names.delete(entry?.name)) throw new Error("native-evidence-invalid");
      writeNative(ctx.evidence, entry);
    }
    ctx.before = structuredClone(options.before);
    ctx.contract = structuredClone(options.contract);
    ctx.inputJournal = structuredClone(options.journal);
    ctx.mailBaseline = structuredClone(options.mailBaseline);
    ctx.evidence.write("before.json", ctx.before, limits.snapshotBytes);
    ctx.evidence.write("contract.json", ctx.contract, limits.journalBytes);
    ctx.evidence.write("journal-input.json", ctx.inputJournal, limits.journalBytes);
    ctx.evidence.write("mail-baseline.json", ctx.mailBaseline, limits.proofBytes);
    resourceIntegritySnapshotFingerprint(ctx.before);
    if (ctx.inputJournal?.runId !== ctx.runId || ctx.inputJournal.captureComplete !== true) ctx.findings.add("native-journal-incomplete");
    if (!ctx.contract?.authentication?.sessionPolicy
      || ctx.contract.authentication.loginPolicy?.proofMode !== "http-bounded-v1") ctx.findings.add("native-authentication-policy-incomplete");
    for (let sample = 1; sample <= ctx.samples; sample++) {
      if (sample > 1) await ctx.wait(ctx.interval);
      const suffix = String(sample).padStart(3, "0");
      const after = await captureResourceState(ctx.command, ctx.composeArgs);
      const capturedAt = ctx.now();
      if (typeof capturedAt !== "string" || !Number.isFinite(Date.parse(capturedAt))
        || Date.parse(capturedAt) < Date.parse(ctx.contract.interval?.endedAt)
        || !Number.isFinite(Date.parse(ctx.contract.interval?.startedAt))) throw new Error("runtime-capture-clock-invalid");
      ctx.contract.interval.endedAt = capturedAt;
      ctx.evidence.write(`effects-${suffix}.json`, after, limits.snapshotBytes);
      const mail = await observeSecurityMail({ runId: ctx.runId, command: ctx.command,
        baseline: ctx.mailBaseline, identity: ctx.mailBaseline?.identity });
      const projections = await sessions(ctx, after);
      ctx.evidence.write(`mail-${suffix}.json`, mail, limits.journalBytes);
      ctx.evidence.write(`sessions-${suffix}.json`, projections, limits.journalBytes);
      const { journal, mailComplete } = observeJournal(ctx, after, mail, projections);
      ctx.effects = after;
      ctx.journal = journal;
      ctx.journalDigest = hash(JSON.stringify(journal) + "\n");
      ctx.runtimeDigest = /^sha256:[a-f0-9]{64}$/.test(projections.runtimeDigest) ? projections.runtimeDigest : null;
      ctx.integrity = compareResourceIntegrity({ before: ctx.before, after, contract: ctx.contract, journal });
      ctx.outcome = ctx.integrity.outcome === "failed" || projections.outcome === "failed" ? "failed"
        : ctx.findings.size || !mailComplete || !projections.complete ? "incomplete" : ctx.integrity.outcome;
      ctx.evidence.write(`journal-${suffix}.json`, journal, limits.journalBytes);
      ctx.evidence.write(`contract-${suffix}.json`, ctx.contract, limits.journalBytes);
      ctx.evidence.write(`effects-proof-${suffix}.json`, { outcome: ctx.outcome, integrity: ctx.integrity,
        mailComplete, sessionProjectionComplete: projections.complete }, limits.proofBytes);
      ctx.integrityEvidenceDigest = ctx.evidence.summary().files.find(file => file.name === `effects-proof-${suffix}.json`).digest;
      if (ctx.outcome !== "incomplete" || ctx.findings.size || !ctx.inputJournal.complete) break;
    }
    if (ctx.outcome === "incomplete") ctx.findings.add("native-effects-proof-incomplete");
    const result = summary(ctx, "effects");
    ctx.evidence.write("effects-proof.json", result, limits.proofBytes);
    result.evidence = ctx.evidence.summary();
    ctx.integrityEvidenceDigest = result.evidence.files.find(file => file.name === "effects-proof.json").digest;
    result.integrityEvidenceDigest = ctx.integrityEvidenceDigest;
    handles.set(result, ctx);
    return result;
  } catch {
    if (!ctx) {
      const state = evidenceHandles.get(options.evidenceHandle);
      if (state && !state.adopted) return retainResourceEvidenceFailure(options.evidenceHandle,
        { runId: options.runId, attempt: options.attempt, phase: "context" });
      return { schemaVersion: 1, phase: "effects", outcome: "incomplete", findings: ["runtime-context-incomplete"] };
    }
    failure(ctx, "effects");
    return summary(ctx, "effects");
  }
}

async function applicationIdentity(ctx) {
  const result = await ctx.command(["inspect", `courtside-security-${ctx.runId}-app-1`], { outputLimitBytes: limits.proofBytes });
  const value = JSON.parse(result.stdout);
  const app = Array.isArray(value) && value.length === 1 ? value[0] : null;
  const expected = { "com.docker.compose.project": `courtside-security-${ctx.runId}`,
    "com.docker.compose.service": "app", "org.courtside.environment": "SECURITY",
    "org.courtside.security.run-id": ctx.runId,
    "org.courtside.security.seed-fingerprint": ctx.mailBaseline?.identity?.seedFingerprint,
    "org.courtside.security.instance-fingerprint": ctx.mailBaseline?.identity?.instanceFingerprint };
  if (!app || typeof app.Id !== "string" || !/^[a-f0-9]{64}$/.test(app.Id)
    || typeof app.Image !== "string" || !/^sha256:[a-f0-9]{64}$/.test(app.Image)
    || typeof app.Config?.Labels !== "object" || app.Config.Labels === null) {
    throw recoveryError("application-state-missing", "incomplete");
  }
  if (Object.keys(expected).some(key => typeof app.Config.Labels[key] !== "string")) {
    throw recoveryError("application-state-missing", "incomplete");
  }
  if (app.Id !== ctx.mailBaseline?.runtimeBinding?.appId
    || Object.entries(expected).some(([key, value]) => typeof value !== "string" || app.Config.Labels[key] !== value)) {
    throw recoveryError("application-identity-changed", "failed");
  }
  const state = app.State;
  if (!state || typeof state.Running !== "boolean" || typeof state.OOMKilled !== "boolean"
    || typeof state.Status !== "string") throw recoveryError("application-state-missing", "incomplete");
  if (state.OOMKilled || ["exited", "dead"].includes(state.Status) || state.Health?.Status === "unhealthy") {
    throw recoveryError("application-terminal", "failed");
  }
  if (!state.Running || state.Status !== "running" || !["healthy", "starting"].includes(state.Health?.Status)) {
    throw recoveryError("application-state-missing", "incomplete");
  }
  return { identity: hash(JSON.stringify([app.Id, app.Image])), healthy: state.Health.Status === "healthy" };
}

function recoveryError(code, outcome) {
  const error = new Error(code);
  error.recoveryCode = code;
  error.recoveryOutcome = outcome;
  return error;
}

async function waitForRecovery(ctx, original) {
  for (;;) {
    ctx.recoveryStatus.step = "health";
    if (ctx.recoveryEnd - ctx.clock() <= 0) throw recoveryError("health-deadline", "incomplete");
    const app = await applicationIdentity(ctx);
    ctx.recoveryStatus.polls++;
    if (app.identity !== original.identity) throw recoveryError("application-identity-changed", "failed");
    ctx.recoveryStatus.status = app.healthy ? "healthy" : "starting";
    if (app.healthy) return;
    const remaining = ctx.recoveryEnd - ctx.clock();
    if (remaining <= 0) throw recoveryError("health-deadline", "incomplete");
    await ctx.wait(Math.min(3000, remaining));
  }
}

export async function cleanupAndRecoverResourceRuntime({ effects } = {}) {
  const ctx = handles.get(effects);
  if (!ctx || ctx.consumed) return { schemaVersion: 1, phase: "recovery", outcome: "incomplete", findings: ["runtime-effects-handle-invalid"] };
  if (ctx.outcome !== "passed") return summary(ctx, "recovery");
  ctx.consumed = true;
  let cleanup = { outcome: "incomplete", code: "cleanup-not-executed" };
  let recovery = { outcome: "incomplete", code: "recovery-not-executed" };
  try {
    ctx.evidence.check();
    const input = { before: ctx.before, effects: ctx.effects, contract: ctx.contract, journal: ctx.journal };
    const plan = planResourceCleanup(input);
    if (plan.outcome !== "passed") {
      ctx.outcome = plan.outcome; ctx.findings.add("runtime-cleanup-plan-unproven");
      return summary(ctx, "recovery", { cleanup, recovery });
    }
    const current = await captureResourceState(ctx.command, ctx.composeArgs);
    ctx.evidence.write("precleanup.json", current, limits.snapshotBytes);
    const precondition = verifyResourceCleanupPrecondition({ ...input, current });
    const same = resourceIntegritySnapshotFingerprint(current) === resourceIntegritySnapshotFingerprint(ctx.effects);
    if (precondition.outcome !== "passed" || !same) {
      ctx.outcome = precondition.outcome === "incomplete" ? "incomplete" : "failed";
      cleanup = { outcome: ctx.outcome, code: "cleanup-precondition-unproven" };
      ctx.findings.add("runtime-precleanup-state-changed");
      ctx.evidence.write("precleanup-proof.json", { outcome: ctx.outcome, precondition }, limits.proofBytes);
      return summary(ctx, "recovery", { cleanup, recovery });
    }
    const app = await applicationIdentity(ctx);
    ctx.evidence.write("cleanup-plan.json", { outcome: plan.outcome, bookingIds: plan.bookingIds,
      expectedFingerprint: plan.expectedFingerprint, targetFingerprint: plan.targetFingerprint,
      nativeProofRequired: plan.nativeProofRequired }, limits.proofBytes);
    ctx.evidence.requireCapacity((plan.sql ? Buffer.byteLength(plan.sql) : 0) + 2 * limits.snapshotBytes + 4 * limits.proofBytes);
    if (plan.sql) {
      ctx.evidence.write("cleanup.sql", plan.sql, limits.snapshotBytes);
      await ctx.command([...ctx.composeArgs, "exec", "-T", "db", "psql", "-qAt", "-v", "ON_ERROR_STOP=1",
        "-U", "courtside", "-d", "courtside_security"], { input: plan.sql, outputLimitBytes: limits.proofBytes });
    }
    const actual = await captureResourceState(ctx.command, ctx.composeArgs);
    ctx.evidence.write("cleanup.json", actual, limits.snapshotBytes);
    cleanup = verifyResourceCleanup({ ...input, actual });
    ctx.outcome = cleanup.outcome;
    ctx.evidence.write("cleanup-proof.json", cleanup, limits.proofBytes);
    if (ctx.outcome !== "passed") return summary(ctx, "recovery", { cleanup, recovery });
    ctx.recoveryEnd = Math.min(ctx.outerEnd, ctx.clock() + 360000);
    ctx.recoveryStatus = { step: "restart", status: "pending", polls: 0 };
    await ctx.command([...ctx.composeArgs, "restart", "--no-deps", "app"]);
    await waitForRecovery(ctx, app);
    ctx.recoveryStatus.step = "database-ready";
    await ctx.command([...ctx.composeArgs, "exec", "-T", "db", "pg_isready", "-U", "courtside", "-d", "courtside_security"]);
    ctx.recoveryStatus.step = "snapshot";
    const recovered = await captureResourceState(ctx.command, ctx.composeArgs);
    ctx.evidence.write("recovery.json", recovered, limits.snapshotBytes);
    recovery = verifyResourceCleanup({ ...input, actual: recovered });
    ctx.outcome = combine([cleanup.outcome, recovery.outcome]);
    if (recovery.outcome === "failed") ctx.evidence.write("recovery-proof.json", recovery, limits.proofBytes);
    ctx.recoveryStatus.step = "final-identity";
    const recoveredApp = await applicationIdentity(ctx);
    ctx.recoveryStatus.status = recoveredApp.healthy ? "healthy" : "starting";
    if (recoveredApp.identity !== app.identity) {
      recovery.outcome = "failed"; recovery.code = "recovery-application-identity-changed";
    } else if (!recoveredApp.healthy && recovery.outcome !== "failed") {
      recovery.outcome = "incomplete"; recovery.code = "recovery-application-unhealthy";
    }
    ctx.outcome = combine([cleanup.outcome, recovery.outcome]);
    ctx.evidence.write("recovery-status.json", ctx.recoveryStatus, limits.proofBytes);
    if (!ctx.evidence.summary().files.some(file => file.name === "recovery-proof.json")) {
      ctx.evidence.write("recovery-proof.json", recovery, limits.proofBytes);
    }
    const result = summary(ctx, "recovery", { cleanup, recovery });
    ctx.evidence.write("runtime-proof.json", result, limits.proofBytes);
    result.evidence = ctx.evidence.summary();
    ctx.integrityEvidenceDigest = result.evidence.files.find(file => file.name === "runtime-proof.json").digest;
    result.integrityEvidenceDigest = ctx.integrityEvidenceDigest;
    return result;
  } catch (error) {
    const code = error?.recoveryCode;
    const known = ["application-state-missing", "application-identity-changed", "application-terminal", "health-deadline"].includes(code);
    if (ctx.recoveryStatus || known) {
      if (recovery.outcome !== "failed") {
        recovery = { outcome: known ? error.recoveryOutcome : "incomplete",
          code: known ? code : "recovery-command-incomplete" };
      }
      if (ctx.recoveryStatus) ctx.recoveryStatus.status = known ? code : "recovery-command-incomplete";
      ctx.outcome = combine([cleanup.outcome, recovery.outcome]);
    }
    failure(ctx, "recovery");
    return summary(ctx, "recovery", { cleanup, recovery });
  }
}
