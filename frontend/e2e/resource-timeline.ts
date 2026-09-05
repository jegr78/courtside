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

export interface ApplicationResourceCommand {
  command: string;
  args: string[];
  memoryUnit: "bytes" | "kibibytes";
}

export function applicationResourceCommand(hostPlatform: NodeJS.Platform, processId: number): ApplicationResourceCommand {
  if (!Number.isInteger(processId) || processId < 1) throw new Error("Application process ID must be positive");
  if (hostPlatform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command",
        "$perf=@{}; Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ForEach-Object {$perf[$_.IDProcess]=$_}; "
          + "Get-CimInstance Win32_Process | ForEach-Object {$m=$perf[$_.ProcessId]; "
          + "if ($m) {Write-Output \"$($_.ProcessId) $($_.ParentProcessId) $($m.PercentProcessorTime) $($m.WorkingSetPrivate)\"}}"],
      memoryUnit: "bytes"
    };
  }
  return { command: "/bin/ps", args: ["-axo", "pid=,ppid=,%cpu=,rss="], memoryUnit: "kibibytes" };
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

export function applicationResourceUsage(output: string, processId: number,
  memoryUnit: ApplicationResourceCommand["memoryUnit"] = "kibibytes"): Omit<ResourceObservation, "target"> {
  if (!Number.isInteger(processId) || processId < 1) {
    throw new Error("Host reported malformed application process resource usage");
  }
  const processes = output.trim().split("\n").map((line) => {
    const values = /^(?<pid>[0-9]+)\s+(?<parent>[0-9]+)\s+(?<cpu>[0-9]+(?:\.[0-9]+)?)\s+(?<rss>[0-9]+)$/.exec(line.trim())?.groups;
    if (!values) throw new Error("Host reported malformed application process resource usage");
    return { pid: Number(values.pid), parent: Number(values.parent), cpu: Number(values.cpu), rss: Number(values.rss) };
  });
  if (!processes.some((process) => process.pid === processId)) {
    throw new Error("Host reported no application process resource usage");
  }
  const owned = new Set([processId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (owned.has(process.parent) && !owned.has(process.pid)) {
        owned.add(process.pid);
        changed = true;
      }
    }
  }
  const usage = processes.filter((process) => owned.has(process.pid));
  return {
    processId,
    cpuPercent: usage.reduce((sum, process) => sum + process.cpu, 0),
    memoryUsageBytes: usage.reduce((sum, process) => sum + process.rss, 0)
      * (memoryUnit === "kibibytes" ? 1024 : 1),
    pids: usage.length,
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
