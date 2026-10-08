export const securityMailObservationSource = Object.freeze({
  version: "1.31.3",
  commit: "ae3d9e20e410bf2af1c1b7292bc3b8491b41b30a",
  imageDigest: "sha256:ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d"
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
const imageReference = `axllent/mailpit:v1.31@${securityMailObservationSource.imageDigest}`;
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
  const expectedImage = json(await output(ctx, ["image", "inspect", imageReference], limits.runtimeBytes));
  if (!Array.isArray(expectedImage) || expectedImage.length !== 1
    || typeof expectedImage[0]?.Id !== "string" || !digest.test(expectedImage[0].Id)) throw new Error("mail-image-untrusted");
  const runtime = json(await output(ctx, ["inspect", `${ctx.project}-mail-1`], limits.runtimeBytes));
  if (!Array.isArray(runtime) || runtime.length !== 1) throw new Error("mail-sink-untrusted");
  const sink = runtime[0];
  const config = runtime[0]?.Config;
  if (!ownedContainer(sink, ctx, "mail") || sink.Image !== expectedImage[0].Id || config?.Image !== imageReference
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

async function mailbox(ctx) {
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
    return { id: message.ID, created: message.Created, size: message.Size, messageId: message.MessageID };
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
