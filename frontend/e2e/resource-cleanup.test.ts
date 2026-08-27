import { describe, expect, it, vi } from "vitest";
import { completeCleanup } from "./resource-cleanup";

describe("journey resource cleanup", () => {
  it("givenOneCleanupFails_whenCompletingTheJourney_thenEveryOwnedResourceIsStillAttempted", async () => {
    // given
    const first = vi.fn().mockRejectedValue(new Error("browser cleanup failed"));
    const second = vi.fn().mockResolvedValue(undefined);
    const third = vi.fn().mockRejectedValue(new Error("network cleanup failed"));

    // when / then
    await expect(completeCleanup([first, second, third])).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: "browser cleanup failed" }),
        expect.objectContaining({ message: "network cleanup failed" })]
    });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(third).toHaveBeenCalledOnce();
  });
});
