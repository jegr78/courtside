import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createMailCertificate(directory, days = 1) {
  const key = join(directory, "key.pem");
  const result = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:3072", "-nodes",
    "-days", String(days), "-subj", "/CN=mail", "-addext", "subjectAltName=DNS:mail",
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

export function dockerIsRootless(run = spawnSync) {
  const result = run("docker", ["info", "--format", "{{json .SecurityOptions}}"], { encoding: "utf8" });
  return !result.error && result.status === 0 && /name=rootless/.test(result.stdout ?? "");
}

let rootlessDaemon;

// Rootless Docker maps container root to the host user; any other UID lands on an unrelated sub-UID.
export function containerIdentity(runtime = process, rootless = rootlessDaemon ??= dockerIsRootless()) {
  return rootless ? "0:0" : currentHostIdentity(runtime);
}
