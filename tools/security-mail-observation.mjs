import { setTimeout as delay } from "node:timers/promises";
export const securityMailObservationSource = Object.freeze({
  image: "axllent/mailpit:v1.32",
  version: "1.32.0",
  commit: "ce798cfd781ef07b321427fc5082b3eebdcae460",
  imageDigest: "sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498"
});
import { failureCode } from "./failure-reason.mjs";

export const securityMailObservationLimits = Object.freeze({
  messages: 100, rawBytes: 262144, totalRawBytes: 4 * 1024 * 1024,
  listBytes: 262144, runtimeBytes: 32768, receiptBytes: 8192
});

const opaqueId = /^[A-Za-z0-9]{22}$/;
const messageId = /^<[^<>\s]{1,512}@[^<>\s]{1,255}>$/;
const calendarUid = /^booking-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@courtside$/;
const listUrl = "http://mail:8025/api/v1/messages?start=0&limit=100";
const limits = securityMailObservationLimits;
const addresses = entries => Array.isArray(entries) ? entries.map(entry => entry?.Address) : undefined;
const copiedAddresses = entries => entries === null ? [] : addresses(entries);
export const securityMailObservationImage =
  `${securityMailObservationSource.image}@${securityMailObservationSource.imageDigest}`;
const dockerId = /^[a-f0-9]{64}$/;
const digest = /^sha256:[a-f0-9]{64}$/;

function exact(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validIdentity(identity) {
  return exact(identity, ["seedFingerprint", "instanceFingerprint"])
    && Object.values(identity).every(value => typeof value === "string" && digest.test(value));
}

function privateIPv4(value) {
  if (typeof value !== "string" || isIP(value) !== 4) return false;
  const [first, second] = value.split(".").map(Number);
  return first === 10 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168;
}

function validBinding(binding) {
  return exact(binding, ["sinkId", "imageId", "appId", "backendNetworkId", "sinkIPv4"])
    && [binding.sinkId, binding.appId, binding.backendNetworkId].every(value => typeof value === "string" && dockerId.test(value))
    && typeof binding.imageId === "string" && digest.test(binding.imageId) && privateIPv4(binding.sinkIPv4);
}

function equalBinding(left, right) {
  return validBinding(left) && validBinding(right) && Object.keys(left).every(key => left[key] === right[key]);
}

function context(runId, command, identity) {
  if (typeof runId !== "string" || !/^[a-z0-9][a-z0-9-]{5,47}$/.test(runId)
    || typeof command !== "function" || !validIdentity(identity)) throw new Error("mail-observation-context-invalid");
  return { project: `courtside-security-${runId}`, runId, command, identity: { ...identity } };
}

async function output(ctx, args, bound, input) {
  const result = await ctx.command(args, { outputLimitBytes: bound, acceptedExitCodes: [0], timeoutMilliseconds: 10000,
    ...(input === undefined ? {} : { input }) });
  if ((result?.exitCode !== undefined && result.exitCode !== 0)
    || (result?.code !== undefined && result.code !== 0)
    || result?.truncated || result?.timedOut
    || !(typeof result?.stdout === "string" || Buffer.isBuffer(result?.stdout))
    || Buffer.byteLength(result.stdout) > bound) throw new Error("mail-command-incomplete");
  return result.stdout;
}

function json(raw) {
  return JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : raw);
}

function ownedLabels(labels, ctx, service) {
  return labels?.["org.courtside.environment"] === "SECURITY"
    && labels["org.courtside.security.run-id"] === ctx.runId
    && labels["org.courtside.security.seed-fingerprint"] === ctx.identity.seedFingerprint
    && labels["org.courtside.security.instance-fingerprint"] === ctx.identity.instanceFingerprint
    && labels["com.docker.compose.project"] === ctx.project
    && (service === undefined || labels["com.docker.compose.service"] === service);
}

function ownedContainer(runtime, ctx, service) {
  return runtime?.Name === `/${ctx.project}-${service}-1` && typeof runtime.Id === "string" && dockerId.test(runtime.Id)
    && runtime.State?.Running === true && ownedLabels(runtime.Config?.Labels, ctx, service);
}

function nativeEndpoint(member, name, ip) {
  if (member?.Name !== name || typeof member.IPv4Address !== "string") return false;
  const parts = /^([^/]+)\/([0-9]{1,2})$/.exec(member.IPv4Address);
  return parts && parts[1] === ip && Number(parts[2]) <= 32;
}

async function trustedSink(ctx, expectedBinding) {
  const expectedImage = json(await output(ctx, ["image", "inspect", securityMailObservationImage], limits.runtimeBytes));
  if (!Array.isArray(expectedImage) || expectedImage.length !== 1
    || typeof expectedImage[0]?.Id !== "string" || !digest.test(expectedImage[0].Id)) throw new Error("mail-image-untrusted");
  const runtime = json(await output(ctx, ["inspect", `${ctx.project}-mail-1`], limits.runtimeBytes));
  if (!Array.isArray(runtime) || runtime.length !== 1) throw new Error("mail-sink-untrusted");
  const sink = runtime[0];
  const config = runtime[0]?.Config;
  if (!ownedContainer(sink, ctx, "mail") || sink.Image !== expectedImage[0].Id || config?.Image !== securityMailObservationImage
    || JSON.stringify(config.Entrypoint) !== '["/mailpit"]'
    || (config.Cmd !== null && JSON.stringify(config.Cmd) !== "[]")
    || !Array.isArray(config.Env)) throw new Error("mail-sink-untrusted");
  const env = new Map();
  for (const item of config.Env) {
    if (typeof item !== "string" || !item.includes("=")) throw new Error("mail-sink-untrusted");
    const at = item.indexOf("=");
    const name = item.slice(0, at);
    if (env.has(name)) throw new Error("mail-sink-untrusted");
    env.set(name, item.slice(at + 1));
  }
  if (env.get("MP_MAX_MESSAGES") !== "100"
    || (env.has("MP_USE_MESSAGE_DATES") && env.get("MP_USE_MESSAGE_DATES") !== "false")
    || (env.has("MP_IGNORE_DUPLICATE_IDS") && env.get("MP_IGNORE_DUPLICATE_IDS") !== "false")) {
    throw new Error("mail-sink-untrusted");
  }
  const backendName = `${ctx.project}_backend`;
  const sinkNetworks = sink.NetworkSettings?.Networks;
  const sinkNetwork = sinkNetworks?.[backendName];
  if (!exact(sinkNetworks, [backendName]) || typeof sinkNetwork?.NetworkID !== "string"
    || !dockerId.test(sinkNetwork.NetworkID) || !privateIPv4(sinkNetwork.IPAddress)
    || !Array.isArray(sinkNetwork.Aliases) || !sinkNetwork.Aliases.includes("mail")) throw new Error("mail-network-untrusted");
  const appRuntime = json(await output(ctx, ["inspect", `${ctx.project}-app-1`], limits.runtimeBytes));
  if (!Array.isArray(appRuntime) || appRuntime.length !== 1 || !ownedContainer(appRuntime[0], ctx, "app")) {
    throw new Error("mail-app-untrusted");
  }
  const app = appRuntime[0];
  const appNetworks = app.NetworkSettings?.Networks;
  const appNetwork = appNetworks?.[backendName];
  if (!appNetworks || Object.keys(appNetworks).some(name => ![backendName, `${ctx.project}_frontend`].includes(name))
    || appNetwork?.NetworkID !== sinkNetwork.NetworkID || !privateIPv4(appNetwork.IPAddress)
    || appNetwork.IPAddress === sinkNetwork.IPAddress) throw new Error("mail-network-untrusted");
  const networks = json(await output(ctx, ["network", "inspect", sinkNetwork.NetworkID], limits.runtimeBytes));
  if (!Array.isArray(networks) || networks.length !== 1) throw new Error("mail-network-untrusted");
  const network = networks[0];
  if (network?.Id !== sinkNetwork.NetworkID || network.Name !== backendName || network.Internal !== true
    || !ownedLabels(network.Labels, ctx) || network.Labels["com.docker.compose.network"] !== "backend"
    || !nativeEndpoint(network.Containers?.[sink.Id], `${ctx.project}-mail-1`, sinkNetwork.IPAddress)
    || !nativeEndpoint(network.Containers?.[app.Id], `${ctx.project}-app-1`, appNetwork.IPAddress)) {
    throw new Error("mail-network-untrusted");
  }
  const binding = { sinkId: sink.Id, imageId: sink.Image, appId: app.Id,
    backendNetworkId: network.Id, sinkIPv4: sinkNetwork.IPAddress };
  if (expectedBinding !== undefined && !equalBinding(binding, expectedBinding)) throw new Error("mail-producer-changed");
  return binding;
}

async function get(ctx, url, bound) {
  if (!validBinding(ctx.runtimeBinding)) throw new Error("mail-producer-unbound");
  return output(ctx, ["exec", ctx.runtimeBinding.appId, "curl", "-q", "--silent", "--fail",
    "--noproxy", "*", "--proto", "=http", "--connect-timeout", "2", "--max-time", "5",
    "--max-filesize", String(bound), "--resolve", `mail:8025:${ctx.runtimeBinding.sinkIPv4}`, "--url", url], bound);
}

function instant(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/\D/).map(Number);
  const civil = new Date(0);
  civil.setUTCFullYear(year, month - 1, day);
  civil.setUTCHours(hour, minute, second, 0);
  return civil.getUTCFullYear() === year && civil.getUTCMonth() === month - 1 && civil.getUTCDate() === day
    && civil.getUTCHours() === hour && civil.getUTCMinutes() === minute && civil.getUTCSeconds() === second;
}

async function mailbox(ctx, recipients = false) {
  const native = json(await get(ctx, listUrl, limits.listBytes));
  if (!Array.isArray(native?.messages) || !Number.isSafeInteger(native.total) || native.total < 0
    || native.total > limits.messages || native.start !== 0
    || native.messages_count !== native.total || native.messages.length !== native.total) {
    throw new Error("mail-list-incomplete");
  }
  const ids = new Set();
  return native.messages.map((message) => {
    if (typeof message?.ID !== "string" || !opaqueId.test(message.ID) || ids.has(message.ID) || !instant(message.Created)
      || !Number.isSafeInteger(message.Size) || message.Size <= 0
      || typeof message.MessageID !== "string" || message.MessageID.length > 768) {
      throw new Error("mail-list-incomplete");
    }
    ids.add(message.ID);
    return { id: message.ID, created: message.Created, size: message.Size, messageId: message.MessageID,
      ...(recipients ? { to: addresses(message.To), cc: copiedAddresses(message.Cc), bcc: copiedAddresses(message.Bcc) } : {}) };
  });
}

export async function captureSecurityMailBaseline({ runId, command, identity } = {}) {
  try {
    const ctx = context(runId, command, identity);
    ctx.runtimeBinding = await trustedSink(ctx);
    const messages = await mailbox(ctx);
    await trustedSink(ctx, ctx.runtimeBinding);
    const findings = messages.length === limits.messages ? ["mail-capacity-reached"] : [];
    return { status: findings.length ? "incomplete" : "complete", runId,
      messageIds: messages.map(({ id }) => id), findings, identity: ctx.identity, runtimeBinding: ctx.runtimeBinding };
  } catch (failure) {
    return { status: "incomplete", messageIds: [], findings: ["mail-baseline-incomplete"], causes: [failureCode(failure)] };
  }
}

function validBaseline(baseline, runId) {
  return baseline?.status === "complete" && baseline.runId === runId
    && validIdentity(baseline.identity) && validBinding(baseline.runtimeBinding)
    && Array.isArray(baseline.messageIds) && baseline.messageIds.length < limits.messages
    && baseline.messageIds.every(id => typeof id === "string" && opaqueId.test(id))
    && new Set(baseline.messageIds).size === baseline.messageIds.length;
}

function receipt(parsed, message) {
  if (!parsed || typeof parsed.messageId !== "string" || !messageId.test(parsed.messageId)
    || parsed.messageId.slice(1, -1) !== message.messageId
    || typeof parsed.calendarUid !== "string" || !calendarUid.test(parsed.calendarUid)
    || !instant(parsed.startsAt) || !instant(parsed.endsAt)
    || Date.parse(parsed.endsAt) <= Date.parse(parsed.startsAt)
    || !Array.isArray(parsed.recipients) || parsed.recipients.length !== 1
    || typeof parsed.recipients[0] !== "string" || parsed.recipients[0].length > 254
    || !/^[^<>\s@]+@example\.org$/.test(parsed.recipients[0])) throw new Error("mail-receipt-incomplete");
  return { messageId: parsed.messageId, calendarUid: parsed.calendarUid, startsAt: parsed.startsAt,
    endsAt: parsed.endsAt, recipient: parsed.recipients[0], acceptedAt: message.created };
}

function fingerprint(messages) {
  return JSON.stringify([...messages].sort((a, b) => a.id.localeCompare(b.id)));
}

export async function observeSecurityMail({ runId, command, baseline, identity } = {}) {
  const receipts = [];
  const findings = new Set();
  const causes = new Set();
  const finish = () => ({ status: findings.size ? "incomplete" : "complete", receipts,
    findings: [...findings], ...(causes.size ? { causes: [...causes] } : {}) });
  if (!validBaseline(baseline, runId) || identity !== undefined && (!validIdentity(identity)
    || identity.seedFingerprint !== baseline.identity.seedFingerprint
    || identity.instanceFingerprint !== baseline.identity.instanceFingerprint)) {
    findings.add("mail-baseline-incomplete");
    return finish();
  }
  try {
    const ctx = context(runId, command, baseline.identity);
    ctx.runtimeBinding = await trustedSink(ctx, baseline.runtimeBinding);
    const messages = await mailbox(ctx);
    const ids = new Set(messages.map(({ id }) => id));
    if (baseline.messageIds.some(id => !ids.has(id))) findings.add("mail-baseline-evicted");
    if (messages.length === limits.messages) findings.add("mail-capacity-reached");
    const previous = new Set(baseline.messageIds);
    const added = messages.filter(({ id }) => !previous.has(id));
    if (added.length === 0) findings.add("mail-new-messages-missing");
    let bytes = 0;
    for (const message of added) {
      if (message.size > limits.rawBytes) {
        findings.add("mail-raw-oversized");
        continue;
      }
      if (bytes + message.size > limits.totalRawBytes) {
        findings.add("mail-total-budget-exceeded");
        break;
      }
      bytes += message.size;
      try {
        const raw = await get(ctx, `http://mail:8025/api/v1/message/${message.id}/raw`, message.size);
        if (Buffer.byteLength(raw) !== message.size) throw new Error("mail-raw-truncated");
        const parsed = json(await output(ctx, ["exec", "-i", `${ctx.project}-scanner-gateway-1`,
          "python3", "/opt/courtside/security-mail-receipt.py"], limits.receiptBytes, raw));
        receipts.push(receipt(parsed, message));
      } catch (failure) {
        findings.add("mail-message-incomplete");
        causes.add(failureCode(failure));
      }
    }
    if (fingerprint(messages) !== fingerprint(await mailbox(ctx))) findings.add("mail-snapshot-changed");
    await trustedSink(ctx, baseline.runtimeBinding);
  } catch (failure) {
    receipts.splice(0, receipts.length);
    findings.add("mail-observation-incomplete");
    causes.add(failureCode(failure));
  }
  const counts = new Map();
  const bookings = new Map();
  for (const item of receipts) {
    counts.set(item.messageId, (counts.get(item.messageId) ?? 0) + 1);
    bookings.set(item.calendarUid, (bookings.get(item.calendarUid) ?? 0) + 1);
  }
  if ([...counts.values(), ...bookings.values()].some(count => count > 1)) {
    findings.add("mail-receipt-ambiguous");
    const unique = receipts.filter(item => counts.get(item.messageId) === 1 && bookings.get(item.calendarUid) === 1);
    receipts.splice(0, receipts.length, ...unique);
  }
  return finish();
}
import { isIP } from "node:net";

export async function readSecurityMfaRecoveryCode({ runId, command, identity, username, after, excludedCodes = [] } = {}) {
  if (typeof username !== "string" || !/^security\.(?:member|trainer|sport\.director|youth\.director|groundskeeper|treasurer|admin)\.2$/.test(username)
      || !Number.isFinite(after) || after < 0 || !Array.isArray(excludedCodes) || excludedCodes.length > 200
      || excludedCodes.some(code => typeof code !== "string" || code.length > 128)) throw new Error("mfa-mail-fixture-input-invalid");
  const ctx = context(runId, command, identity);
  ctx.runtimeBinding = await trustedSink(ctx);
  const messages = (await mailbox(ctx)).filter(message => Date.parse(message.created) >= after);
  const holder = new RegExp(`(?<![a-z0-9._-])${username.replaceAll(".", "\\.")}(?![a-z0-9._-])`);
  const codes = new Set();
  let bytes = 0;
  for (const message of messages) {
    if (message.size > limits.rawBytes || bytes + message.size > limits.totalRawBytes) throw new Error("mfa-mail-budget-exceeded");
    bytes += message.size;
    const detail = json(await get(ctx, `http://mail:8025/api/v1/message/${message.id}`, limits.rawBytes));
    if (typeof detail?.Text !== "string" || Buffer.byteLength(detail.Text) > limits.rawBytes) throw new Error("mfa-mail-detail-incomplete");
    if (!holder.test(detail.Text)) continue;
    for (const match of detail.Text.matchAll(/^[2-9A-HJKMNP-TV-Z]{4}(?:-[2-9A-HJKMNP-TV-Z]{4}){5}\r?$/gm)) {
      const code = match[0].replace(/\r$/, "");
      if (!excludedCodes.includes(code)) codes.add(code);
    }
  }
  await trustedSink(ctx, ctx.runtimeBinding);
  if (codes.size > 1) throw new Error("mfa-mail-code-ambiguous");
  return codes.values().next().value;
}

export function createSecurityMfaRecoveryReader({ runId, command, identity, control, wait = delay }) {
  return async (username, options) => {
    for (;;) {
      control.beforeRequest();
      const code = await readSecurityMfaRecoveryCode({ runId, command, identity, username, ...options });
      if (code !== undefined) return code;
      await wait(Math.min(200, control.remainingMilliseconds()), undefined, { signal: control.signal });
    }
  };
}

export async function withSecurityMfaRecoveryReader(control, options, action) {
  try {
    const configuration = options();
    return await action(createSecurityMfaRecoveryReader(configuration), createSecurityMfaMailScope(configuration));
  } finally {
    control.close();
  }
}


const mfaHolder = /^security\.(?:member|trainer|sport\.director|youth\.director|groundskeeper|treasurer|admin)\.2$/;
const mfaKinds = new Set(["ACCOUNT_SECURITY_CHANGED", "ACCOUNT_MFA_RECOVERY_CODE"]);
function checkedOutbox(projection, usernames) {
  if (!projection || typeof projection.watermark !== "string" || !/^(?:0|[1-9][0-9]{0,18})$/.test(projection.watermark)
      || !/^[a-f0-9]{64}$/.test(projection.fingerprint ?? "") || !Array.isArray(projection.records)
      || projection.records.length > limits.messages) throw new Error("mfa-mail-outbox-incomplete");
  const ids = new Set();
  for (const record of projection.records) {
    if (!record || typeof record !== "object" || !usernames.includes(record.username) || record.email !== `${record.username}@example.org`
        || !mfaKinds.has(record.kind) || !["QUEUED", "HANDED_OVER"].includes(record.state)
        || !messageId.test(record.messageId) || ids.has(record.messageId)) throw new Error("mfa-mail-outbox-incomplete");
    ids.add(record.messageId);
  }
  return projection;
}

export function createSecurityMfaMailScope({ runId, command, identity, control, projectOutbox, wait = delay } = {}) {
  return async (usernames) => {
    if (!Array.isArray(usernames) || usernames.length < 1 || usernames.length > 2
        || new Set(usernames).size !== usernames.length || usernames.some(name => typeof name !== "string" || !mfaHolder.test(name))
        || typeof projectOutbox !== "function" || typeof control?.beforeRequest !== "function"
        || typeof control?.remainingMilliseconds !== "function") {
      throw new Error("mfa-mail-scope-invalid");
    }
    control.beforeRequest();
    const ctx = context(runId, command, identity);
    ctx.runtimeBinding = await trustedSink(ctx);
    const baseline = await mailbox(ctx);
    if (baseline.length === limits.messages) throw new Error("mfa-mail-capacity-reached");
    const initial = checkedOutbox(await projectOutbox(null, usernames, ctx.runtimeBinding), usernames);
    if (initial.records.length) throw new Error("mfa-mail-outbox-incomplete");
    const baselineIds = new Set(baseline.map(message => message.id));
    let finished = false;
    return async () => {
      if (finished) throw new Error("mfa-mail-scope-already-finished");
      finished = true;
      let outbox;
      do {
        control.beforeRequest();
        outbox = checkedOutbox(await projectOutbox(initial.watermark, usernames, ctx.runtimeBinding), usernames);
        if (outbox.records.some(record => record.state === "QUEUED")) {
          await wait(Math.min(200, control.remainingMilliseconds()), undefined, { signal: control.signal });
        }
      } while (outbox.records.some(record => record.state === "QUEUED"));
      await trustedSink(ctx, ctx.runtimeBinding);
      const messages = await mailbox(ctx, true);
      const byMessageId = new Map();
      for (const message of messages) {
        const key = `<${message.messageId}>`;
        byMessageId.set(key, [...(byMessageId.get(key) ?? []), message]);
      }
      if (baseline.some(message => !messages.some(current => current.id === message.id))) throw new Error("mfa-mail-baseline-changed");
      const remove = [];
      for (const record of outbox.records) {
        const candidates = byMessageId.get(record.messageId) ?? [];
        if (candidates.length !== 1) throw new Error("mfa-mail-delivery-incomplete");
        const message = candidates[0];
        if (baselineIds.has(message.id) || !Array.isArray(message.to) || message.to.length !== 1
            || message.to[0] !== record.email || !Array.isArray(message.cc) || message.cc.length
            || !Array.isArray(message.bcc) || message.bcc.length) throw new Error("mfa-mail-recipient-untrusted");
        remove.push(message.id);
      }
      if (remove.length) {
        if (new Set(remove).size !== remove.length || remove.length > limits.messages) throw new Error("mfa-mail-delete-invalid");
        control.beforeRequest();
        await output(ctx, ["exec", "-i", ctx.runtimeBinding.appId, "curl", "-q", "--silent", "--fail",
          "--noproxy", "*", "--proto", "=http", "--connect-timeout", "2", "--max-time", "5",
          "--max-filesize", String(limits.receiptBytes), "--resolve", `mail:8025:${ctx.runtimeBinding.sinkIPv4}`,
          "--request", "DELETE", "--header", "content-type: application/json", "--data-binary", "@-",
          "--url", "http://mail:8025/api/v1/messages"], limits.receiptBytes, JSON.stringify({ IDs: remove }));
      }
      await trustedSink(ctx, ctx.runtimeBinding);
      const after = await mailbox(ctx);
      const retained = messages.filter(message => !remove.includes(message.id)).map(message => message.id).sort();
      if (JSON.stringify(after.map(message => message.id).sort()) !== JSON.stringify(retained)) throw new Error("mfa-mail-cleanup-incomplete");
      const final = checkedOutbox(await projectOutbox(initial.watermark, usernames, ctx.runtimeBinding), usernames);
      if (final.fingerprint !== outbox.fingerprint) throw new Error("mfa-mail-application-state-changed");
      return { removedMessages: remove.length, retainedMessages: after.length };
    };
  };
}
