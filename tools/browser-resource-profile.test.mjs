import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertHostCapacity,
  deriveResourceProfiles,
  deriveResourceProfilesFromTimeline,
  resourceLimits,
  validateResourceProfileContract,
  validateResourceTimeline
} from "./browser-resource-profile.mjs";

const reference = {
  sourceCommit: "a".repeat(40),
  measuredAt: "2026-09-05T08:00:00.000Z",
  attemptId: "018f47a2-9e4c-7a61-8000-123456789abc",
  samples: [
    { target: "application", cpuPercent: 35, memoryUsageBytes: 300_000_000, pids: 42, sharedMemoryUsageBytes: 0 },
    { target: "proxy", cpuPercent: 2, memoryUsageBytes: 30_000_000, pids: 8, sharedMemoryUsageBytes: 1_000_000 },
    { target: "postgres", cpuPercent: 20, memoryUsageBytes: 200_000_000, pids: 18, sharedMemoryUsageBytes: 5_000_000 },
    { target: "browser", cpuPercent: 90, memoryUsageBytes: 600_000_000, pids: 75, sharedMemoryUsageBytes: 40_000_000 }
  ]
};

test("given an unconstrained reference, when deriving profiles, then every limit records its measured origin", () => {
  // given / when
  const contract = deriveResourceProfiles(reference);

  // then
  assert.equal(contract.schemaVersion, 1);
  assert.deepEqual(Object.keys(contract.profiles), ["normal", "stress"]);
  assert.equal(contract.derivation.reference.sourceCommit, reference.sourceCommit);
  assert.deepEqual(contract.derivation.reference.peaks.browser, {
    cpuPercent: 90, memoryUsageBytes: 600_000_000, pids: 75, sharedMemoryUsageBytes: 40_000_000
  });
  assert.equal(contract.profiles.normal.targets.browser.memoryMegabytes, 768);
  assert.equal(contract.profiles.normal.targets.browser.sharedMemoryMegabytes, 48);
  assert.ok(contract.profiles.stress.targets.browser.memoryMegabytes
    < contract.profiles.normal.targets.browser.memoryMegabytes);
  validateResourceProfileContract(contract);
});

test("given a host below the selected profile, when checking capacity, then startup names every shortage", () => {
  // given
  const contract = deriveResourceProfiles(reference);

  // when / then
  assert.throws(() => assertHostCapacity(contract, "normal", {
    cpuCount: 1,
    memoryBytes: 128_000_000,
    pids: 50,
    sharedMemoryBytes: 16_000_000
  }), /normal.*CPU.*memory.*PIDs.*shared memory/i);
});

test("given the maintained profiles, when loading the contract, then exact enforceable limits are available", () => {
  // given
  const contract = JSON.parse(readFileSync(new URL("../quality/browser-resource-profiles.json", import.meta.url), "utf8"));

  // when
  validateResourceProfileContract(contract);
  const limits = resourceLimits(contract, "normal", "postgres");

  // then
  assert.deepEqual(Object.keys(limits).toSorted(),
    ["cpu", "memoryBytes", "pids", "sharedMemoryBytes"]);
  assert.deepEqual(limits, { cpu: 0.3, memoryBytes: 134_217_728, pids: 32, sharedMemoryBytes: 16_777_216 });
  const altered = structuredClone(contract);
  altered.profiles.normal.targets.postgres.cpu += 0.05;
  assert.throws(() => validateResourceProfileContract(altered), /derivation/);
});

test("given a completed run, when validating its timeline, then all targets and metrics must be sampled over time", () => {
  // given
  const samples = ["application", "proxy", "postgres", "browser"].flatMap((target) => [1, 2].map((sequence) => ({
    recordedAt: `2026-09-05T08:00:0${sequence}.000Z`,
    sequence,
    target,
    containerId: target === "application" ? undefined : ({ proxy: "a", postgres: "b", browser: "c" })[target].repeat(64),
    processId: target === "application" ? 1234 : target === "browser" ? 77 : undefined,
    cpuPercent: sequence,
    memoryUsageBytes: sequence * 1000,
    pids: sequence,
    sharedMemoryUsageBytes: sequence * 10
  })));

  // when / then
  validateResourceTimeline({ schemaVersion: 1, intervalMs: 1_000, samples });
  assert.throws(() => validateResourceTimeline({ schemaVersion: 1, intervalMs: 1_000,
    samples: samples.filter(({ target }) => target !== "proxy") }), /proxy/);
  assert.throws(() => validateResourceTimeline({ schemaVersion: 1, intervalMs: 1_000,
    samples: samples.map(({ pids, ...sample }) => sample) }), /pids/);
  assert.throws(() => validateResourceTimeline({ schemaVersion: 1, intervalMs: 1_000,
    samples: samples.map((sample) => sample.target === "browser" && sample.sequence === 2
      ? { ...sample, recordedAt: "2026-09-05T08:00:08.000Z" } : sample) }), /sampling gap/);
  const derived = deriveResourceProfilesFromTimeline({ schemaVersion: 1, intervalMs: 1_000, samples },
    "a".repeat(40), "018f47a2-9e4c-7a61-8000-123456789abc");
  assert.equal(derived.derivation.reference.measuredAt, "2026-09-05T08:00:02.000Z");
});
