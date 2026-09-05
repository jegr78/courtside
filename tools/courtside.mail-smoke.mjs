import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { connect as connectTls } from "node:tls";
import { createConnection } from "node:net";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const composeFile = join(root, "deploy", "compose.mail-smoke.yaml");

const project = `courtside-mail-${randomBytes(4).toString("hex")}`;
const domain = "courts.example.org";
const hostname = `mail.${domain}`;
// The same foreign domain the deployment's own setup check offers it, so both ask one question.
const relayProbeDomain = process.env.COURTSIDE_MAIL_RELAY_PROBE ?? "relay-probe.example.com";
const setupPassword = randomBytes(18).toString("base64url");
const adminPassword = randomBytes(18).toString("base64url");
const applicationPassword = randomBytes(18).toString("base64url");
const runtime = mkdtempSync(join(tmpdir(), "courtside-mail-smoke-"));

function openssl(args, input) {
  const result = spawnSync("openssl", args, { cwd: runtime, encoding: "utf8", input });
  if (result.error) throw new Error(`openssl ${args[0]} could not run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`openssl ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

// What a club's own mail server hands out, read the way the application meets it: nothing installs
// a certificate here, because nothing in `deploy/` installs one either.
function servedCertificate(port) {
  const shown = openssl(["s_client", "-starttls", "smtp", "-connect", `127.0.0.1:${port}`], "");
  const found = /-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/.exec(shown);
  assert.ok(found, `the submission listener on ${port} presented no certificate`);
  return found[0];
}

function namesOn(certificate) {
  const described = openssl(["x509", "-noout", "-subject", "-ext", "subjectAltName"], certificate);
  return [...described.matchAll(/(?:CN\s*=\s*|DNS:|IP Address:)([^,\n]+)/g)].map((match) => match[1]);
}

function compose(args, { recoveryAdmin = `admin:${setupPassword}`, allowFailure = false } = {}) {
  const result = spawnSync("docker", ["compose", "-f", composeFile, "-p", project, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      COURTSIDE_MAIL_HOSTNAME: hostname,
      COURTSIDE_MAIL_DOMAIN: domain,
      COURTSIDE_MAIL_ADMIN_PASSWORD: adminPassword,
      COURTSIDE_MAIL_PASSWORD: applicationPassword,
      COURTSIDE_MAIL_SETUP_PASSWORD: setupPassword,
      COURTSIDE_MAIL_RECOVERY_ADMIN: recoveryAdmin
    }
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`docker compose ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function publishedPort(service, container) {
  const port = compose(["port", service, String(container)]).trim().split("\n").pop();
  assert.match(port ?? "", /:\d+$/, `${service} does not publish ${container}`);
  return Number(port.split(":").pop());
}

async function until(what, check, attempts = 90) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await check()) return;
    } catch {
      // Still starting; the throw below is what reports a lasting failure.
    }
    await new Promise((wake) => setTimeout(wake, 1000));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

function mailIsHealthy() {
  return compose(["ps", "mail", "--format", "{{.Health}}"]).includes("healthy");
}

class Smtp {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { this.buffer += chunk; });
  }

  static async open(port) {
    const socket = createConnection({ host: "127.0.0.1", port });
    await new Promise((ready, fail) => socket.once("connect", ready).once("error", fail));
    const session = new Smtp(socket);
    await session.expect("220");
    return session;
  }

  async expect(code) {
    const reply = await this.reply();
    if (!statusOf(reply).startsWith(code)) throw new Error(`Expected ${code}, got: ${reply.trim()}`);
    return reply;
  }

  async reply() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const line = this.buffer.split("\r\n").filter(Boolean).pop();
      if (line && /^\d{3} /.test(line)) {
        const reply = this.buffer;
        this.buffer = "";
        return reply;
      }
      await new Promise((wake) => setTimeout(wake, 50));
    }
    throw new Error(`No complete reply: ${this.buffer}`);
  }

  async send(line, code) {
    this.socket.write(`${line}\r\n`);
    return this.expect(code);
  }

  // Whatever the server answers: a probe that exists to read a refusal cannot demand a code.
  async attempt(line) {
    this.socket.write(`${line}\r\n`);
    return this.reply();
  }

  // Against the authority that issued it, not against what the server itself presented: the chain is
  // checked, and only the name is not, which is exactly what the exception the instance runs with means.
  async startTls(anchor) {
    await this.send("EHLO courtside-smoke", "250");
    await this.send("STARTTLS", "220");
    const secure = connectTls({
      socket: this.socket, ca: [anchor], checkServerIdentity: () => undefined
    });
    await new Promise((ready, fail) => secure.once("secureConnect", ready).once("error", fail));
    return new Smtp(secure);
  }
}

function statusOf(reply) {
  return reply.split("\r\n").filter(Boolean).pop();
}

// Port 25 is published because this deployment has an MX record and bounces have to arrive
// somewhere. What keeps that from harming strangers is that the server carries no mail of theirs.
async function relayProbe(port, announcing, sender, foreign) {
  const session = await Smtp.open(port);
  try {
    // Only once greeting and sender were accepted does the recipient's answer say anything about
    // relaying: a server that turned the sender away answers "bad sequence", which is not a refusal.
    await session.send(`EHLO ${announcing}`, "250");
    await session.send(`MAIL FROM:<${sender}>`, "250");
    return statusOf(await session.attempt(`RCPT TO:<probe@${foreign}>`));
  } finally {
    session.socket.end();
  }
}

async function awaitListener(port, what) {
  await until(what, async () => {
    const session = await Smtp.open(port);
    session.socket.end();
    return true;
  });
}

async function submit(port, from, to, password, anchor) {
  const plain = await Smtp.open(port);
  const session = await plain.startTls(anchor);
  const greeting = await session.send("EHLO courtside-smoke", "250");
  assert.match(greeting, /AUTH[^\r\n]*PLAIN/,
    "the submission listener offers no PLAIN authentication after STARTTLS");
  const credential = Buffer.from(["", from, password].join("\u0000")).toString("base64");
  await session.send(`AUTH PLAIN ${credential}`, "235");
  await session.send(`MAIL FROM:<${from}>`, "250");
  await session.send(`RCPT TO:<${to}>`, "250");
  await session.send("DATA", "354");
  const message = [`From: ${from}`, `To: ${to}`, "Subject: courtside mail smoke", "", "hello", "."];
  await session.send(message.join("\r\n"), "250");
  await session.send("QUIT", "221");
  session.socket.end();
}


// What the helper says it handed over, which is also how a run knows a rotation arrived: the
// version names the pair, so a second one is a different line and not the same one again.
function published() {
  const lines = compose(["logs", "mail-certificate"]).split("\n")
    .filter((line) => line.includes("published the certificate"));
  return lines.length === 0 ? undefined : lines[lines.length - 1].trim().split(" ").pop();
}

function digestInside(service, path) {
  const output = compose(["exec", "-T", service, "sh", "-c", `sha256sum ${path}`],
    { allowFailure: true });
  const found = /^[0-9a-f]{64}/m.exec(output);
  return found === null ? "" : found[0];
}

// Every file the mail server keeps, so a key it holds under a name nobody guessed is found too.
function occurrencesInside(service, digest) {
  const output = compose(["exec", "-T", service, "sh", "-c",
    "find /etc/stalwart /var/lib/stalwart -type f -exec sha256sum {} + 2>/dev/null"],
    { allowFailure: true });
  return output.split("\n").filter((line) => line.startsWith(digest)).length;
}
async function main() {
  try {
    console.log(`Bringing up the shipped mail server as ${project}`);
    compose(["up", "-d", "mail", "sink", "proxy", "mail-certificate"]);
    await until("the mail server to report healthy", mailIsHealthy);

    console.log("Waiting for the proxy's certificate to reach the mail server's volume");
    await until("the helper to publish a certificate", () => published() !== undefined);

    console.log("Rendering and applying the shipped plans");
    compose(["run", "--rm", "plan"]);
    compose(["run", "--rm", "apply", "apply", "--file", "/plan/bootstrap.ndjson"]);
    compose(["restart", "mail"]);
    await until("the mail server to report healthy", mailIsHealthy);
    compose(["run", "--rm", "apply", "apply", "--file", "/plan/base.ndjson"]);
    compose(["run", "--rm", "apply", "apply", "--file", "/plan/journey.ndjson"]);

    console.log("Restarting without the recovery credential");
    compose(["up", "-d", "--force-recreate", "mail"], { recoveryAdmin: "" });
    await until("the mail server to report healthy", mailIsHealthy);

    const submission = publishedPort("mail", 587);
    const inbound = publishedPort("mail", 25);
    const sink = publishedPort("sink", 8025);
    // The account the shipped plan gives the instance, not the mail administrator's: what a club
    // runs has to let the application in as itself.
    const sender = `courtside@${domain}`;
    // A member is somewhere else entirely, so the message leaves through the relay route
    // rather than being filed into a local mailbox.
    const recipient = "jane.doe@example.org";

    await awaitListener(submission, "the submission listener to accept connections");

    const served = servedCertificate(submission);
    const names = namesOn(served);
    assert.ok(names.includes(hostname),
      `the mail server serves a certificate for ${names.join(", ")} and not for ${hostname}, `
      + "so the proxy's certificate never reached the listener a receiver connects to");
    // The instance reaches the relay as `mail` on the compose network, which is not a name any
    // certificate carries, so the exception this deployment sets is still what the hop rests on.
    assert.ok(!names.includes("mail"),
      "the relay now answers to the name the instance dials, so the trust exception can go");

    console.log("Offering the shipped mail server somebody else's mail on the published port");
    await awaitListener(inbound, "the inbound listener to accept connections");
    const answer = await relayProbe(inbound, hostname, `probe@${domain}`, relayProbeDomain);
    // Outright, not merely "not accepted": a 4xx is a server asking to be tried again, and one that
    // greylists a stranger today can still carry their mail after the wait.
    assert.match(answer, /^5\d\d/,
      `the mail server answered ${answer} for ${relayProbeDomain} instead of refusing outright, `
      + "and an open relay is the one state in which this instance harms people who are not its members");

    console.log("Submitting as the instance, with the account the shipped plan gave it");
    const authority = compose(["exec", "-T", "proxy", "cat",
      "/data/caddy/pki/authorities/local/root.crt"]);
    assert.match(authority, /-----BEGIN CERTIFICATE-----/,
      "without the proxy's own root there is nothing to check the mail server's chain against");
    await submit(submission, sender, recipient, applicationPassword, authority);

    await until("the message to arrive in the sink", async () => {
      const response = await fetch(`http://127.0.0.1:${sink}/api/v1/messages`);
      const { messages } = await response.json();
      return messages.some((message) => message.To.some((address) => address.Address === recipient));
    });

    console.log("Reading what the mail server can reach of the proxy's store");
    const foreignKey = `/data/caddy/certificates/local/${domain}/${domain}.key`;
    const foreignDigest = digestInside("proxy", foreignKey);
    assert.match(foreignDigest, /^[0-9a-f]{64}$/,
      "the proxy manages no second name here, so nothing in this run withholds anything");
    assert.equal(occurrencesInside("mail", foreignDigest), 0,
      `the mail server holds the private key the proxy uses for ${domain}, `
      + "so the handover passed on the store instead of one certificate out of it");
    assert.equal(digestInside("mail", "/etc/stalwart/tls/current/tls.key"),
      digestInside("proxy", `/data/caddy/certificates/local/${hostname}/${hostname}.key`),
      "the mail server reads a key the proxy did not issue for its hostname");

    console.log("Replacing the stored key with one that does not match the certificate");
    const beforeBreak = published();
    compose(["exec", "-T", "proxy", "sh", "-c",
      `cp ${foreignKey} /data/caddy/certificates/local/${hostname}/${hostname}.key`]);
    await until("the helper to refuse the mismatched pair", () =>
      compose(["logs", "mail-certificate"]).includes("incomplete or mismatched"));
    assert.equal(published(), beforeBreak,
      "a mismatched pair replaced the published one, and a mail server loading it serves nothing");

    console.log("Letting the proxy issue the mail certificate again");
    compose(["exec", "-T", "proxy", "sh", "-c",
      `rm -rf /data/caddy/certificates/local/${hostname}`]);
    compose(["restart", "proxy"]);
    await until("the helper to publish the reissued certificate", () => {
      const now = published();
      return now !== undefined && now !== beforeBreak;
    });
    // The log line says the rename succeeded; only reading through `current` says it moved. The
    // first publish finds no link there at all, so this is the swap that can regress.
    assert.equal(digestInside("mail", "/etc/stalwart/tls/current/tls.key"),
      digestInside("proxy", `/data/caddy/certificates/local/${hostname}/${hostname}.key`),
      "the mail server still reads the pair from before the reissue, so `current` was not swapped");

    console.log("The shipped mail server, configured only from the shipped plans, delivered a message.");
  } finally {
    compose(["down", "-v", "--remove-orphans"], { allowFailure: true });
    rmSync(runtime, { recursive: true, force: true });
  }
}

await main();
