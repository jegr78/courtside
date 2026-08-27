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
    recordBrowserTest: vi.fn().mockResolvedValue(undefined),
    executeSql: vi.fn().mockResolvedValue("result"),
    holdDatabaseLock: vi.fn().mockResolvedValue(lock),
    publishServiceWorkerUpdate: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined)
  };
  const service: JourneyService = {
    baseURL: "https://courtside.test",
    plainBaseURL: "http://courtside.test:8081",
    mailboxURL: "http://127.0.0.1:8025",
    visualDate: "2026-05-13",
    pinnedBrowser: calls.pinnedBrowser,
    releasePinnedBrowser: calls.releasePinnedBrowser,
    browserDiagnostics: calls.browserDiagnostics,
    recordBrowserTest: calls.recordBrowserTest,
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
      await remote.recordBrowserTest("webkit", "webkit-accessibility", 1, "start");
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
      expect(calls.browserDiagnostics).toHaveBeenCalledWith("webkit", "browser-disconnected", undefined);
      expect(calls.recordBrowserTest).toHaveBeenCalledWith("webkit", "webkit-accessibility", 1, "start");
      expect(calls.releasePinnedBrowser).toHaveBeenCalledWith("webkit");
      expect(calls.executeSql).toHaveBeenCalledWith("SELECT 1");
      expect(calls.holdDatabaseLock).toHaveBeenCalledWith("LOCK TABLE booking", expect.any(AbortSignal));
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

  it("given an unknown diagnostic reason, when a worker sends it, then no diagnostic is collected", async () => {
    // given
    const { service, calls } = journeyService();
    const control = await startJourneyControl(service);

    try {
      // when
      const response = await fetch(control.reference.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${control.reference.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ operation: "browserDiagnostics", browserName: "webkit", reason: "other" })
      });

      // then
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: "Journey control command requires a browser failure reason" });
      expect(calls.browserDiagnostics).not.toHaveBeenCalled();
    } finally {
      await control.close();
    }
  });

  it("given a failed test, when its diagnostics cross the control endpoint, then the test travels with them", async () => {
    // given
    const { service, calls } = journeyService();
    const control = await startJourneyControl(service);
    const remote = connectJourneyService(control.reference);

    try {
      // when
      await remote.browserDiagnostics("webkit", "product-failure", {
        title: "an installed PWA preserves the signed-in journey",
        projectName: "webkit-pwa",
        status: "failed",
        errors: ["expect(locator).toBeVisible() failed"]
      });

      // then — a retained file that cannot name the test is a file nobody can act on
      expect(calls.browserDiagnostics).toHaveBeenCalledWith("webkit", "product-failure", {
        title: "an installed PWA preserves the signed-in journey",
        projectName: "webkit-pwa",
        status: "failed",
        errors: ["expect(locator).toBeVisible() failed"]
      });
    } finally {
      await control.close();
    }
  });

  it("given a malformed failed test, when it arrives at the control endpoint, then it is refused rather than stored", async () => {
    // given
    const { service, calls } = journeyService();
    const control = await startJourneyControl(service);

    try {
      // when
      const response = await fetch(control.reference.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${control.reference.token}`
        },
        body: JSON.stringify({
          operation: "browserDiagnostics", browserName: "webkit", reason: "product-failure",
          failedTest: { title: 7, projectName: "webkit-pwa", status: "failed", errors: [] }
        })
      });

      // then
      expect(response.status).toBe(500);
      expect(calls.browserDiagnostics).not.toHaveBeenCalled();
    } finally {
      await control.close();
    }
  });
});
