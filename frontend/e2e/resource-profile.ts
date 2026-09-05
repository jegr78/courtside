import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ResourceProfileName = "normal" | "stress";
type ResourceExecutionMode = ResourceProfileName | "reference";
type ContainerResourceTarget = "proxy" | "postgres" | "browser";

interface ResourceLimits {
  cpu: number;
  memoryMegabytes: number;
  pids: number;
  sharedMemoryMegabytes: number;
}

interface ResourceProfileContract {
  profiles: Record<ResourceProfileName, { targets: Record<ContainerResourceTarget | "application", ResourceLimits> }>;
}

interface ConfigurableContainer {
  withResourcesQuota(quota: { cpu: number; memory: number }): this;
  withSharedMemorySize(bytes: number): this;
}

interface DockerCapacity {
  NCPU?: unknown;
  MemTotal?: unknown;
  PidsLimit?: unknown;
  MemoryLimit?: unknown;
}

const mebibytesPerGibibyte = 1024;
const bytesPerMebibyte = 1024 * 1024;
const contract = JSON.parse(readFileSync(
  resolve("../quality/browser-resource-profiles.json"), "utf8")) as ResourceProfileContract;

export function selectedResourceProfile(environment: NodeJS.ProcessEnv | Record<string, string | undefined>):
  ResourceExecutionMode | undefined {
  const selected = environment.COURTSIDE_BROWSER_RESOURCE_PROFILE;
  if (selected === undefined && environment.COURTSIDE_WEBKIT_RELIABILITY !== "true") return undefined;
  if (selected === undefined) return "normal";
  if (selected !== "normal" && selected !== "stress" && selected !== "reference") {
    throw new Error(`Unsupported browser resource profile: ${selected}`);
  }
  return selected;
}

export function configureResourceContainer<T extends ConfigurableContainer>(container: T,
  profile: ResourceExecutionMode | undefined, target: ContainerResourceTarget): T {
  if (!profile || profile === "reference") return container;
  const limits = contract.profiles[profile].targets[target];
  return container
    .withResourcesQuota({ cpu: limits.cpu, memory: limits.memoryMegabytes / mebibytesPerGibibyte })
    .withSharedMemorySize(limits.sharedMemoryMegabytes * bytesPerMebibyte);
}

export async function enforceContainerPidLimit(containerId: string, profile: ResourceExecutionMode | undefined,
  target: ContainerResourceTarget, docker: (args: string[]) => Promise<string>): Promise<void> {
  if (!profile || profile === "reference") return;
  const pids = contract.profiles[profile].targets[target].pids;
  await docker(["update", "--pids-limit", String(pids), containerId]);
  const observed = Number(await docker(["inspect", "--format", "{{.HostConfig.PidsLimit}}", containerId]));
  if (observed !== pids) throw new Error(`${target} PID limit is ${observed}, expected ${pids}`);
}

export function assertDockerResourceCapacity(profile: ResourceProfileName, observed: unknown): void {
  const capacity = observed as DockerCapacity;
  const limits = Object.values(contract.profiles[profile].targets);
  const requiredCpu = limits.reduce((sum, value) => sum + value.cpu, 0);
  const requiredMemory = limits.reduce((sum, value) => sum + value.memoryMegabytes * bytesPerMebibyte, 0);
  const failures: string[] = [];
  if (typeof capacity.NCPU !== "number" || capacity.NCPU < requiredCpu) {
    failures.push(`CPU ${String(capacity.NCPU)}/${requiredCpu}`);
  }
  if (capacity.MemoryLimit !== true || typeof capacity.MemTotal !== "number" || capacity.MemTotal < requiredMemory) {
    failures.push(`memory ${String(capacity.MemTotal)}/${requiredMemory}`);
  }
  if (capacity.PidsLimit !== true) failures.push("PID limiting unavailable");
  if (failures.length > 0) {
    throw new Error(`Docker cannot provide browser resource profile ${profile}: ${failures.join(", ")}`);
  }
}

export function applicationResourceLimits(profile: ResourceExecutionMode | undefined): ResourceLimits | undefined {
  return profile && profile !== "reference" ? contract.profiles[profile].targets.application : undefined;
}
