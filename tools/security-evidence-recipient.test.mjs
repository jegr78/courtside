import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyRecipientFingerprint } from "./security-evidence-recipient.mjs";

const certificate = readFileSync(new URL("../.github/security-evidence-recipient.pem", import.meta.url));
const fingerprint = new X509Certificate(certificate).fingerprint256;

test("given the externally anchored fingerprint, when checking the recipient, then the certificate is accepted", () => {
  // when
  const actual = verifyRecipientFingerprint(certificate, fingerprint.toLowerCase());

  // then
  assert.equal(actual, fingerprint);
});

test("given no external fingerprint, when checking the recipient, then evidence sealing is refused", () => {
  // when / then
  assert.throws(() => verifyRecipientFingerprint(certificate, undefined), /is not configured/);
  assert.throws(() => verifyRecipientFingerprint(certificate, "  "), /is not configured/);
});

test("given another anchored fingerprint, when checking the recipient, then evidence sealing is refused", () => {
  // given
  const otherFingerprint = `00:${fingerprint.slice(3)}`;

  // when / then
  assert.throws(() => verifyRecipientFingerprint(certificate, otherFingerprint), /does not match/);
});
