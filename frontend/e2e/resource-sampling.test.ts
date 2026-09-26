import { describe, expect, it, vi } from "vitest";
import { ResourceSampling, type ResourceSampleSchedule } from "./resource-sampling";

function controlledSchedule(): { schedule: ResourceSampleSchedule; observe: () => void; cancelled: ReturnType<typeof vi.fn> } {
  let callback: () => void = () => undefined;
  const cancelled = vi.fn();
  return {
    schedule: {
      every: (scheduled) => {
        callback = scheduled;
        return "resource-sampler";
      },
      cancel: cancelled
    },
    observe: () => callback(),
    cancelled
  };
}

describe("resource sampling", () => {
  it("does not let a transient periodic observation poison a successful lifecycle boundary", async () => {
    // given
    const samples = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("transient Docker stats failure"))
      .mockResolvedValueOnce(undefined);
    const timer = controlledSchedule();
    const sampling = new ResourceSampling(samples, 1_000, timer.schedule);
    await sampling.start();

    // when
    timer.observe();

    // then
    await expect(sampling.captureBoundary()).resolves.toBeUndefined();
    expect(samples).toHaveBeenCalledTimes(3);
    expect(timer.cancelled).toHaveBeenCalledWith("resource-sampler");
  });

  it("fails closed when the lifecycle boundary itself cannot be observed", async () => {
    // given
    const samples = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("browser boundary unavailable"));
    const timer = controlledSchedule();
    const sampling = new ResourceSampling(samples, 1_000, timer.schedule);
    await sampling.start();

    // when / then
    await expect(sampling.captureBoundary()).rejects.toThrow("browser boundary unavailable");
  });
});
