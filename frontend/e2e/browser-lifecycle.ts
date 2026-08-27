export interface BrowserResourceSample {
  recordedAt: string;
  testPosition: number;
  phase: "start" | "end";
  memoryUsageBytes: number;
  cpuPercent: number;
}

export interface BrowserExitState {
  exitCode: number;
  oomKilled: boolean;
  hasError: boolean;
}

export interface BrowserProcessEvidence {
  processId: string;
  browserName: string;
  projectName?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  samples: BrowserResourceSample[];
  exitState?: BrowserExitState;
}

function memoryBytes(value: string): number {
  const amount = /^(?<number>[0-9]+(?:\.[0-9]+)?)(?<unit>B|kB|KiB|MB|MiB|GB|GiB)$/.exec(value.trim());
  if (!amount?.groups) throw new Error("Docker reported an unsupported browser memory value");
  const factors: Record<string, number> = {
    B: 1, kB: 1_000, KiB: 1_024, MB: 1_000_000, MiB: 1_048_576, GB: 1_000_000_000, GiB: 1_073_741_824
  };
  return Math.round(Number(amount.groups.number) * factors[amount.groups.unit]);
}

export function browserResourceUsage(stats: unknown): { memoryUsageBytes: number; cpuPercent: number } {
  const input = stats as { MemUsage?: unknown; CPUPerc?: unknown };
  if (typeof input.MemUsage !== "string" || typeof input.CPUPerc !== "string") {
    throw new Error("Docker reported malformed browser resource usage");
  }
  const memory = input.MemUsage.split("/")[0];
  const memoryUsageBytes = memoryBytes(memory);
  const cpu = /^(?<percent>[0-9]+(?:\.[0-9]+)?)%$/.exec(input.CPUPerc.trim())?.groups?.percent;
  if (cpu === undefined) throw new Error("Docker reported an unsupported browser CPU value");
  return { memoryUsageBytes, cpuPercent: Number(cpu) };
}

export function browserExitState(state: unknown): BrowserExitState {
  const input = state as { ExitCode?: unknown; OOMKilled?: unknown; Error?: unknown };
  if (!Number.isInteger(input.ExitCode) || (input.ExitCode as number) < 0
    || typeof input.OOMKilled !== "boolean" || typeof input.Error !== "string") {
    throw new Error("Docker reported a malformed browser exit state");
  }
  return { exitCode: input.ExitCode as number, oomKilled: input.OOMKilled, hasError: input.Error.length > 0 };
}

export class BrowserLifecycleRecorder {
  private readonly processes: BrowserProcessEvidence[] = [];
  private readonly running = new Map<string, BrowserProcessEvidence>();

  start(browserName: string, processId: string, startedAt: string): void {
    if (this.running.has(browserName)) throw new Error(`A ${browserName} browser process is already recorded`);
    const process = { browserName, processId, startedAt, samples: [] };
    this.processes.push(process);
    this.running.set(browserName, process);
  }

  sample(browserName: string, projectName: string, testPosition: number,
    phase: "start" | "end", usage: { memoryUsageBytes: number; cpuPercent: number }, recordedAt: string): void {
    const process = this.running.get(browserName);
    if (!process) throw new Error(`No ${browserName} browser process is being recorded`);
    if (process.projectName !== undefined && process.projectName !== projectName) {
      throw new Error("One browser process cannot belong to two projects");
    }
    process.projectName = projectName;
    process.samples.push({ recordedAt, testPosition, phase, ...usage });
  }

  finish(browserName: string, exitState: BrowserExitState, finishedAt: string): void {
    const process = this.running.get(browserName);
    if (!process) throw new Error(`No ${browserName} browser process is being recorded`);
    process.finishedAt = finishedAt;
    process.durationMs = Date.parse(finishedAt) - Date.parse(process.startedAt);
    process.exitState = exitState;
    this.running.delete(browserName);
  }

  evidence(): { schemaVersion: 1; processes: BrowserProcessEvidence[] } {
    return { schemaVersion: 1, processes: structuredClone(this.processes) };
  }
}
