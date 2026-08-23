import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { collectBrowserDiagnostics, observeBrowserDisconnect, retainBrowserDiagnostics } from "./browser-diagnostics";

describe("browser diagnostics", () => {
  it("given a connected browser, when its server disappears, then diagnostics finish before worker cleanup", async () => {
    // given
    const browser = new EventEmitter();
    const diagnose = vi.fn().mockResolvedValue(undefined);
    const finish = observeBrowserDisconnect(browser, diagnose);

    // when
    browser.emit("disconnected");
    await finish();

    // then
    expect(diagnose).toHaveBeenCalledOnce();
    expect(browser.listenerCount("disconnected")).toBe(0);
  });

  it("given diagnosis fails after a disconnect, when cleanup has not started, then the rejection is already handled", async () => {
    // given
    const browser = new EventEmitter();
    const failure = new Error("control unavailable");
    const diagnosis = Promise.reject(failure);
    let rejectionHandlerAttached = false;
    const then = diagnosis.then.bind(diagnosis);
    diagnosis.then = ((fulfilled, rejected) => {
      rejectionHandlerAttached ||= rejected !== undefined;
      return then(fulfilled, rejected);
    }) as typeof diagnosis.then;
    const finish = observeBrowserDisconnect(browser, () => diagnosis);

    // when
    browser.emit("disconnected");

    // then
    expect(rejectionHandlerAttached).toBe(true);
    await expect(finish()).rejects.toBe(failure);
    expect(browser.listenerCount("disconnected")).toBe(0);
  });

  it("given a browser container that was killed, when collecting diagnostics, then its cause and bounded logs are retained", async () => {
    // given
    const command = vi.fn((args: string[]) => {
      if (args[0] === "inspect") {
        return Promise.resolve(JSON.stringify({ Status: "exited", ExitCode: 137, OOMKilled: true }));
      }
      if (args[0] === "stats") return Promise.resolve(JSON.stringify({ MemUsage: "1.9GiB / 2GiB", CPUPerc: "99%" }));
      return Promise.resolve([
        "listening on ws://127.0.0.1:3000/capability-secret",
        "request https://courtside.example/api/session?token=query-secret",
        "Cookie=session-secret",
        "Authorization: Bearer opaqueCredentialWithTwentyFourCharacters",
        "Set-Cookie: sid=short",
        '{"password":"tiny","api_key":"also-short","token":"brief"}'
      ].join("\n"));
    });

    // when
    const diagnostics = await collectBrowserDiagnostics("container-1", "webkit", "browser-disconnected", command);

    // then
    expect(diagnostics).toMatchObject({
      browserName: "webkit",
      reason: "browser-disconnected",
      containerId: "container-1",
      containerState: { Status: "exited", ExitCode: 137, OOMKilled: true },
      containerStats: { MemUsage: "1.9GiB / 2GiB", CPUPerc: "99%" },
      diagnosticErrors: []
    });
    expect(diagnostics.containerLogs).toContain("ws://127.0.0.1:3000/<redacted>");
    expect(diagnostics.containerLogs).toContain('Cookie="<redacted>"');
    expect(diagnostics.containerLogs).not.toContain("capability-secret");
    expect(diagnostics.containerLogs).not.toContain("query-secret");
    expect(diagnostics.containerLogs).not.toContain("session-secret");
    expect(diagnostics.containerLogs).not.toContain("opaqueCredentialWithTwentyFourCharacters");
    expect(diagnostics.containerLogs).not.toContain("sid=short");
    expect(diagnostics.containerLogs).not.toContain("tiny");
    expect(diagnostics.containerLogs).not.toContain("also-short");
    expect(diagnostics.containerLogs).not.toContain("brief");
  });

  it("given Docker does not answer, when collecting diagnostics, then every command is aborted and reported", async () => {
    // given
    const command = vi.fn((_args: string[], signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const reason = signal.reason as unknown;
        reject(reason instanceof Error ? reason : new Error("aborted"));
      }, { once: true });
    }));

    // when
    const diagnostics = await collectBrowserDiagnostics(
      "container-4", "webkit", "browser-disconnected", command, 1);

    // then
    expect(command).toHaveBeenCalledTimes(3);
    expect(diagnostics.containerState).toBeUndefined();
    expect(diagnostics.containerStats).toBeUndefined();
    expect(diagnostics.containerLogs).toBeUndefined();
    expect(diagnostics.diagnosticErrors).toHaveLength(3);
    expect(diagnostics.diagnosticErrors.every((error) => error.includes("timed out"))).toBe(true);
  });

  it("given truncation would remove a credential key, when collecting logs, then redaction happens before truncation", async () => {
    // given
    const secret = "short-secret";
    const suffix = `\n${"x".repeat(16_371)}`;
    const command = vi.fn((args: string[]) => {
      if (args[0] === "logs") return Promise.resolve(`Authorization: Bearer ${secret}${suffix}`);
      return Promise.resolve("{}");
    });

    // when
    const diagnostics = await collectBrowserDiagnostics(
      "container-5", "webkit", "browser-disconnected", command);

    // then
    expect(diagnostics.containerLogs).not.toContain(secret);
    expect(diagnostics.containerLogs?.length).toBeLessThanOrEqual(16_384);
  });

  it("given Docker can no longer inspect a lost container, when collecting diagnostics, then the diagnostic failure is retained", async () => {
    // given
    const command = vi.fn().mockRejectedValue(new Error("container missing"));

    // when
    const diagnostics = await collectBrowserDiagnostics("container-2", "webkit", "browser-disconnected", command);

    // then
    expect(diagnostics.containerState).toBeUndefined();
    expect(diagnostics.containerStats).toBeUndefined();
    expect(diagnostics.containerLogs).toBeUndefined();
    expect(diagnostics.diagnosticErrors).toEqual(["container missing", "container missing", "container missing"]);
  });

  it("given an unsupported browser name, when retaining diagnostics, then no artifact path can escape the directory", () => {
    // given
    const diagnostics = {
      browserName: "../../outside",
      reason: "browser-disconnected",
      recordedAt: "2026-08-22T12:00:00.000Z",
      containerId: "container-3",
      diagnosticErrors: [],
      host: {
        freeMemoryBytes: 1,
        totalMemoryBytes: 2,
        loadAverage: [0, 0, 0],
        processMemory: process.memoryUsage()
      }
    };

    // when / then
    expect(() => retainBrowserDiagnostics(diagnostics)).toThrowError("Unsupported browser name for diagnostics");
  });
});
