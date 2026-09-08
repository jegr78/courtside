const targets = ["application", "proxy", "postgres", "browser"];

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function nonNegativeNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
}

export function validateResourceTimeline(timeline) {
  if (timeline?.schemaVersion !== 1) throw new Error("Resource timeline schema version is unsupported");
  positiveInteger(timeline.intervalMs, "Resource sampling interval");
  if (!Array.isArray(timeline.samples)) throw new Error("Resource timeline samples are missing");
  if (timeline.samples.some((sample) => !targets.includes(sample.target))) {
    throw new Error("Resource timeline contains an unknown target");
  }
  const sequences = [...new Set(timeline.samples.map(({ sequence }) => sequence))]
    .toSorted((left, right) => left - right);
  if (sequences[0] !== 1 || sequences.some((sequence, index) => sequence !== index + 1)) {
    throw new Error("Resource timeline sequence is incomplete");
  }
  for (const target of targets) {
    const samples = timeline.samples.filter((sample) => sample.target === target);
    if (samples.length < 2) throw new Error(`Resource timeline requires at least two ${target} samples`);
    for (const sample of samples) {
      const recordedAt = Date.parse(sample.recordedAt);
      if (!Number.isFinite(recordedAt) || !Number.isInteger(sample.sequence) || sample.sequence < 1) {
        throw new Error(`${target} resource sample order is invalid`);
      }
      nonNegativeNumber(sample.cpuPercent, `${target} CPU`);
      positiveInteger(sample.memoryUsageBytes, `${target} memory`);
      positiveInteger(sample.pids, `${target} pids`);
      if (!Number.isInteger(sample.sharedMemoryUsageBytes) || sample.sharedMemoryUsageBytes < 0) {
        throw new Error(`${target} shared memory is invalid`);
      }
      if (target === "application" && !Number.isInteger(sample.processId)) {
        throw new Error("Application resource sample requires its process ID");
      }
      if (target !== "application" && !/^[a-f0-9]{12,64}$/.test(sample.containerId ?? "")) {
        throw new Error(`${target} resource sample requires its container ID`);
      }
      if (target === "browser" && !Number.isInteger(sample.processId)) {
        throw new Error("Browser resource sample requires its process ID");
      }
    }
    const series = Map.groupBy(samples, (sample) => target === "application" ? sample.processId : sample.containerId);
    for (const observations of series.values()) {
      if (observations.length < 2) throw new Error(`${target} resource timeline requires two samples per process`);
      let previousSequence;
      let previousTimestamp;
      for (const sample of observations) {
        const recordedAt = Date.parse(sample.recordedAt);
        const sequenceHasGap = previousSequence !== undefined && sample.sequence !== previousSequence + 1;
        const timestampHasGap = previousTimestamp !== undefined
          && (recordedAt <= previousTimestamp || recordedAt - previousTimestamp > timeline.intervalMs * 5);
        if (sequenceHasGap || timestampHasGap) {
          throw new Error(`${target} resource sampling gap or order is invalid`);
        }
        previousSequence = sample.sequence;
        previousTimestamp = recordedAt;
      }
    }
  }
}

export function validateResourceCoverage(timeline, attempt, lifecycle) {
  validateResourceTimeline(timeline);
  const attemptStartedAt = Date.parse(attempt?.startedAt);
  const attemptFinishedAt = Date.parse(attempt?.finishedAt);
  if (!Number.isFinite(attemptStartedAt) || !Number.isFinite(attemptFinishedAt)
      || attemptFinishedAt < attemptStartedAt) {
    throw new Error("Resource observation attempt boundaries are invalid");
  }
  const processes = lifecycle?.processes;
  if (!Array.isArray(processes) || processes.length === 0) {
    throw new Error("Resource observation requires browser lifecycle boundaries");
  }
  const maximumGap = timeline.intervalMs * 5;
  const processBounds = new Map();
  for (const process of processes) {
    const startedAt = Date.parse(process.startedAt);
    const finishedAt = Date.parse(process.finishedAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt
        || startedAt < attemptStartedAt || finishedAt > attemptFinishedAt
        || processBounds.has(process.processId)) {
      throw new Error("Resource observation browser boundaries are invalid");
    }
    processBounds.set(process.processId, { startedAt, finishedAt });
  }
  for (const sample of timeline.samples) {
    const recordedAt = Date.parse(sample.recordedAt);
    if (recordedAt < attemptStartedAt || recordedAt > attemptFinishedAt) {
      throw new Error("Resource sample falls outside its attempt");
    }
  }
  const browserStartedAt = Math.min(...[...processBounds.values()].map(({ startedAt }) => startedAt));
  const browserFinishedAt = Math.max(...[...processBounds.values()].map(({ finishedAt }) => finishedAt));
  for (const target of ["application", "proxy", "postgres"]) {
    const samples = timeline.samples.filter((sample) => sample.target === target);
    const identities = new Set(samples.map((sample) => target === "application"
      ? sample.processId : sample.containerId));
    if (identities.size !== 1
        || Date.parse(samples[0].recordedAt) > browserStartedAt + maximumGap
        || Date.parse(samples.at(-1).recordedAt) < browserFinishedAt - maximumGap) {
      throw new Error(`${target} resource observation does not cover the browser run`);
    }
  }
  const browserSeries = Map.groupBy(
    timeline.samples.filter((sample) => sample.target === "browser"),
    ({ containerId }) => containerId
  );
  if (browserSeries.size !== processBounds.size
      || [...browserSeries.keys()].some((containerId) => !processBounds.has(containerId))) {
    throw new Error("Browser resource observations do not match their lifecycle");
  }
  for (const [containerId, samples] of browserSeries) {
    const bounds = processBounds.get(containerId);
    const first = Date.parse(samples[0].recordedAt);
    const last = Date.parse(samples.at(-1).recordedAt);
    if (first < bounds.startedAt || first > bounds.startedAt + maximumGap
        || last > bounds.finishedAt || last < bounds.finishedAt - maximumGap
        || samples.some(({ recordedAt }) => {
          const timestamp = Date.parse(recordedAt);
          return timestamp < bounds.startedAt || timestamp > bounds.finishedAt;
        })) {
      throw new Error("Browser resource observation does not cover its lifecycle");
    }
  }
}

export const browserResourceTargets = Object.freeze([...targets]);
