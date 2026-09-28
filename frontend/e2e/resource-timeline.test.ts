import { describe, expect, it, vi } from "vitest";
import {
  ApplicationLifecycle,
  applicationResourceCommand,
  applicationResourceUsage,
  containerResourceUsage,
  ResourceTimelineRecorder,
  sharedMemoryUsage,
  tickObservations
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

  it("given a stop that begins while the host reads its processes, when observing the application, then the tick keeps no application sample", async () => {
    // given
    const lifecycle = new ApplicationLifecycle();
    const application = { pid: 4224, exitCode: null };

    // when
    const observed = await lifecycle.observe(application, () => {
      lifecycle.stopping();
      return Promise.resolve("4224 1 264.0 0");
    }, "kibibytes");

    // then
    expect(observed, "a process the harness is stopping says nothing about a running application").toBeUndefined();
  });

  it("given a stop already under way, when a tick begins before the process has exited, then the tick keeps no application sample", async () => {
    // given
    const lifecycle = new ApplicationLifecycle();
    const application = { pid: 4224, exitCode: null };
    lifecycle.stopping();

    // when
    const observed = await lifecycle.observe(application, () => Promise.resolve("4224 1 264.0 0"), "kibibytes");

    // then
    expect(observed, "the exit the harness asked for may not have reached Node yet").toBeUndefined();
  });

  it("given the application started again after a stop, when a tick observes it, then its reading is recorded", async () => {
    // given
    const lifecycle = new ApplicationLifecycle();
    lifecycle.stopping();
    lifecycle.running();

    // when
    const observed = await lifecycle.observe({ pid: 4703, exitCode: null }, () => Promise.resolve("4703 1 3.0 1024"),
      "kibibytes");

    // then
    expect(observed, "a finished restart measures the new process again").toMatchObject({ processId: 4703 });
  });

  it("given an application that has already exited, when observing it, then the host is not asked", async () => {
    // given
    const lifecycle = new ApplicationLifecycle();
    const read = vi.fn(() => Promise.resolve("4224 1 1.0 1024"));

    // when
    const observed = await lifecycle.observe({ pid: 4224, exitCode: 143 }, read, "kibibytes");

    // then
    expect(observed).toBeUndefined();
    expect(read, "an exited process has no usage to read").not.toHaveBeenCalled();
  });

  it("given a running application, when observing it, then its reading is recorded as the host reports it", async () => {
    // given
    const lifecycle = new ApplicationLifecycle();
    const application = { pid: 1234, exitCode: null };

    // when
    const observed = await lifecycle.observe(application, () => Promise.resolve("1234 1 2.50 262144"), "kibibytes");

    // then
    expect(observed).toMatchObject({ processId: 1234, memoryUsageBytes: 268_435_456 });
    await expect(lifecycle.observe(application, () => Promise.resolve("1234 1 2.50 0"), "kibibytes"),
      "a zero reading outside a stop reaches the timeline, which rejects it").resolves.toMatchObject({ memoryUsageBytes: 0 });
  });

  it("given a tick without any observation, when collecting it, then no sample is recorded", () => {
    // given
    const proxy = { target: "proxy" as const, containerId: "a".repeat(64), memoryUsageBytes: 1, cpuPercent: 0, pids: 1,
      sharedMemoryUsageBytes: 0 };

    // when / then
    expect(tickObservations([undefined, proxy]), "the other targets stay when the application is skipped").toEqual([proxy]);
    expect(tickObservations([undefined]), "a tick with nothing observed is not a sample").toBeUndefined();
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
