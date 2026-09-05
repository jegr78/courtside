const targets = ["application", "proxy", "postgres", "browser"];
const profileNames = ["normal", "stress"];
const mebibyte = 1024 * 1024;

function positiveNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function nonNegativeNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
}

function roundUp(value, increment) {
  return Number((Math.ceil(value / increment) * increment).toFixed(4));
}

function peak(samples, target, field) {
  const values = samples.filter((sample) => sample.target === target).map((sample) => sample[field]);
  if (values.length === 0) throw new Error(`Reference measurements contain no ${target} samples`);
  values.forEach((value) => field === "pids" || field === "memoryUsageBytes"
    ? positiveInteger(value, `${target} ${field}`)
    : nonNegativeNumber(value, `${target} ${field}`));
  return Math.max(...values);
}

function derivedTarget(samples, target, factor) {
  return {
    cpu: roundUp(Math.max(0.05, peak(samples, target, "cpuPercent") / 100 * factor), 0.05),
    memoryMegabytes: roundUp(peak(samples, target, "memoryUsageBytes") / mebibyte * factor, 64),
    pids: roundUp(peak(samples, target, "pids") * factor, 16),
    sharedMemoryMegabytes: roundUp(Math.max(1, peak(samples, target, "sharedMemoryUsageBytes") / mebibyte) * factor, 16)
  };
}

export function deriveResourceProfiles(reference) {
  if (!/^[0-9a-f]{40}$/.test(reference.sourceCommit ?? "")) throw new Error("Reference source commit is invalid");
  if (!Number.isFinite(Date.parse(reference.measuredAt))) throw new Error("Reference timestamp is invalid");
  if (typeof reference.attemptId !== "string" || reference.attemptId.length === 0) {
    throw new Error("Reference attempt identity is missing");
  }
  const normalTargets = Object.fromEntries(targets.map((target) => [target, derivedTarget(reference.samples, target, 1.25)]));
  const contract = {
    schemaVersion: 1,
    derivation: {
      method: "normal=125%-of-reference-peaks-rounded-up; stress=75%-of-normal",
      reference: {
        sourceCommit: reference.sourceCommit,
        measuredAt: reference.measuredAt,
        attemptId: reference.attemptId,
        peaks: Object.fromEntries(targets.map((target) => [target, {
          cpuPercent: peak(reference.samples, target, "cpuPercent"),
          memoryUsageBytes: peak(reference.samples, target, "memoryUsageBytes"),
          pids: peak(reference.samples, target, "pids"),
          sharedMemoryUsageBytes: peak(reference.samples, target, "sharedMemoryUsageBytes")
        }]))
      }
    },
    profiles: {
      normal: { targets: normalTargets },
      stress: { targets: Object.fromEntries(targets.map((target) => [target, Object.fromEntries(
        Object.entries(normalTargets[target]).map(([field, value]) => [field, Number((value * 0.75).toFixed(4))]))])) }
    }
  };
  validateResourceProfileContract(contract);
  return contract;
}

export function validateResourceProfileContract(contract) {
  if (contract?.schemaVersion !== 1) throw new Error("Resource profile schema version is unsupported");
  if (contract.derivation?.method
      !== "normal=125%-of-reference-peaks-rounded-up; stress=75%-of-normal") {
    throw new Error("Resource profile derivation is unsupported");
  }
  if (!/^[0-9a-f]{40}$/.test(contract.derivation?.reference?.sourceCommit ?? "")
      || !Number.isFinite(Date.parse(contract.derivation?.reference?.measuredAt ?? ""))
      || typeof contract.derivation?.reference?.attemptId !== "string") {
    throw new Error("Resource profile reference provenance is invalid");
  }
  if (JSON.stringify(Object.keys(contract.derivation.reference.peaks ?? {})) !== JSON.stringify(targets)) {
    throw new Error("Resource profile reference peaks are incomplete");
  }
  for (const target of targets) {
    const peaks = contract.derivation.reference.peaks[target];
    nonNegativeNumber(peaks?.cpuPercent, `${target} reference CPU`);
    positiveInteger(peaks?.memoryUsageBytes, `${target} reference memory`);
    positiveInteger(peaks?.pids, `${target} reference PIDs`);
    nonNegativeNumber(peaks?.sharedMemoryUsageBytes, `${target} reference shared memory`);
  }
  if (JSON.stringify(Object.keys(contract.profiles ?? {})) !== JSON.stringify(profileNames)) {
    throw new Error("Resource profiles must contain only normal and stress in canonical order");
  }
  for (const profileName of profileNames) {
    const profileTargets = contract.profiles[profileName]?.targets;
    if (JSON.stringify(Object.keys(profileTargets ?? {})) !== JSON.stringify(targets)) {
      throw new Error(`${profileName} resource profile has an invalid target set`);
    }
    for (const target of targets) {
      const limits = profileTargets[target];
      if (JSON.stringify(Object.keys(limits ?? {}))
          !== JSON.stringify(["cpu", "memoryMegabytes", "pids", "sharedMemoryMegabytes"])) {
        throw new Error(`${profileName} ${target} limits are incomplete`);
      }
      positiveNumber(limits.cpu, `${profileName} ${target} CPU`);
      positiveNumber(limits.memoryMegabytes, `${profileName} ${target} memory`);
      positiveNumber(limits.pids, `${profileName} ${target} PIDs`);
      positiveNumber(limits.sharedMemoryMegabytes, `${profileName} ${target} shared memory`);
    }
  }
  for (const target of targets) {
    for (const field of ["cpu", "memoryMegabytes", "pids", "sharedMemoryMegabytes"]) {
      if (contract.profiles.stress.targets[target][field] > contract.profiles.normal.targets[target][field]) {
        throw new Error(`Stress ${target} ${field} exceeds the normal limit`);
      }
    }
  }
}

export function resourceLimits(contract, profileName, target) {
  validateResourceProfileContract(contract);
  if (!profileNames.includes(profileName)) throw new Error(`Unknown browser resource profile: ${profileName}`);
  if (!targets.includes(target)) throw new Error(`Unknown browser resource target: ${target}`);
  const limits = contract.profiles[profileName].targets[target];
  return {
    cpu: limits.cpu,
    memoryBytes: limits.memoryMegabytes * mebibyte,
    pids: Math.floor(limits.pids),
    sharedMemoryBytes: limits.sharedMemoryMegabytes * mebibyte
  };
}

export function assertHostCapacity(contract, profileName, capacity) {
  validateResourceProfileContract(contract);
  if (!profileNames.includes(profileName)) throw new Error(`Unknown browser resource profile: ${profileName}`);
  const required = targets.map((target) => resourceLimits(contract, profileName, target));
  const totals = {
    cpuCount: required.reduce((sum, limit) => sum + limit.cpu, 0),
    memoryBytes: required.reduce((sum, limit) => sum + limit.memoryBytes, 0),
    pids: required.reduce((sum, limit) => sum + limit.pids, 0),
    sharedMemoryBytes: Math.max(...required.map((limit) => limit.sharedMemoryBytes))
  };
  const shortages = [];
  if (capacity.cpuCount < totals.cpuCount) shortages.push(`CPU ${capacity.cpuCount}/${totals.cpuCount}`);
  if (capacity.memoryBytes < totals.memoryBytes) shortages.push(`memory ${capacity.memoryBytes}/${totals.memoryBytes}`);
  if (capacity.pids < totals.pids) shortages.push(`PIDs ${capacity.pids}/${totals.pids}`);
  if (capacity.sharedMemoryBytes < totals.sharedMemoryBytes) {
    shortages.push(`shared memory ${capacity.sharedMemoryBytes}/${totals.sharedMemoryBytes}`);
  }
  if (shortages.length > 0) throw new Error(`Host cannot provide browser resource profile ${profileName}: ${shortages.join(", ")}`);
}

export function validateResourceTimeline(timeline) {
  if (timeline?.schemaVersion !== 1) throw new Error("Resource timeline schema version is unsupported");
  positiveInteger(timeline.intervalMs, "Resource sampling interval");
  if (!Array.isArray(timeline.samples)) throw new Error("Resource timeline samples are missing");
  for (const target of targets) {
    const samples = timeline.samples.filter((sample) => sample.target === target);
    if (samples.length < 2) throw new Error(`Resource timeline requires at least two ${target} samples`);
    let previous = 0;
    for (const sample of samples) {
      if (!Number.isFinite(Date.parse(sample.recordedAt)) || !Number.isInteger(sample.sequence)
          || sample.sequence <= previous) throw new Error(`${target} resource sample order is invalid`);
      previous = sample.sequence;
      positiveNumber(sample.cpuPercent === 0 ? 1 : sample.cpuPercent, `${target} CPU`);
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
  }
}

export const browserResourceTargets = Object.freeze([...targets]);
