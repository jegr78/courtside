import assert from "node:assert/strict";
import test from "node:test";
import { validateResourceCoverage, validateResourceTimeline } from "./browser-resource-observation.mjs";

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

// An attempt samples from the moment the world is first prepared until the last browser is gone,
// and the lifecycle names the window each browser container was alive for.
function attempt({ applicationRestartsAfterSample = 0 } = {}) {
  const at = (second) => `2026-09-05T08:00:${String(second).padStart(2, "0")}.000Z`;
  const browser = "c".repeat(64);
  const metrics = (sequence) => ({
    cpuPercent: sequence,
    memoryUsageBytes: sequence * 1000,
    pids: sequence,
    sharedMemoryUsageBytes: sequence * 10
  });
  const container = (target, containerId) => Array.from({ length: 20 }, (_, index) => ({
    recordedAt: at(index + 1), sequence: index + 1, target, containerId, ...metrics(index + 1)
  }));
  return {
    timeline: {
      schemaVersion: 1,
      intervalMs: 1_000,
      samples: [
        ...Array.from({ length: 20 }, (_, index) => ({
          recordedAt: at(index + 1),
          sequence: index + 1,
          target: "application",
          processId: index + 1 <= applicationRestartsAfterSample ? 1234 : 5678,
          ...metrics(index + 1)
        })),
        ...container("proxy", "a".repeat(64)),
        ...container("postgres", "b".repeat(64)),
        ...Array.from({ length: 8 }, (_, index) => ({
          recordedAt: at(index + 11),
          sequence: index + 11,
          target: "browser",
          containerId: browser,
          processId: 77,
          ...metrics(index + 11)
        }))
      ]
    },
    boundaries: { startedAt: at(1), finishedAt: at(20) },
    lifecycle: { processes: [{ processId: browser, startedAt: at(11), finishedAt: at(18) }] }
  };
}

test("given one process throughout, when the coverage is read, then the run is covered", () => {
  // given
  const { timeline, boundaries, lifecycle } = attempt();

  // when / then
  validateResourceCoverage(timeline, boundaries, lifecycle);
});

test("given the application restarted before the first browser, when the coverage is read, then preparing the world is not a hole in the run", () => {
  // given — taking a seeded world per language restarts the application while no browser exists yet
  const { timeline, boundaries, lifecycle } = attempt({ applicationRestartsAfterSample: 9 });

  // when / then
  validateResourceCoverage(timeline, boundaries, lifecycle);
});

test("given the application restarted while the browsers ran, when the coverage is read, then it is refused", () => {
  // given
  const { timeline, boundaries, lifecycle } = attempt({ applicationRestartsAfterSample: 13 });

  // when / then
  assert.throws(() => validateResourceCoverage(timeline, boundaries, lifecycle),
    /application resource observation does not cover the browser run/);
});

test("given a container replaced while the browsers ran, when the coverage is read, then it is refused", () => {
  // given
  const { timeline, boundaries, lifecycle } = attempt();
  const swapped = timeline.samples.map((sample) => sample.target === "proxy" && sample.sequence > 13
    ? { ...sample, containerId: "d".repeat(64) } : sample);

  // when / then
  assert.throws(() => validateResourceCoverage({ ...timeline, samples: swapped }, boundaries, lifecycle),
    /proxy resource observation does not cover the browser run/);
});

test("given no sample falls in the browser window, when the coverage is read, then it is refused", () => {
  // given
  const { timeline, boundaries, lifecycle } = attempt();
  const withoutPostgres = timeline.samples.filter((sample) => sample.target !== "postgres"
    || sample.sequence < 11);

  // when / then
  assert.throws(() => validateResourceCoverage({ ...timeline, samples: withoutPostgres },
    boundaries, lifecycle), /postgres resource observation does not cover the browser run/);
});
