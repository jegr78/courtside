import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { pathToFileURL } from "node:url";
import { connect as connectTls } from "node:tls";

const NETWORK_TIMEOUT_MILLISECONDS = 20_000;
const MAXIMUM_REPLY_BYTES = 8_192;

function readReply(socket, expected) {
  return new Promise((resolve, reject) => {
    let response = "";
    const onData = (chunk) => {
      response += chunk.toString("utf8");
      if (Buffer.byteLength(response) > MAXIMUM_REPLY_BYTES) {
        cleanup();
        reject(new Error("the mail listener reply exceeded 8192 bytes"));
        return;
      }
      const lines = response.split("\r\n").filter(Boolean);
      const final = lines.findLast((line) => /^\d{3} /.test(line));
      if (!final) return;
      cleanup();
      if (!final.startsWith(expected)) {
        reject(new Error(`the mail listener answered ${final.slice(0, 3)} instead of ${expected}`));
        return;
      }
      resolve(response);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(NETWORK_TIMEOUT_MILLISECONDS, () => {
      socket.destroy(new Error("the mail listener did not complete the TLS check"));
    });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function startTls(socket, options) {
  return new Promise((resolve, reject) => {
    const secure = connectTls({
      socket,
      servername: options.hostname,
      rejectUnauthorized: true,
      ...(options.authority ? { ca: options.authority } : {})
    });
    secure.setTimeout(NETWORK_TIMEOUT_MILLISECONDS, () => {
      secure.destroy(new Error("the mail listener did not complete the TLS check"));
    });
    secure.once("secureConnect", () => resolve(secure));
    secure.once("error", () => reject(new Error(
      `the mail listener did not present a certificate trusted for ${options.hostname}`)));
  });
}

export async function verifyServedCertificate(options) {
  if (!/^[a-f0-9]{64}$/.test(options.expected)) {
    throw new Error("the certificate helper published an invalid leaf fingerprint");
  }

  const socket = await connect(options.host ?? options.hostname, options.port ?? 587);
  try {
    await readReply(socket, "220");
    socket.write("EHLO courtside-certificate-reload\r\n");
    const capabilities = await readReply(socket, "250");
    if (!/^250[ -]STARTTLS$/m.test(capabilities)) {
      throw new Error("the configured mail listener did not offer STARTTLS");
    }
    socket.write("STARTTLS\r\n");
    await readReply(socket, "220");
    const secure = await startTls(socket, options);
    try {
      const leaf = secure.getPeerCertificate(true);
      if (!leaf.raw) throw new Error("the mail listener presented no leaf certificate");
      const actual = createHash("sha256").update(leaf.raw).digest("hex");
      if (!timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(options.expected, "hex"))) {
        throw new Error("the served leaf fingerprint does not match the published certificate");
      }
      return actual;
    } finally {
      secure.destroy();
    }
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function main() {
  const [hostname, host, port, expected, authorityFile] = process.argv.slice(2);
  if (!hostname || !host || !port || !expected) {
    throw new Error("usage: mail-certificate-peer.mjs <hostname> <host> <port> <fingerprint> [CA file]");
  }
  await verifyServedCertificate({
    hostname,
    host,
    port: Number(port),
    expected,
    ...(authorityFile ? { authority: readFileSync(authorityFile) } : {})
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
