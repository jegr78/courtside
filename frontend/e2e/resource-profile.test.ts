import { describe, expect, it, vi } from "vitest";
import {
  assertDockerResourceCapacity,
  configureResourceContainer,
  selectedResourceProfile
} from "./resource-profile";

describe("browser journey resource profiles", () => {
  it("given a selected normal profile, when configuring PostgreSQL, then every container limit is applied", () => {
    // given
    const container = {
      withResourcesQuota: vi.fn().mockReturnThis(),
      withSharedMemorySize: vi.fn().mockReturnThis(),
      withUlimits: vi.fn().mockReturnThis()
    };

    // when
    const configured = configureResourceContainer(container, "normal", "postgres");

    // then
    expect(configured).toBe(container);
    expect(container.withResourcesQuota).toHaveBeenCalledWith({ cpu: 0.35, memory: 0.125 });
    expect(container.withSharedMemorySize).toHaveBeenCalledWith(16_777_216);
    expect(container.withUlimits).toHaveBeenCalledWith({ nproc: { soft: 32, hard: 32 } });
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
