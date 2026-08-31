import assert from "node:assert/strict";
import { test } from "node:test";
import { baselineMayContinue } from "./security-baseline-continuation.mjs";

const completeSafeManifest = {
  status: "incomplete",
  profile: "safe",
  attempt: 1,
  tools: [
    { id: "target-identity", version: "1.0.0" },
    { id: "passive-deployment", version: "1.3.0" }
  ],
  toolResults: [
    { id: "target-identity", version: "1.0.0", outcome: "passed" },
    { id: "passive-deployment", version: "1.3.0", outcome: "incomplete" }
  ],
  usage: { requests: 30, generatedDataMegabytes: 0, evidenceBytes: 1200 }
};

test("given retained passive candidates, when continuing a baseline, then the active leg may run", () => {
  // when / then
  assert.equal(baselineMayContinue(completeSafeManifest), true);
});

test("given an interrupted safe assessment, when continuing a baseline, then the active leg is rejected", () => {
  // given
  const manifest = structuredClone(completeSafeManifest);
  manifest.toolResults.pop();
  manifest.usage.requests = 0;

  // when / then
  assert.throws(() => baselineMayContinue(manifest), /complete passive evidence/);
});

test("given the wrong attempt or profile, when continuing a baseline, then the active leg is rejected", () => {
  // given
  const manifest = { ...completeSafeManifest, attempt: 2, profile: "active" };

  // when / then
  assert.throws(() => baselineMayContinue(manifest), /first safe attempt/);
});

test("given a failed safe assessment, when continuing a baseline, then active traffic is rejected", () => {
  // given
  const manifest = structuredClone(completeSafeManifest);
  manifest.status = "failed";
  manifest.toolResults[1].outcome = "failed";

  // when / then
  assert.throws(() => baselineMayContinue(manifest), /safe outcome/);
});

test("given a changed tool result identity, when continuing a baseline, then active traffic is rejected", () => {
  // given
  const manifest = structuredClone(completeSafeManifest);
  manifest.toolResults[1].version = "different";

  // when / then
  assert.throws(() => baselineMayContinue(manifest), /complete passive evidence/);
});
