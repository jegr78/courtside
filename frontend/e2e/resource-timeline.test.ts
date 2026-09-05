import { describe, expect, it } from "vitest";
import {
  applicationResourceCommand,
  applicationResourceUsage,
  containerResourceUsage,
  ResourceTimelineRecorder,
  sharedMemoryUsage
} from "./resource-timeline";

describe("journey resource timeline", () => {
  it("given Docker and process observations, when parsing usage, then every bounded metric is retained", () => {
    // given / when
    const container = containerResourceUsage({ MemUsage: "128.5MiB / 1GiB", CPUPerc: "3.25%", PIDs: "17" });
    const application = applicationResourceUsage("1234 1 2.50 262144\n1235 1234 0.50 1024\n2000 1 9.0 999", 1234);

    // then
    expect(container).toEqual({ memoryUsageBytes: 134_742_016, cpuPercent: 3.25, pids: 17 });
    expect(application).toEqual({ memoryUsageBytes: 269_484_032, cpuPercent: 3, pids: 2,
      sharedMemoryUsageBytes: 0, processId: 1234 });
    expect(sharedMemoryUsage("Filesystem 1024-blocks Used Available Capacity Mounted on\nshm 65536 512 65024 1% /dev/shm"))
      .toBe(524_288);
  });

  it("given a supported host, when selecting process telemetry, then it uses a fixed platform command", () => {
    // given / when
    const unix = applicationResourceCommand("linux", 1234);
    const windows = applicationResourceCommand("win32", 1234);

    // then
    expect(unix).toEqual({ command: "/bin/ps", args: ["-axo", "pid=,ppid=,%cpu=,rss="],
      memoryUnit: "kibibytes" });
    expect(windows.command).toBe("powershell.exe");
    expect(windows.args.at(-1)).toContain("Win32_Process");
    expect(applicationResourceUsage("1234 1 2.50 268435456", 1234, windows.memoryUnit).memoryUsageBytes)
      .toBe(268_435_456);
  });

  it("given all journey resources, when sampling twice, then identities and chronological evidence remain", () => {
    // given
    const recorder = new ResourceTimelineRecorder(1_000);
    const observations = [
      { target: "application" as const, processId: 1234, cpuPercent: 1, memoryUsageBytes: 10,
        pids: 1, sharedMemoryUsageBytes: 0 },
      { target: "proxy" as const, containerId: "a".repeat(64), cpuPercent: 2, memoryUsageBytes: 20,
        pids: 2, sharedMemoryUsageBytes: 1 },
      { target: "postgres" as const, containerId: "b".repeat(64), cpuPercent: 3, memoryUsageBytes: 30,
        pids: 3, sharedMemoryUsageBytes: 2 },
      { target: "browser" as const, containerId: "c".repeat(64), processId: 77, cpuPercent: 4,
        memoryUsageBytes: 40, pids: 4, sharedMemoryUsageBytes: 3 }
    ];

    // when
    recorder.append(observations, "2026-09-05T08:00:01.000Z");
    recorder.append(observations, "2026-09-05T08:00:02.000Z");

    // then
    const evidence = recorder.evidence();
    expect(evidence).toMatchObject({ schemaVersion: 1, intervalMs: 1_000 });
    expect(evidence.samples).toHaveLength(8);
    expect(evidence.samples.slice(0, 5)).toEqual([
      expect.objectContaining({ sequence: 1, target: "application", processId: 1234 }),
      expect.objectContaining({ sequence: 1, target: "proxy", containerId: "a".repeat(64) }),
      expect.objectContaining({ sequence: 1, target: "postgres", containerId: "b".repeat(64) }),
      expect.objectContaining({ sequence: 1, target: "browser", processId: 77 }),
      expect.objectContaining({ sequence: 2, target: "application" })
    ]);
  });

  it("given malformed resource output, when parsing it, then evidence collection fails closed", () => {
    // given / when / then
    expect(() => containerResourceUsage({ MemUsage: "unknown", CPUPerc: "3%", PIDs: "1" }))
      .toThrow("memory");
    expect(() => applicationResourceUsage("secret", 1234)).toThrow("process resource");
    expect(() => applicationResourceCommand("linux", 0)).toThrow("process ID");
    expect(() => sharedMemoryUsage("no mounted filesystem")).toThrow("shared memory");
  });
});
