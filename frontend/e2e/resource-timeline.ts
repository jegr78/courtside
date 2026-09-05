export type ResourceTarget = "application" | "proxy" | "postgres" | "browser";

export interface ResourceObservation {
  target: ResourceTarget;
  containerId?: string;
  processId?: number;
  cpuPercent: number;
  memoryUsageBytes: number;
  pids: number;
  sharedMemoryUsageBytes: number;
}

export interface ResourceSample extends ResourceObservation {
  recordedAt: string;
  sequence: number;
}

function memoryBytes(value: string): number {
  const amount = /^(?<number>[0-9]+(?:\.[0-9]+)?)(?<unit>B|kB|KiB|MB|MiB|GB|GiB)$/.exec(value.trim());
  if (!amount?.groups) throw new Error("Docker reported an unsupported resource memory value");
  const factors: Record<string, number> = {
    B: 1, kB: 1_000, KiB: 1_024, MB: 1_000_000, MiB: 1_048_576, GB: 1_000_000_000, GiB: 1_073_741_824
  };
  return Math.round(Number(amount.groups.number) * factors[amount.groups.unit]);
}

export function containerResourceUsage(stats: unknown): Pick<ResourceObservation,
  "memoryUsageBytes" | "cpuPercent" | "pids"> {
  const input = stats as { MemUsage?: unknown; CPUPerc?: unknown; PIDs?: unknown };
  if (typeof input.MemUsage !== "string" || typeof input.CPUPerc !== "string" || typeof input.PIDs !== "string") {
    throw new Error("Docker reported malformed container resource usage");
  }
  const cpu = /^(?<percent>[0-9]+(?:\.[0-9]+)?)%$/.exec(input.CPUPerc.trim())?.groups?.percent;
  const pids = Number(input.PIDs.trim());
  if (cpu === undefined || !Number.isInteger(pids) || pids < 1) {
    throw new Error("Docker reported unsupported CPU or PID resource usage");
  }
  return { memoryUsageBytes: memoryBytes(input.MemUsage.split("/")[0]), cpuPercent: Number(cpu), pids };
}

export function applicationResourceUsage(output: string, processId: number): Omit<ResourceObservation, "target"> {
  const values = /^(?<cpu>[0-9]+(?:\.[0-9]+)?)\s+(?<rss>[0-9]+)$/.exec(output.trim())?.groups;
  if (!values || !Number.isInteger(processId) || processId < 1) {
    throw new Error("Host reported malformed application process resource usage");
  }
  return {
    processId,
    cpuPercent: Number(values.cpu),
    memoryUsageBytes: Number(values.rss) * 1024,
    pids: 1,
    sharedMemoryUsageBytes: 0
  };
}

export function sharedMemoryUsage(output: string): number {
  const lines = output.trim().split("\n");
  const fields = lines.at(-1)?.trim().split(/\s+/);
  const kibibytes = Number(fields?.[2]);
  if (!Number.isInteger(kibibytes) || kibibytes < 0 || fields?.at(-1) !== "/dev/shm") {
    throw new Error("Container reported malformed shared memory usage");
  }
  return kibibytes * 1024;
}

export class ResourceTimelineRecorder {
  private readonly samples: ResourceSample[] = [];
  private sequence = 0;

  constructor(private readonly intervalMs: number) {
    if (!Number.isInteger(intervalMs) || intervalMs < 1) throw new Error("Resource sampling interval must be positive");
  }

  append(observations: ResourceObservation[], recordedAt: string): void {
    if (!Number.isFinite(Date.parse(recordedAt))) throw new Error("Resource sample timestamp is invalid");
    this.sequence += 1;
    this.samples.push(...observations.map((observation) => ({ ...observation, recordedAt, sequence: this.sequence })));
  }

  evidence(): { schemaVersion: 1; intervalMs: number; samples: ResourceSample[] } {
    return { schemaVersion: 1, intervalMs: this.intervalMs, samples: structuredClone(this.samples) };
  }
}
