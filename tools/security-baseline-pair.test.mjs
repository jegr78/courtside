import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBaselinePair } from "./security-baseline-pair.mjs";

const safe = { runId: "assessment-123456-1", attempt: 1, profile: "safe",
  targetFingerprint: `sha256:${"a".repeat(64)}`, tools: [{ id: "target-identity", version: "1.0.0" }],
  toolResults: [{ id: "target-identity", version: "1.0.0", outcome: "passed" }] };
const active = { ...safe, attempt: 2, profile: "active" };

test("given two profiles from one target, when validating the pair, then it is accepted", () => {
  // when / then
  assert.equal(validateBaselinePair(safe, active), true);
});

test("given profiles from different targets, when validating the pair, then it is rejected", () => {
  // given
  const other = { ...active, targetFingerprint: `sha256:${"b".repeat(64)}` };

  // when / then
  assert.throws(() => validateBaselinePair(safe, other), /target identity/);
});

test("given reversed attempts, when validating the pair, then it is rejected", () => {
  // when / then
  assert.throws(() => validateBaselinePair(active, safe), /attempt order/);
});
