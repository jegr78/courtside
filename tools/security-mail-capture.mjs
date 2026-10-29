import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export function securityMailTrustPlan(directory, image, user, identity, rootless = false) {
  if (!isAbsolute(directory) || directory === "/" || directory.includes(",")) {
    throw new Error("Invalid private mail trust directory");
  }
  if (!/^(?:sha256:[a-f0-9]{64}|[^\s@]+@sha256:[a-f0-9]{64})$/.test(image)
    || !(/^[1-9][0-9]*:[1-9][0-9]*$/.test(user) || (rootless && user === "0:0"))) {
    throw new Error("Invalid bounded mail trust identity");
  }
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
    "--entrypoint", "/bin/sh", image, "-ec",
    '"$1" -importkeystore -noprompt -srckeystore "$2" -srcstorepass changeit -destkeystore "$3/mail.p12" -deststoretype PKCS12 -deststorepass changeit\n'
      + 'exec "$1" -importcert -noprompt -alias courtside-security-mail -file "$3/cert.pem" -keystore "$3/mail.p12" -storetype PKCS12 -storepass changeit',
    "courtside-security-mail-trust", "/opt/java/openjdk/bin/keytool", "/opt/java/openjdk/lib/security/cacerts", "/trust"] };
}

export function createSecurityMailCertificate(directory) {
  mkdirSync(directory, { mode: 0o700 });
  const pem = execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "1",
    "-subj", "/CN=mail", "-addext", "subjectAltName=DNS:mail,DNS:password-breach", "-keyout", join(directory, "key.pem")],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  writeFileSync(join(directory, "cert.pem"), pem);
  chmodSync(join(directory, "key.pem"), 0o600);
  const certificate = new X509Certificate(pem);
  if (!certificate.checkHost("mail") || !certificate.checkHost("password-breach") || !certificate.verify(certificate.publicKey)) {
    throw new Error("The issued security relay certificate has invalid identity");
  }
  return { fingerprint: `sha256:${certificate.fingerprint256.replaceAll(":", "").toLowerCase()}`, pem };
}
