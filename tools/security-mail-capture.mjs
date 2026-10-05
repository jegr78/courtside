import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export function securityMailTrustPlan(directory, image, user, identity) {
  if (!isAbsolute(directory) || directory === "/" || directory.includes(",")) {
    throw new Error("Invalid private mail trust directory");
  }
  if (!/^(?:sha256:[a-f0-9]{64}|[^\s@]+@sha256:[a-f0-9]{64})$/.test(image)
    || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(user)) throw new Error("Invalid bounded mail trust identity");
  if (!/^[a-z0-9][a-z0-9-]{5,47}$/.test(identity?.runId)
    || !/^sha256:[a-f0-9]{64}$/.test(identity.seedFingerprint)
    || !/^sha256:[a-f0-9]{64}$/.test(identity.instanceFingerprint)) {
    throw new Error("Invalid mail trust ownership labels");
  }
  return { command: "docker", args: ["run", "--rm", "--pull", "never",
    "--name", `courtside-security-mail-trust-${identity.runId}`,
    "--label", `com.docker.compose.project=courtside-security-${identity.runId}`,
    "--label", "org.courtside.environment=SECURITY",
    "--label", `org.courtside.security.run-id=${identity.runId}`,
    "--label", `org.courtside.security.seed-fingerprint=${identity.seedFingerprint}`,
    "--label", `org.courtside.security.instance-fingerprint=${identity.instanceFingerprint}`,
    "--network", "none", "--read-only", "--user", user,
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--memory", "128m",
    "--cpus", "0.25", "--pids-limit", "32", "--tmpfs", "/tmp:size=16m",
    "--mount", `type=bind,src=${directory},dst=/trust`,
    "--entrypoint", "/opt/java/openjdk/bin/keytool", image, "-importcert", "-noprompt",
    "-alias", "courtside-security-mail", "-file", "/trust/cert.pem", "-keystore", "/trust/mail.p12",
    "-storetype", "PKCS12", "-storepass", "changeit"] };
}

export function createSecurityMailCertificate(directory) {
  mkdirSync(directory, { mode: 0o700 });
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "1",
    "-subj", "/CN=mail", "-addext", "subjectAltName=DNS:mail", "-keyout", join(directory, "key.pem"),
    "-out", join(directory, "cert.pem")], { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  chmodSync(join(directory, "key.pem"), 0o600);
  const certificate = new X509Certificate(readFileSync(join(directory, "cert.pem")));
  if (!certificate.checkHost("mail") || !certificate.verify(certificate.publicKey)) {
    throw new Error("The issued security relay certificate has invalid identity");
  }
  return { fingerprint: `sha256:${certificate.fingerprint256.replaceAll(":", "").toLowerCase()}` };
}
