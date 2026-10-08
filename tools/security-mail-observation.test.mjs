import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { captureSecurityMailBaseline, observeSecurityMail, securityMailObservationLimits,
  securityMailObservationSource } from "./security-mail-observation.mjs";

const runId = "mail-run-0001";
const id = "0123456789ABCDEFGHIJKL";
const oldId = "1123456789ABCDEFGHIJKL";
const created = "2026-10-08T15:59:59.123Z";
const booking = "00000000-0000-4000-8000-000000000001";
const calendar = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:booking-${booking}@courtside\r\nDTSTART:20261008T160000Z\r\nDTEND:20261008T170000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const raw = `Message-ID: <receipt-1@example.org>\r\nDate: Thu, 1 Jan 2099 00:00:00 +0000\r\nTo: Jane Doe <jane@example.org>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=example\r\n\r\n--example\r\nContent-Type: text/plain\r\n\r\nPrivate body\r\n--example\r\nContent-Type: text/calendar\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(calendar).toString("base64")}\r\n--example--\r\n`;
const parser = fileURLToPath(new URL("./security-mail-receipt.py", import.meta.url));
const project = `courtside-security-${runId}`;
const identity = { seedFingerprint: `sha256:${"1".repeat(64)}`, instanceFingerprint: `sha256:${"2".repeat(64)}` };
const sinkId = "3".repeat(64);
const appId = "4".repeat(64);
const networkId = "5".repeat(64);
const imageId = `sha256:${"6".repeat(64)}`;
const sinkIp = "172.30.0.3";
const labels = (service) => ({ "org.courtside.environment": "SECURITY", "org.courtside.security.run-id": runId,
  "org.courtside.security.seed-fingerprint": identity.seedFingerprint,
  "org.courtside.security.instance-fingerprint": identity.instanceFingerprint,
  "com.docker.compose.project": project, ...(service ? { "com.docker.compose.service": service } : {}) });

const summary = (ID = id, extra = {}) => ({ ID, MessageID: "receipt-1@example.org", Read: false,
  From: { Name: "John Roe", Address: "john@example.org" }, To: [{ Name: "Jane Doe", Address: "jane@example.org" }],
  Cc: [], Bcc: [], ReplyTo: [], Subject: "Example booking", Created: created, Username: "", Tags: [],
  Size: Buffer.byteLength(raw), Attachments: 1, Snippet: "Private body", ...extra });
const list = (messages) => JSON.stringify({ total: messages.length, unread: messages.length,
  count: messages.length, messages_count: messages.length, messages_unread: messages.length,
  start: 0, tags: [], messages });
const inspect = () => [{ Id: sinkId, Image: imageId, Name: `/${project}-mail-1`, State: { Running: true },
  Config: { Image: `axllent/mailpit:v1.31@${securityMailObservationSource.imageDigest}`,
    Env: ["MP_MAX_MESSAGES=100"], Entrypoint: ["/mailpit"], Cmd: null, Labels: labels("mail") },
  NetworkSettings: { Networks: { [`${project}_backend`]: { NetworkID: networkId, IPAddress: sinkIp,
    Aliases: ["mail", `${project}-mail-1`] } } } }];
const appInspect = () => [{ Id: appId, Name: `/${project}-app-1`, State: { Running: true },
  Config: { Labels: labels("app") }, NetworkSettings: { Networks: {
    [`${project}_backend`]: { NetworkID: networkId, IPAddress: "172.30.0.4" },
    [`${project}_frontend`]: { NetworkID: "7".repeat(64), IPAddress: "172.31.0.4" }
  } } }];
const networkInspect = () => [{ Id: networkId, Name: `${project}_backend`, Internal: true,
  Labels: { ...labels(), "com.docker.compose.network": "backend" }, Containers: {
    [sinkId]: { Name: `${project}-mail-1`, IPv4Address: `${sinkIp}/24` },
    [appId]: { Name: `${project}-app-1`, IPv4Address: "172.30.0.4/24" }
  } }];

function harness({ lists = [list([]), list([summary()]), list([summary()])], body = raw,
  runtime = inspect(), appRuntime = appInspect(), networkRuntime = networkInspect(),
  imageRuntime = [{ Id: imageId }], failure, parserOutput } = {}) {
  const calls = [];
  let baselineList;
  const command = async (args, options = {}) => {
    calls.push({ args, options });
    if (failure) throw new Error(failure);
    if (args[0] === "image") return { stdout: JSON.stringify(imageRuntime) };
    if (args[0] === "network") return { stdout: JSON.stringify(networkRuntime) };
    if (args[0] === "inspect") return { stdout: JSON.stringify(args[1].endsWith("-app-1") ? appRuntime : runtime) };
    if (args.includes("curl")) {
      return { stdout: args.at(-1).endsWith("/raw") ? body : baselineList ?? lists.shift() };
    }
    assert.deepEqual(args, ["exec", "-i", `courtside-security-${runId}-scanner-gateway-1`,
      "python3", "/opt/courtside/security-mail-receipt.py"]);
    if (parserOutput !== undefined) return { stdout: parserOutput };
    const parsed = spawnSync("python3", [parser], { input: options.input, encoding: "utf8" });
    if (parsed.status !== 0) throw new Error(`Private parser failure: ${body}`);
    return { stdout: parsed.stdout };
  };
  const baseline = async (messageIds = []) => {
    baselineList = list(messageIds.map((value) => summary(value)));
    try { return await captureSecurityMailBaseline({ runId, command, identity }); }
    finally { baselineList = undefined; }
  };
  return { command, calls, baseline };
}

test("given the pinned Mailpit source, when reading the API contract, then bind raw routes and timestamp semantics to its exact release", () => {
  // given / when
  const source = securityMailObservationSource;
  // then
  assert.equal(source.version, "1.31.3");
  assert.equal(source.commit, "ae3d9e20e410bf2af1c1b7292bc3b8491b41b30a");
  assert.equal(source.imageDigest, "sha256:ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d");
  assert.ok(readFileSync(new URL("../deploy/compose.security.yaml", import.meta.url), "utf8")
    .includes(`axllent/mailpit:v1.31@${source.imageDigest}`));
});

test("given a baseline and a native MIME confirmation, when observing new mail, then return only a private receipt with the sink creation time", async () => {
  // given
  const h = harness({ lists: [list([summary(oldId)]), list([summary(), summary(oldId)]), list([summary(), summary(oldId)])] });
  const baseline = await captureSecurityMailBaseline({ runId, command: h.command, identity });
  // when
  const result = await observeSecurityMail({ runId, command: h.command, baseline });
  // then
  assert.equal(baseline.status, "complete");
  assert.deepEqual(baseline.messageIds, [oldId]);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.receipts, [{ messageId: "<receipt-1@example.org>", calendarUid: `booking-${booking}@courtside`,
    startsAt: "2026-10-08T16:00:00.000Z", endsAt: "2026-10-08T17:00:00.000Z",
    recipient: "jane@example.org", acceptedAt: created }]);
  assert.doesNotMatch(JSON.stringify(result), /Private body|2099|Snippet|Subject/);
  const http = h.calls.filter(({ args }) => args.includes("curl"));
  assert.equal(http.filter(({ args }) => args.at(-1).endsWith("/raw")).length, 1);
  for (const { args, options } of http) {
    assert.equal(args[1], appId);
    assert.equal(args[args.indexOf("--resolve") + 1], `mail:8025:${sinkIp}`);
    assert.match(args.at(-1), /^http:\/\/mail:8025\/api\/v1\/(?:messages\?start=0&limit=100|message\/[A-Za-z0-9]{22}\/raw)$/);
    assert.ok(args.includes("--max-filesize"));
    assert.ok(args.includes("--noproxy"));
    assert.ok(!args.includes("--location"));
    assert.ok(options.outputLimitBytes <= 262144);
  }
  assert.equal(h.calls.find(({ args }) => args.includes("python3")).options.input, raw);
});

test("given malformed opaque IDs, when reading the mailbox, then never construct an attacker selected raw route", async () => {
  // given
  for (const ID of ["latest", "../../api", "x?secret", "x\nhttp://foreign", "a".repeat(23)]) {
    const h = harness({ lists: [list([summary(ID)])] });
    // when
    const result = await captureSecurityMailBaseline({ runId, command: h.command, identity });
    // then
    assert.equal(result.status, "incomplete");
    assert.ok(!h.calls.some(({ args }) => args.at(-1).endsWith("/raw")));
  }
});

test("given evicted duplicate truncated or capacity limited messages, when observing the mailbox, then retain incomplete coverage", async () => {
  // given
  const cases = [list([summary()]), list([summary(), summary(), summary(oldId)]),
    JSON.stringify({ total: 2, messages_count: 2, start: 0, messages: [summary(oldId)] }),
    list(Array.from({ length: 100 }, (_, i) => summary(String(i).padStart(22, "0"))))];
  for (const response of cases) {
    const h = harness({ lists: [response, response] });
    const baseline = await h.baseline([oldId]);
    // when
    const result = await observeSecurityMail({ runId, command: h.command, baseline });
    // then
    assert.equal(result.status, "incomplete");
    assert.ok(result.findings.length > 0);
  }
});

test("given an oversized or truncated raw message, when reading it, then reject before invoking the parser", async () => {
  // given
  for (const body of ["x".repeat(262145), raw.slice(0, -1)]) {
    const h = harness({ lists: [list([summary()])], body });
    // when
    const result = await observeSecurityMail({ runId, command: h.command,
      baseline: await h.baseline() });
    // then
    assert.equal(result.status, "incomplete");
    assert.ok(!h.calls.some(({ args }) => args.includes("python3")));
  }
});

test("given new mail exceeding the total byte budget, when observing it, then stop raw retrieval at the fixed bound", async () => {
  // given
  const body = raw + " ".repeat(262144 - Buffer.byteLength(raw));
  const messages = Array.from({ length: 20 }, (_, i) => summary(String(i).padStart(22, "0"), { Size: 262144 }));
  const h = harness({ lists: [list(messages), list(messages)], body });
  // when
  const result = await observeSecurityMail({ runId, command: h.command,
    baseline: await h.baseline() });
  // then
  assert.equal(result.status, "incomplete");
  assert.ok(h.calls.filter(({ args }) => args.at(-1).endsWith("/raw")).length * 262144
    <= securityMailObservationLimits.totalRawBytes);
});

test("given an ambiguous MIME confirmation, when the native parser rejects it, then expose no raw error or message data", async () => {
  // given
  const body = raw.replace("Message-ID:", "Message-ID: <other@example.org>\r\nMessage-ID:");
  const h = harness({ lists: [list([summary(id, { Size: Buffer.byteLength(body) })])], body });
  // when
  const result = await observeSecurityMail({ runId, command: h.command,
    baseline: await h.baseline() });
  // then
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.receipts, []);
  assert.doesNotMatch(JSON.stringify(result), /Private|other@example|Date:|Message-ID:/);
});

test("given an untrusted sink runtime, when taking a baseline, then refuse header derived timestamps and foreign images", async () => {
  // given
  for (const change of [c => c.Env.push("MP_USE_MESSAGE_DATES=true"),
    c => { c.Image = "foreign/mailpit:latest"; }, c => { c.Cmd = ["--use-message-dates"]; },
    c => c.Env.push("MP_IGNORE_DUPLICATE_IDS=true"),
    c => c.Env.push("MP_USE_MESSAGE_DATES=false", "MP_USE_MESSAGE_DATES=true")]) {
    const runtime = inspect(); change(runtime[0].Config);
    const h = harness({ runtime });
    // when
    const result = await captureSecurityMailBaseline({ runId, command: h.command, identity });
    // then
    assert.equal(result.status, "incomplete");
    assert.ok(!h.calls.some(({ args }) => args.includes("curl")));
  }
});

test("given missing mail or a changed final snapshot, when observation finishes, then never qualify incomplete collection", async () => {
  // given
  for (const lists of [[list([])], [list([summary()]), list([])]]) {
    const h = harness({ lists });
    // when
    const result = await observeSecurityMail({ runId, command: h.command,
      baseline: await h.baseline() });
    // then
    assert.equal(result.status, "incomplete");
  }
});

test("given invalid or foreign baselines, when observing mail, then execute no commands", async () => {
  // given
  for (const baseline of [null, { status: "incomplete", runId, messageIds: [] },
    { status: "complete", runId: "foreign-run", messageIds: [] },
    { status: "complete", runId, messageIds: ["../raw"] }]) {
    const h = harness();
    // when
    const result = await observeSecurityMail({ runId, command: h.command, baseline });
    // then
    assert.equal(result.status, "incomplete");
    assert.equal(h.calls.length, 0);
  }
});

test("given command failures containing secrets, when collection fails, then return only a stable incomplete finding", async () => {
  // given
  const h = harness({ failure: "password=private-token To: jane@example.org" });
  // when
  const result = await captureSecurityMailBaseline({ runId, command: h.command, identity });
  // then
  assert.equal(result.status, "incomplete");
  assert.doesNotMatch(JSON.stringify(result), /password|private-token|jane@example/);
});

test("given a failed baseline collection, when it is reported, then it names the failure without its text", async () => {
  // given
  const secret = harness({ failure: "password=private-token To: jane@example.org" });
  const coded = harness({ failure: "mail-list-incomplete" });
  // when
  const fromText = await captureSecurityMailBaseline({ runId, command: secret.command, identity });
  const fromCode = await captureSecurityMailBaseline({ runId, command: coded.command, identity });
  // then
  assert.deepEqual(fromText.causes, ["Error"], "a failure with free text is named by its type alone");
  assert.deepEqual(fromCode.causes, ["mail-list-incomplete"], "a failure the module coded keeps its code");
  assert.doesNotMatch(JSON.stringify(fromText), /password|private-token|jane@example/);
});

test("given a failed collection after a valid baseline, when observing mail, then it names the failure without its text", async () => {
  // given
  const baseline = await harness().baseline();
  const failing = harness({ failure: "password=private-token To: jane@example.org" });
  // when
  const result = await observeSecurityMail({ runId, command: failing.command, baseline });
  // then
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.causes, ["Error"], "the observation says it failed on an error instead of only that it failed");
  assert.doesNotMatch(JSON.stringify(result), /password|private-token|jane@example/);
});

test("given native message summaries with missing creation times, when collecting mail, then never substitute the sender date or current time", async () => {
  // given
  for (const Created of [undefined, "", "2099-02-30T12:00:00Z", "2026-10-08T25:00:00Z", "not-a-date"]) {
    const h = harness({ lists: [list([summary(id, { Created, Date: created })])] });
    // when
    const result = await captureSecurityMailBaseline({ runId, command: h.command, identity });
    // then
    assert.equal(result.status, "incomplete");
    assert.ok(!h.calls.some(({ args }) => args.includes("python3")));
  }
});

test("given a forged small raw size, when downloading mail, then limit the actual transfer to the advertised bytes", async () => {
  // given
  const h = harness({ lists: [list([summary(id, { Size: 1 })])], body: "x".repeat(262144) });
  // when
  const result = await observeSecurityMail({ runId, command: h.command,
    baseline: await h.baseline() });
  // then
  assert.equal(result.status, "incomplete");
  const request = h.calls.find(({ args }) => args.at(-1).endsWith("/raw"));
  assert.equal(request.options.outputLimitBytes, 1);
  assert.equal(request.args[request.args.indexOf("--max-filesize") + 1], "1");
  assert.ok(!h.calls.some(({ args }) => args.includes("python3")));
});

test("given two stored confirmations sharing a Message-ID or booking UID, when reading both native MIME messages, then remove ambiguous receipts", async () => {
  // given
  for (const body of [raw, raw.replaceAll("receipt-1@example.org", "receipt-2@example.org")]) {
    const messages = [summary(), summary(oldId, { MessageID: body === raw ? "receipt-1@example.org" : "receipt-2@example.org",
      Size: Buffer.byteLength(body) })];
    const h = harness({ lists: [list(messages), list(messages)] });
    const original = h.command;
    const command = async (args, options) => {
      if (args.at(-1).endsWith(`/message/${oldId}/raw`)) {
        h.calls.push({ args, options });
        return { stdout: body };
      }
      return original(args, options);
    };
    // when
    const result = await observeSecurityMail({ runId, command,
      baseline: await h.baseline() });
    // then
    assert.equal(result.status, "incomplete");
    assert.deepEqual(result.receipts, []);
    assert.ok(result.findings.includes("mail-receipt-ambiguous"));
  }
});

test("given invalid parser output, when projecting the private receipt, then reject foreign recipients mismatched IDs and malformed event bounds", async () => {
  // given
  const parsed = { messageId: "<receipt-1@example.org>", calendarUid: `booking-${booking}@courtside`,
    startsAt: "2026-10-08T16:00:00.000Z", endsAt: "2026-10-08T17:00:00.000Z", recipients: ["jane@example.org"] };
  for (const change of [{ messageId: "<foreign@example.org>" }, { calendarUid: "other" },
    { recipients: ["jane@example.org", "john@example.org"] }, { recipients: ["jane@foreign.org"] },
    { startsAt: "2026-02-30T12:00:00Z" }, { endsAt: parsed.startsAt }]) {
    const h = harness({ lists: [list([summary()]), list([summary()])], parserOutput: JSON.stringify({ ...parsed, ...change }) });
    // when
    const result = await observeSecurityMail({ runId, command: h.command,
      baseline: await h.baseline() });
    // then
    assert.equal(result.status, "incomplete");
    assert.deepEqual(result.receipts, []);
  }
});

test("given malformed oversized or explicitly truncated command output, when collecting a baseline, then reject partial results without retaining their contents", async () => {
  // given
  for (const result of [{ stdout: "{not json Private body" }, { stdout: "x".repeat(32769) },
    { stdout: JSON.stringify(inspect()), truncated: true }, { stdout: JSON.stringify(inspect()), exitCode: 1 }]) {
    // when
    const baseline = await captureSecurityMailBaseline({ runId, command: async () => result, identity });
    // then
    assert.equal(baseline.status, "incomplete");
    assert.doesNotMatch(JSON.stringify(baseline), /Private body|not json/);
  }
});

test("given a foreign or injected run identity, when beginning observation, then never select a container", async () => {
  // given
  const h = harness();
  // when
  const result = await captureSecurityMailBaseline({ runId: "../../foreign;echo private", command: h.command });
  // then
  assert.equal(result.status, "incomplete");
  assert.equal(h.calls.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /foreign|private/);
});

test("given non ASCII MIME bytes, when passing raw mail to the mounted parser, then preserve bytes and measure the byte budget correctly", async () => {
  // given
  const body = Buffer.from(raw.replace("Private body", "Example café"));
  const messages = [summary(id, { Size: body.length })];
  const h = harness({ lists: [list(messages), list(messages)], body });
  // when
  const result = await observeSecurityMail({ runId, command: h.command,
    baseline: await h.baseline() });
  // then
  assert.equal(result.status, "complete");
  assert.equal(result.receipts[0].acceptedAt, created);
  assert.equal(h.calls.find(({ args }) => args.includes("python3")).options.input, body);
  assert.equal(h.calls.find(({ args }) => args.at(-1).endsWith("/raw")).options.outputLimitBytes, body.length);
});

test("given trusted environment identity, when capturing a native baseline, then bind actual image containers and owned backend without mutating the caller", async () => {
  // given
  const h = harness();
  const original = structuredClone(identity);
  // when
  const baseline = await h.baseline();
  // then
  assert.equal(baseline.status, "complete");
  assert.deepEqual(baseline.identity, identity);
  assert.notEqual(baseline.identity, identity);
  assert.deepEqual(baseline.runtimeBinding, { sinkId, imageId, appId, backendNetworkId: networkId, sinkIPv4: sinkIp });
  assert.deepEqual(identity, original);
  assert.ok(h.calls.some(({ args }) => JSON.stringify(args) === JSON.stringify([
    "image", "inspect", `axllent/mailpit:v1.31@${securityMailObservationSource.imageDigest}`])));
});

for (const [name, change] of [
  ["wrong actual image ID", (value) => { value.runtime[0].Image = `sha256:${"9".repeat(64)}`; }],
  ["foreign seed", (value) => { value.runtime[0].Config.Labels["org.courtside.security.seed-fingerprint"] = `sha256:${"9".repeat(64)}`; }],
  ["foreign instance", (value) => { value.runtime[0].Config.Labels["org.courtside.security.instance-fingerprint"] = `sha256:${"9".repeat(64)}`; }],
  ["foreign project", (value) => { value.runtime[0].Config.Labels["com.docker.compose.project"] = "courtside-uat-example"; }],
  ["foreign environment", (value) => { value.runtime[0].Config.Labels["org.courtside.environment"] = "UAT"; }],
  ["foreign run", (value) => { value.runtime[0].Config.Labels["org.courtside.security.run-id"] = "foreign-run-0001"; }],
  ["foreign app instance", (value) => { value.appRuntime[0].Config.Labels["org.courtside.security.instance-fingerprint"] = `sha256:${"9".repeat(64)}`; }],
  ["missing mail alias", (value) => { value.runtime[0].NetworkSettings.Networks[`${project}_backend`].Aliases = ["foreign"]; }],
  ["foreign shared network ID", (value) => { value.appRuntime[0].NetworkSettings.Networks[`${project}_backend`].NetworkID = "9".repeat(64); }],
  ["sink external network", (value) => { value.runtime[0].NetworkSettings.Networks.foreign = { NetworkID: "9".repeat(64) }; }],
  ["foreign network project", (value) => { value.networkRuntime[0].Labels["com.docker.compose.project"] = "foreign"; }],
  ["noninternal backend", (value) => { value.networkRuntime[0].Internal = false; }],
  ["missing endpoint membership", (value) => { delete value.networkRuntime[0].Containers[sinkId]; }],
  ["wrong native endpoint IP", (value) => { value.networkRuntime[0].Containers[sinkId].IPv4Address = "172.30.0.9/24"; }],
  ["external sink IP", (value) => { value.runtime[0].NetworkSettings.Networks[`${project}_backend`].IPAddress = "8.8.8.8"; }],
  ["option-like sink IP", (value) => { value.runtime[0].NetworkSettings.Networks[`${project}_backend`].IPAddress = "--connect-to"; }]
]) test(`given ${name}, when capturing a mail baseline, then no API query can qualify a foreign producer`, async () => {
  // given
  const value = { runtime: inspect(), appRuntime: appInspect(), networkRuntime: networkInspect() };
  change(value);
  const h = harness(value);
  // when
  const baseline = await captureSecurityMailBaseline({ runId, command: h.command, identity });
  // then
  assert.equal(baseline.status, "incomplete");
  assert.ok(!h.calls.some(({ args }) => args.includes("curl")));
  assert.equal(baseline.runtimeBinding, undefined);
  assert.doesNotMatch(JSON.stringify(baseline), /172\.30|sha256|courtside-uat/);
});

for (const supplied of [undefined, true, {}, { ...identity, extra: true },
  { ...identity, seedFingerprint: "foreign" }, { ...identity, instanceFingerprint: "" }]) {
  test(`given invalid trusted identity ${JSON.stringify(supplied)}, when capturing a baseline, then execute no native commands`, async () => {
    // given
    const h = harness();
    // when
    const result = await captureSecurityMailBaseline({ runId, command: h.command, identity: supplied });
    // then
    assert.equal(result.status, "incomplete");
    assert.equal(h.calls.length, 0);
  });
}

test("given a replaced producer after baseline capture, when observing actual mail, then reject even identical labels and image", async () => {
  // given
  const h = harness();
  const baseline = await h.baseline();
  const runtime = inspect();
  runtime[0].Id = "9".repeat(64);
  const networkRuntime = networkInspect();
  networkRuntime[0].Containers[runtime[0].Id] = networkRuntime[0].Containers[sinkId];
  delete networkRuntime[0].Containers[sinkId];
  const replacement = harness({ runtime, networkRuntime });
  // when
  const result = await observeSecurityMail({ runId, baseline, command: replacement.command });
  // then
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.receipts, []);
  assert.ok(!replacement.calls.some(({ args }) => args.includes("curl")));
});

test("given foreign instance labels after baseline capture, when observing mail again, then native identity drift remains incomplete", async () => {
  // given
  const h = harness();
  const baseline = await h.baseline();
  const runtime = inspect();
  runtime[0].Config.Labels["org.courtside.security.instance-fingerprint"] = `sha256:${"9".repeat(64)}`;
  const foreign = harness({ runtime });
  // when
  const result = await observeSecurityMail({ runId, baseline, command: foreign.command });
  // then
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.receipts, []);
  assert.ok(!foreign.calls.some(({ args }) => args.includes("curl")));
});

test("given a producer changing during collection, when final identity is checked, then discard unbound private receipts", async () => {
  // given
  const h = harness({ lists: [list([summary()]), list([summary()])] });
  const baseline = await h.baseline();
  let inspections = 0;
  const command = async (args, options) => {
    const result = await h.command(args, options);
    if (args[0] === "inspect" && args[1].endsWith("-mail-1") && ++inspections === 2) {
      const runtime = JSON.parse(result.stdout);
      runtime[0].Config.Labels["org.courtside.security.instance-fingerprint"] = `sha256:${"9".repeat(64)}`;
      return { stdout: JSON.stringify(runtime) };
    }
    return result;
  };
  // when
  const result = await observeSecurityMail({ runId, baseline, command });
  // then
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.receipts, []);
});

test("given a legacy baseline without native identity, when observing mail, then never invoke a command", async () => {
  // given
  const h = harness();
  const baseline = { status: "complete", runId, messageIds: [], findings: [] };
  // when
  const result = await observeSecurityMail({ runId, baseline, command: h.command });
  // then
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.receipts, []);
  assert.equal(h.calls.length, 0);
});

test("given foreign caller identity at observation, when the native baseline was captured, then refuse to rebind its environment", async () => {
  // given
  const h = harness();
  const baseline = await h.baseline();
  h.calls.length = 0;
  // when
  const result = await observeSecurityMail({ runId, baseline, command: h.command,
    identity: { ...identity, instanceFingerprint: `sha256:${"9".repeat(64)}` } });
  // then
  assert.equal(result.status, "incomplete");
  assert.equal(h.calls.length, 0);
});

test("given a baseline producer changing during capture, when native identity is checked again, then never retain a qualified binding", async () => {
  // given
  const h = harness();
  let inspections = 0;
  const command = async (args, options) => {
    const result = await h.command(args, options);
    if (args[0] === "inspect" && args[1].endsWith("-mail-1") && ++inspections === 2) {
      const runtime = JSON.parse(result.stdout);
      runtime[0].Image = `sha256:${"9".repeat(64)}`;
      return { stdout: JSON.stringify(runtime) };
    }
    return result;
  };
  // when
  const result = await captureSecurityMailBaseline({ runId, command, identity });
  // then
  assert.equal(result.status, "incomplete");
  assert.equal(result.runtimeBinding, undefined);
});
