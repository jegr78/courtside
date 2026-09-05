import { describe, expect, it, vi } from "vitest";
import {
  assertDockerResourceCapacity,
  assertedContainerLimits,
  configureResourceContainer,
  enforceContainerPidLimit,
  selectedResourceProfile
} from "./resource-profile";

describe("browser journey resource profiles", () => {
  it("given a selected normal profile, when configuring PostgreSQL, then every container limit is applied", () => {
    // given
    const container = {
      withResourcesQuota: vi.fn().mockReturnThis(),
      withSharedMemorySize: vi.fn().mockReturnThis()
    };

    // when
    const configured = configureResourceContainer(container, "normal", "postgres");

    // then
    expect(configured).toBe(container);
    expect(container.withResourcesQuota).toHaveBeenCalledWith({ cpu: 0.3, memory: 0.125 });
    expect(container.withSharedMemorySize).toHaveBeenCalledWith(16_777_216);
  });

  it("given a selected profile, when enforcing process capacity, then the cgroup limit must match", async () => {
    // given
    const docker = vi.fn((args: string[]) => Promise.resolve(args[0] === "inspect" ? "32\n" : ""));

    // when
    await enforceContainerPidLimit("a".repeat(64), "normal", "postgres", docker);

    // then
    expect(docker).toHaveBeenCalledWith(["update", "--pids-limit", "32", "a".repeat(64)]);
    expect(docker).toHaveBeenCalledWith(["inspect", "--format", "{{.HostConfig.PidsLimit}}", "a".repeat(64)]);
    await expect(enforceContainerPidLimit("a".repeat(64), "normal", "postgres",
      () => Promise.resolve("31"))).rejects.toThrow("expected 32");
  });

  it("given Docker reports a started container, when retaining its limits, then every selected value must match", () => {
    // given
    const observed = { Memory: 134_217_728, NanoCpus: 300_000_000, PidsLimit: 32, ShmSize: 16_777_216 };

    // when / then
    expect(assertedContainerLimits("normal", "postgres", observed)).toEqual({
      memoryBytes: 134_217_728, nanoCpus: 300_000_000, pids: 32, sharedMemoryBytes: 16_777_216
    });
    expect(() => assertedContainerLimits("normal", "postgres", { ...observed, ShmSize: 67_108_864 }))
      .toThrow(/postgres.*shared memory/i);
  });

  it("given reliability execution, when no or an unknown profile is selected, then it fails closed", () => {
    // given / when / then
    expect(selectedResourceProfile({ COURTSIDE_WEBKIT_RELIABILITY: "true" })).toBe("normal");
    expect(selectedResourceProfile({ COURTSIDE_WEBKIT_RELIABILITY: "true",
      COURTSIDE_BROWSER_RESOURCE_PROFILE: "stress" })).toBe("stress");
    expect(selectedResourceProfile({ COURTSIDE_WEBKIT_RELIABILITY: "true",
      COURTSIDE_BROWSER_RESOURCE_PROFILE: "reference" })).toBe("reference");
    expect(() => selectedResourceProfile({ COURTSIDE_BROWSER_RESOURCE_PROFILE: "large" })).toThrow("Unsupported");
  });

  it("given Docker lacks selected capacity or PID limiting, when preflighting, then startup reports the missing contract", () => {
    // given / when / then
    expect(() => assertDockerResourceCapacity("normal", {
      NCPU: 2, MemTotal: 1_000_000_000, PidsLimit: false, MemoryLimit: true
    })).toThrow(/normal.*CPU.*memory.*PID/i);
    expect(() => assertDockerResourceCapacity("normal", {
      NCPU: 8, MemTotal: 8_000_000_000, PidsLimit: true, MemoryLimit: true
    })).not.toThrow();
  });
});
