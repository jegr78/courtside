import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, connect } from "node:tls";
import { once } from "node:events";
import { createSecurityMailCertificate, securityMailTrustPlan } from "./security-mail-capture.mjs";

const script = fileURLToPath(new URL("./security-mail-receipt.py", import.meta.url));
const identifier = "30000000-0000-0000-0000-000000000001";
const calendar = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:booking-${identifier}@courtside\r\nDTSTART:20261008T160000Z\r\nDTEND:20261008T170000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const mail = (content, encoding = "base64") => `Message-ID: <receipt-1@example.org>\r\nTo: Jane Doe <jane@example.org>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=example-boundary\r\n\r\n--example-boundary\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nExample message\r\n--example-boundary\r\nContent-Type: text/calendar; charset=utf-8\r\nContent-Transfer-Encoding: ${encoding}\r\n\r\n${content}\r\n--example-boundary--\r\n`;

test("given a candidate and a private relay identity, when importing trust, then use a bounded offline container without changing heap or TLS validation", () => {
  // given
  const digest = `sha256:${"a".repeat(64)}`;
  // when
  const plan = securityMailTrustPlan("/private/courtside/mail", digest, "1000:1000", {
    runId: "relay-run-0001", seedFingerprint: digest, instanceFingerprint: digest
  });
  // then
  assert.equal(plan.command, "docker");
  assert.equal(plan.args[plan.args.indexOf("--network") + 1], "none");
  assert.equal(plan.args[plan.args.indexOf("--user") + 1], "1000:1000");
  assert.equal(plan.args[plan.args.indexOf("--memory") + 1], "128m");
  assert.equal(plan.args[plan.args.indexOf("--pids-limit") + 1], "32");
  assert.equal(plan.args[plan.args.indexOf("--entrypoint") + 1], "/opt/java/openjdk/bin/keytool");
  assert.ok(plan.args.includes(digest));
  assert.ok(plan.args.includes("/trust/cert.pem"));
  assert.ok(plan.args.includes("/trust/mail.p12"));
  assert.ok(plan.args.includes("com.docker.compose.project=courtside-security-relay-run-0001"));
  assert.doesNotMatch(JSON.stringify(plan), /Xmx|MaxRAMPercentage|ssl\.trust|checkserveridentity/);
});

test("given the security mail sink, when reading its deployment, then keep relay data internal and preserve application memory limits", () => {
  // given
  const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");
  const compose = yaml.load(readFileSync(new URL("../deploy/compose.security.yaml", import.meta.url), "utf8"));
  // when
  const sink = compose.services.mail;
  // then
  assert.match(sink?.image ?? "", /^axllent\/mailpit:v1\.31@sha256:[a-f0-9]{64}$/);
  assert.equal(sink.ports, undefined);
  assert.deepEqual(sink.networks, ["backend"]);
  assert.equal(sink.read_only, true);
  assert.equal(sink.mem_limit, "128m");
  assert.equal(sink.cpus, 0.25);
  assert.equal(sink.pids_limit, 32);
  assert.deepEqual(sink.cap_drop, ["ALL"]);
  assert.equal(sink.environment.MP_SMTP_REQUIRE_STARTTLS, "true");
  assert.equal(compose.services.app.mem_limit, "1g");
  assert.equal(compose.services.app.cpus, 1);
  assert.equal(compose.services.app.environment.COURTSIDE_MAIL_RELAY_HOST, "mail");
  assert.equal(compose.services.app.environment.COURTSIDE_MAIL_TRUST_RELAY_CERTIFICATE, undefined);
  assert.match(compose.services.app.environment.JAVA_TOOL_OPTIONS, /javax\.net\.ssl\.trustStore=\/trust\/mail\.p12/);
  assert.doesNotMatch(compose.services.app.environment.JAVA_TOOL_OPTIONS, /Xmx|MaxRAMPercentage|mail\.smtp\.ssl\.trust|checkserveridentity=false/);
});

test("given a locally issued relay certificate, when checking its real TLS peer, then accept the fixture CA and mail hostname and reject a different host", async () => {
  // given
  const directory = join(mkdtempSync(join(tmpdir(), "courtside-mail-state-")), "mail");
  const identity = createSecurityMailCertificate(directory);
  const certificate = readFileSync(join(directory, "cert.pem"));
  const key = readFileSync(join(directory, "key.pem"));
  const server = createServer({ cert: certificate, key }, (socket) => socket.end());
  server.on("tlsClientError", () => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const dial = (servername) => new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: address.port, servername, ca: certificate }, () => {
      socket.end(); resolve(socket.authorized);
    });
    socket.once("error", reject);
  });
  try {
    // when / then
    assert.equal(await dial("mail"), true);
    await assert.rejects(dial("foreign.example.org"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    assert.match(identity.fingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.equal(statSync(join(directory, "key.pem")).mode & 0o777, 0o600);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.throws(() => createSecurityMailCertificate(directory), /exist/);
  } finally {
    await new Promise((resolve, reject) => server.close((failure) => failure ? reject(failure) : resolve()));
  }
});

test("given a MIME-encoded booking confirmation, when extracting its receipt, then correlate the Message-ID and unfolded calendar without returning the body", () => {
  // given
  const folded = calendar.replace("@courtside", "@court\r\n side");
  const raw = mail(Buffer.from(folded).toString("base64"));
  // when
  const parsed = JSON.parse(execFileSync("python3", [script], { input: raw, encoding: "utf8" }));
  // then
  assert.deepEqual(parsed, { messageId: "<receipt-1@example.org>", calendarUid: `booking-${identifier}@courtside`,
    recipients: ["jane@example.org"], startsAt: "2026-10-08T16:00:00.000Z", endsAt: "2026-10-08T17:00:00.000Z" });
  assert.doesNotMatch(JSON.stringify(parsed), /Example message/);
});

test("given ambiguous missing or oversized receipt data, when extracting it, then reject instead of inventing a booking correlation", () => {
  // given
  const raws = ["not an email", mail(Buffer.from(calendar.replaceAll(/BEGIN:[^\r]+\r\n|END:[^\r]+\r\n/g, "")).toString("base64")),
    mail(Buffer.from(calendar.replace(`UID:booking-${identifier}`, `UID:booking-${"-".repeat(36)}`)).toString("base64")),
    mail(Buffer.from(calendar.replace("BEGIN:VEVENT", `UID:booking-${identifier}@courtside\r\nBEGIN:VEVENT`)).toString("base64")),
    mail(Buffer.from(calendar + `UID:booking-${identifier}@courtside\r\n`).toString("base64")),
    mail(Buffer.from(calendar.replace("DTEND:20261008T170000Z", "DTEND:20261008T150000Z")).toString("base64")),
    mail(Buffer.from(calendar).toString("base64")).replace("Message-ID: <receipt-1@example.org>", "Message-ID: <first@example.org>\r\nMessage-ID: <second@example.org>"),
    mail(Buffer.from(calendar).toString("base64")).replace("--example-boundary--", ""),
    mail(`${Buffer.from(calendar).toString("base64")}!!!`),
    "x".repeat(262145)];
  // when / then
  for (const input of raws) {
    const result = spawnSync("python3", [script], { input, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /invalid booking receipt/);
  }
});
