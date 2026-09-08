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
      let previousSequence = 0;
      let previousTimestamp;
      for (const sample of observations) {
        const recordedAt = Date.parse(sample.recordedAt);
        if (sample.sequence <= previousSequence
            || previousTimestamp !== undefined && recordedAt - previousTimestamp > timeline.intervalMs * 5) {
          throw new Error(`${target} resource sampling gap or order is invalid`);
        }
        previousSequence = sample.sequence;
        previousTimestamp = recordedAt;
      }
    }
  }
}

export const browserResourceTargets = Object.freeze([...targets]);
