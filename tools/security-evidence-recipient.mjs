import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function verifyRecipientFingerprint(certificateBytes, expectedFingerprint) {
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.trim() === "") {
    throw new Error("COURTSIDE_SECURITY_EVIDENCE_CERTIFICATE_SHA256 is not configured");
  }
  const actualFingerprint = new X509Certificate(certificateBytes).fingerprint256;
  if (actualFingerprint !== expectedFingerprint.trim().toUpperCase()) {
    throw new Error("The security evidence recipient certificate does not match its repository anchor");
  }
  return actualFingerprint;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedPath) {
  const certificatePath = process.argv[2];
  if (!certificatePath) throw new Error("Usage: security-evidence-recipient.mjs <certificate.pem>");
  verifyRecipientFingerprint(
      readFileSync(certificatePath),
      process.env.COURTSIDE_SECURITY_EVIDENCE_CERTIFICATE_SHA256);
}
