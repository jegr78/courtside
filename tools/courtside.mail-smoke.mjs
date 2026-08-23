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
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const line = this.buffer.split("\r\n").filter(Boolean).pop();
      if (line && /^\d{3} /.test(line)) {
        const reply = this.buffer;
        this.buffer = "";
        if (!line.startsWith(code)) throw new Error(`Expected ${code}, got: ${reply.trim()}`);
        return reply;
      }
      await new Promise((wake) => setTimeout(wake, 50));
    }
    throw new Error(`No complete reply while expecting ${code}: ${this.buffer}`);
  }

  async send(line, code) {
    this.socket.write(`${line}\r\n`);
    return this.expect(code);
  }

  // The application's posture, without weakening the handshake to reach it: what the relay presents
  // is its own anchor, and the name on it decides nothing — which is what the exception it runs with means.
  async startTls(served) {
    await this.send("EHLO courtside-smoke", "250");
    await this.send("STARTTLS", "220");
    const secure = connectTls({
      socket: this.socket, ca: [served], checkServerIdentity: () => undefined
    });
    await new Promise((ready, fail) => secure.once("secureConnect", ready).once("error", fail));
    return new Smtp(secure);
  }
}

async function submit(port, from, to, password, served) {
  const plain = await Smtp.open(port);
  const session = await plain.startTls(served);
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

async function main() {
  try {
    console.log(`Bringing up the shipped mail server as ${project}`);
    compose(["up", "-d", "mail", "sink"]);
    await until("the mail server to report healthy", mailIsHealthy);

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
    const sink = publishedPort("sink", 8025);
    // The account the shipped plan gives the instance, not the mail administrator's: what a club
    // runs has to let the application in as itself.
    const sender = `courtside@${domain}`;
    // A member is somewhere else entirely, so the message leaves through the relay route
    // rather than being filed into a local mailbox.
    const recipient = "jane.doe@example.org";

    await until("the submission listener to accept connections", async () => {
      const session = await Smtp.open(submission);
      session.socket.end();
      return true;
    });

    const served = servedCertificate(submission);
    const names = namesOn(served);
    // The reason `COURTSIDE_MAIL_TRUST_RELAY_CERTIFICATE` exists, checked rather than assumed: when
    // this stops holding, the exception can go and the instance can validate the hop in full.
    assert.deepEqual(names.filter((name) => [hostname, "mail", "127.0.0.1"].includes(name)), [],
      `the mail server now names a host the instance reaches it at (${names.join(", ")}), `
      + "so the certificate exception is no longer what makes the handover possible");

    console.log("Submitting as the instance, with the account the shipped plan gave it");
    await submit(submission, sender, recipient, applicationPassword, served);

    await until("the message to arrive in the sink", async () => {
      const response = await fetch(`http://127.0.0.1:${sink}/api/v1/messages`);
      const { messages } = await response.json();
      return messages.some((message) => message.To.some((address) => address.Address === recipient));
    });

    console.log("The shipped mail server, configured only from the shipped plans, delivered a message.");
  } finally {
    compose(["down", "-v", "--remove-orphans"], { allowFailure: true });
    rmSync(runtime, { recursive: true, force: true });
  }
}

await main();
