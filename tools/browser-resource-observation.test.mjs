import assert from "node:assert/strict";
import test from "node:test";
import { validateResourceTimeline } from "./browser-resource-observation.mjs";

function timeline() {
  const samples = ["application", "proxy", "postgres", "browser"].flatMap((target) => [1, 2].map((sequence) => ({
    recordedAt: `2026-09-05T08:00:0${sequence}.000Z`,
    sequence,
    target,
    containerId: target === "application" ? undefined : ({ proxy: "a", postgres: "b", browser: "c" })[target].repeat(64),
    processId: target === "application" ? 1234 : target === "browser" ? 77 : undefined,
    cpuPercent: sequence === 1 ? 0 : sequence,
    memoryUsageBytes: sequence * 1000,
    pids: sequence,
    sharedMemoryUsageBytes: sequence * 10
  })));
  return { schemaVersion: 1, intervalMs: 1_000, samples };
}

test("given a completed run, when validating its timeline, then all targets and metrics must be sampled over time", () => {
  // given
  const evidence = timeline();

  // when / then
  validateResourceTimeline(evidence);
  assert.throws(() => validateResourceTimeline({ ...evidence,
    samples: evidence.samples.filter(({ target }) => target !== "proxy") }), /proxy/);
  assert.throws(() => validateResourceTimeline({ ...evidence,
    samples: evidence.samples.map(({ pids, ...sample }) => sample) }), /pids/);
  assert.throws(() => validateResourceTimeline({ ...evidence,
    samples: evidence.samples.map((sample) => sample.target === "browser" && sample.sequence === 2
      ? { ...sample, recordedAt: "2026-09-05T08:00:08.000Z" } : sample) }), /sampling gap/);
  assert.throws(() => validateResourceTimeline({ ...evidence,
    samples: evidence.samples.map((sample) => sample.target === "browser" && sample.sequence === 2
      ? { ...sample, recordedAt: "2026-09-05T08:00:00.000Z" } : sample) }), /sampling gap/);
  assert.throws(() => validateResourceTimeline({ ...evidence,
    samples: evidence.samples.map((sample) => sample.target === "browser" && sample.sequence === 2
      ? { ...sample, sequence: 3 } : sample) }), /sampling gap/);
  assert.throws(() => validateResourceTimeline({ ...evidence,
    samples: evidence.samples.filter(({ sequence }) => sequence !== 1) }), /sequence is incomplete/);
  assert.throws(() => validateResourceTimeline({ ...evidence,
    samples: evidence.samples.map((sample) => ({ ...sample, sequence: sample.sequence + 100 }))
  }), /sequence is incomplete/);
  assert.throws(() => validateResourceTimeline({ ...evidence,
    samples: [...evidence.samples, { ...evidence.samples[0], target: "mail-sink" }] }), /target/);
});
