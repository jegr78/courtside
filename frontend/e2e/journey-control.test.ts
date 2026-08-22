import { describe, expect, it, vi } from "vitest";
import { connectJourneyService, startJourneyControl, type JourneyControlReference } from "./journey-control";
import type { DatabaseLock, JourneyService } from "./global-setup";

function journeyService(): { service: JourneyService; calls: Record<string, ReturnType<typeof vi.fn>> } {
  const lock: DatabaseLock = {
    waitForWaiters: vi.fn().mockResolvedValue("waiting"),
    release: vi.fn().mockResolvedValue(undefined)
  };
  const calls = {
    pinnedBrowser: vi.fn().mockResolvedValue("ws://127.0.0.1/browser"),
    releasePinnedBrowser: vi.fn().mockResolvedValue(undefined),
    browserDiagnostics: vi.fn().mockResolvedValue({ browserName: "webkit", containerState: { OOMKilled: false } }),
    executeSql: vi.fn().mockResolvedValue("result"),
    holdDatabaseLock: vi.fn().mockResolvedValue(lock),
    publishServiceWorkerUpdate: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined)
  };
  const service: JourneyService = {
    baseURL: "https://courtside.test",
    plainBaseURL: "http://courtside.test:8081",
    visualDate: "2026-05-13",
    pinnedBrowser: calls.pinnedBrowser,
    releasePinnedBrowser: calls.releasePinnedBrowser,
    browserDiagnostics: calls.browserDiagnostics,
    executeSql: calls.executeSql,
    holdDatabaseLock: calls.holdDatabaseLock,
    publishServiceWorkerUpdate: calls.publishServiceWorkerUpdate,
    reset: calls.reset,
    restart: calls.restart
  };
  return { service, calls };
}

describe("journey control", () => {
  it("given worker processes, when they use the shared control endpoint, then every journey operation reaches one service", async () => {
    // given
    const { service, calls } = journeyService();
    const control = await startJourneyControl(service);
    const remote = connectJourneyService(control.reference);

    try {
      // when
      const browser = await remote.pinnedBrowser("webkit");
      const diagnostics = await remote.browserDiagnostics("webkit", "browser-disconnected");
      await remote.releasePinnedBrowser("webkit");
      const sql = await remote.executeSql("SELECT 1");
      const lock = await remote.holdDatabaseLock("LOCK TABLE booking");
      const waiters = await lock.waitForWaiters(2);
      await lock.release();
      await remote.publishServiceWorkerUpdate();
      await remote.reset();
      await remote.restart();

      // then
      expect(remote).toMatchObject({
        baseURL: service.baseURL,
        plainBaseURL: service.plainBaseURL,
        visualDate: service.visualDate
      });
      expect(browser).toBe("ws://127.0.0.1/browser");
      expect(diagnostics).toMatchObject({ browserName: "webkit", containerState: { OOMKilled: false } });
      expect(sql).toBe("result");
      expect(waiters).toBe("waiting");
      expect(calls.pinnedBrowser).toHaveBeenCalledWith("webkit");
      expect(calls.browserDiagnostics).toHaveBeenCalledWith("webkit", "browser-disconnected");
      expect(calls.releasePinnedBrowser).toHaveBeenCalledWith("webkit");
      expect(calls.executeSql).toHaveBeenCalledWith("SELECT 1");
      expect(calls.holdDatabaseLock).toHaveBeenCalledWith("LOCK TABLE booking");
      expect(calls.publishServiceWorkerUpdate).toHaveBeenCalledOnce();
      expect(calls.reset).toHaveBeenCalledOnce();
      expect(calls.restart).toHaveBeenCalledOnce();
    } finally {
      await control.close();
    }
  });

  it("given an invalid control token, when a worker sends a command, then the service is not reached", async () => {
    // given
    const { service, calls } = journeyService();
    const control = await startJourneyControl(service);
    const invalid: JourneyControlReference = {
      ...control.reference,
      token: "invalid"
    };

    try {
      // when / then
      await expect(connectJourneyService(invalid).reset()).rejects.toThrow("Journey control endpoint not found");
      expect(calls.reset).not.toHaveBeenCalled();
    } finally {
      await control.close();
    }
  });
});
