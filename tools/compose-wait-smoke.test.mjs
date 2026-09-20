import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { composeWaitSmokeIdentity, parseComposeVersion, redactComposeDiagnostics,
  supportsComposeWait } from "./compose-wait-smoke.mjs";

const source = readFileSync(new URL("./compose-wait-smoke.mjs", import.meta.url), "utf8");

test("given a commit and process, when naming the smoke, then it cannot reuse a mutable application tag", () => {
  // when
  const identity = composeWaitSmokeIdentity("a".repeat(40), 4312);

  // then
  assert.equal(identity.project, "courtside-verify-aaaaaaaaaaaa-4312");
  assert.equal(identity.sourceCommit, "a".repeat(40));
  assert.equal(Object.hasOwn(identity, "imageTag"), false);
});

test("given hosted and local Compose versions, when the wait contract is checked, then unsupported versions fail", () => {
  // when / then
  assert.deepEqual(parseComposeVersion("Docker Compose version v2.33.1\n"), [2, 33, 1]);
  assert.equal(supportsComposeWait([2, 33, 1]), true);
  assert.equal(supportsComposeWait([2, 32, 4]), false);
  assert.throws(() => parseComposeVersion("Docker Compose version dev"), /version/i);
});

test("given a freshly built candidate, when the smoke starts Compose, then the application must become healthy", () => {
  // when / then
  assert.match(source, /COURTSIDE_UAT_ADMIN_PASSWORD:/);
  assert.match(source, /compose, "up", "-d", "--wait", "app"/);
  assert.match(source, /\["log-collector", "db", "app"\]/);
  assert.match(source, /"logs", "--no-color", "--tail", "200"/);
});

test("given generated bootstrap input, when failure diagnostics are printed, then the input is removed", () => {
  // when / then
  assert.equal(redactComposeDiagnostics("failed with secret-value", ["secret-value"]),
    "failed with [REDACTED]");
});
