import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecureContext, TLSSocket } from "node:tls";
import test from "node:test";

import { verifyServedCertificate } from "../deploy/mail-certificate-peer.mjs";

const directory = mkdtempSync(join(tmpdir(), "courtside-mail-peer-"));

function openssl(arguments_) {
  execFileSync("openssl", arguments_, { cwd: directory, stdio: "ignore" });
}

function certificates() {
  openssl(["req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "1", "-subj",
    "/CN=Courtside test CA", "-keyout", "ca.key", "-out", "ca.crt"]);
  openssl(["req", "-newkey", "rsa:3072", "-nodes", "-subj", "/CN=mail.example.test",
    "-keyout", "server.key", "-out", "server.csr"]);
  writeFileSync(join(directory, "extensions"), "subjectAltName=DNS:mail.example.test\n");
  openssl(["x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key",
    "-CAcreateserial", "-days", "1", "-extfile", "extensions", "-out", "server.crt"]);
  const der = execFileSync("openssl", ["x509", "-in", "server.crt", "-outform", "DER"],
    { cwd: directory });
  return {
    ca: readFileSync(join(directory, "ca.crt")),
    certificate: readFileSync(join(directory, "server.crt")),
    fingerprint: createHash("sha256").update(der).digest("hex"),
    key: readFileSync(join(directory, "server.key"))
  };
}

async function smtpServer(identity, greeting = "220 mail.example.test ESMTP\r\n") {
  const context = createSecureContext({ cert: identity.certificate, key: identity.key });
  const server = createServer((socket) => {
    socket.write(greeting);
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      if (buffered.includes("EHLO")) {
        buffered = "";
        socket.write("250-mail.example.test\r\n250 STARTTLS\r\n");
      } else if (buffered.includes("STARTTLS")) {
        buffered = "";
        socket.write("220 Ready to start TLS\r\n", () => {
          new TLSSocket(socket, { isServer: true, secureContext: context });
        });
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

test("given a trusted listener serving the published leaf, when it is verified, then its fingerprint is returned",
  async (context) => {
    // given
    const identity = certificates();
    const server = await smtpServer(identity);
    context.after(() => server.close());

    // when
    const actual = await verifyServedCertificate({ hostname: "mail.example.test", host: "127.0.0.1",
      port: server.address().port, authority: identity.ca, expected: identity.fingerprint });

    // then
    assert.equal(actual, identity.fingerprint);
  });

test("given the listener retained its previous leaf, when the publisher expects another fingerprint, then health is refused",
  async (context) => {
    // given
    const identity = certificates();
    const server = await smtpServer(identity);
    context.after(() => server.close());

    // when / then
    await assert.rejects(verifyServedCertificate({ hostname: "mail.example.test", host: "127.0.0.1",
      port: server.address().port, authority: identity.ca, expected: "0".repeat(64) }),
    /served leaf fingerprint does not match the published certificate/);
  });

test("given a trusted listener for another name, when it is verified, then hostname validation refuses it",
  async (context) => {
    // given
    const identity = certificates();
    const server = await smtpServer(identity);
    context.after(() => server.close());

    // when / then
    await assert.rejects(verifyServedCertificate({ hostname: "other.example.test", host: "127.0.0.1",
      port: server.address().port, authority: identity.ca, expected: identity.fingerprint }),
    /did not present a certificate trusted for other\.example\.test/);
  });

test("given a listener outside the configured trust chain, when it is verified, then trust validation refuses it",
  async (context) => {
    // given
    const identity = certificates();
    const server = await smtpServer(identity);
    context.after(() => server.close());
    const unrelatedAuthority = certificates().ca;

    // when / then
    await assert.rejects(verifyServedCertificate({ hostname: "mail.example.test", host: "127.0.0.1",
      port: server.address().port, authority: unrelatedAuthority, expected: identity.fingerprint }),
    /did not present a certificate trusted for mail\.example\.test/);
  });

test("given an oversized SMTP reply, when it is read, then the health process bounds retained input",
  async (context) => {
    // given
    const identity = certificates();
    const server = await smtpServer(identity, `${"x".repeat(8_193)}\r\n220 ready\r\n`);
    context.after(() => server.close());

    // when / then
    await assert.rejects(verifyServedCertificate({ hostname: "mail.example.test", host: "127.0.0.1",
      port: server.address().port, authority: identity.ca, expected: identity.fingerprint }),
    /mail listener reply exceeded 8192 bytes/);
  });

test.after(() => rmSync(directory, { recursive: true, force: true }));
