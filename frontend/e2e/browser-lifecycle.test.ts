import { describe, expect, it } from "vitest";
import { browserExitState, browserResourceUsage, BrowserLifecycleRecorder } from "./browser-lifecycle";

describe("browser lifecycle evidence", () => {
  it("givenDockerStats_whenReadingBrowserUsage_thenCPUAndMemoryBecomeNumbers", () => {
    // given / when
    const usage = browserResourceUsage({ MemUsage: "128.5MiB / 8GiB", CPUPerc: "3.25%" });

    // then
    expect(usage).toEqual({ memoryUsageBytes: 134_742_016, cpuPercent: 3.25 });
  });

  it("givenOneBrowserProcess_whenRecordingTestsAndExit_thenItsIdentityAndHistoryRemain", () => {
    // given
    const recorder = new BrowserLifecycleRecorder();
    recorder.start("webkit", "a".repeat(64), "2026-08-27T08:00:00.000Z");

    // when
    recorder.sample("webkit", "webkit-accessibility", 1, "start",
      { memoryUsageBytes: 100, cpuPercent: 1 }, "2026-08-27T08:00:01.000Z");
    recorder.sample("webkit", "webkit-accessibility", 1, "end",
      { memoryUsageBytes: 120, cpuPercent: 2 }, "2026-08-27T08:00:02.000Z");
    recorder.finish("webkit", { exitCode: 0, oomKilled: false, hasError: false }, "2026-08-27T08:00:03.000Z");

    // then
    expect(recorder.evidence().processes).toEqual([expect.objectContaining({
      processId: "a".repeat(64), projectName: "webkit-accessibility", durationMs: 3_000,
      exitState: { exitCode: 0, oomKilled: false, hasError: false },
      samples: [expect.objectContaining({ testPosition: 1, phase: "start" }),
        expect.objectContaining({ testPosition: 1, phase: "end" })]
    })]);
  });

  it("givenMalformedOrCrossProjectMeasurements_whenRecordingEvidence_thenItFailsClosed", () => {
    // given
    const recorder = new BrowserLifecycleRecorder();
    recorder.start("webkit", "b".repeat(64), "2026-08-27T08:00:00.000Z");
    recorder.sample("webkit", "first", 1, "start", { memoryUsageBytes: 1, cpuPercent: 0 },
      "2026-08-27T08:00:01.000Z");

    // when / then
    expect(() => browserResourceUsage({ MemUsage: "secret", CPUPerc: "unknown" })).toThrow("memory value");
    expect(() => browserExitState({ ExitCode: "0", OOMKilled: false, Error: "" })).toThrow("exit state");
    expect(() => recorder.sample("webkit", "second", 2, "start", { memoryUsageBytes: 1, cpuPercent: 0 },
      "2026-08-27T08:00:02.000Z")).toThrow("two projects");
  });

  it("givenDockerExitState_whenProjectingRetainedEvidence_thenRawErrorTextIsNotRetained", () => {
    // given / when
    const state = browserExitState({ ExitCode: 137, OOMKilled: true, Error: "runtime detail" });

    // then
    expect(state).toEqual({ exitCode: 137, oomKilled: true, hasError: true });
    expect(JSON.stringify(state)).not.toContain("runtime detail");
  });
});
