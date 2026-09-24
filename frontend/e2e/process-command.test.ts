import { describe, expect, it, vi } from "vitest";
import { runJourneyProcess, type ProcessExecutor } from "./process-command";

describe("journey process commands", () => {
  it("given a command outlives the obsolete inner deadline, when it finishes, then its result is retained", async () => {
    // given
    vi.useFakeTimers();
    const execute = vi.fn<ProcessExecutor>((_command, _args, options) => {
      expect(options).not.toHaveProperty("timeout");
      return new Promise((resolve) => setTimeout(() => resolve({ stdout: "complete" }), 5_001));
    });

    try {
      // when
      const running = runJourneyProcess("docker", ["stats", "--no-stream"], execute);
      await vi.advanceTimersByTimeAsync(5_001);

      // then
      await expect(running).resolves.toBe("complete");
      expect(execute).toHaveBeenCalledWith("docker", ["stats", "--no-stream"], {
        encoding: "utf8", maxBuffer: 1024 * 1024
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("given a process fails, when it exits, then the original failure remains", async () => {
    // given
    const execute = vi.fn<ProcessExecutor>().mockRejectedValue(new Error("docker daemon refused the command"));

    // when / then
    await expect(runJourneyProcess("docker", ["inspect", "missing"], execute))
      .rejects.toThrow("docker daemon refused the command");
  });
});
