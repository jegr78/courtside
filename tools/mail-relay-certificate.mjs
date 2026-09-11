import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The application requires STARTTLS of its relay, so an environment that runs one has to hand it a
// certificate; a day is longer than any run and shorter than anything worth keeping.
export function createMailCertificate(directory) {
  const key = join(directory, "key.pem");
  const result = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "1",
    "-subj", "/CN=mail", "-addext", "subjectAltName=DNS:mail",
    "-keyout", key, "-out", join(directory, "cert.pem")], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Could not issue the relay certificate: ${result.stderr?.trim() ?? result.status}`);
  }
  chmodSync(key, 0o600);
}

export function createMailCertificateDirectory(parent = tmpdir(), prefix = "courtside-mail-") {
  return mkdtempSync(join(parent, prefix));
}

export function currentHostIdentity(runtime = process) {
  return `${runtime.getuid?.() ?? 0}:${runtime.getgid?.() ?? 0}`;
}
