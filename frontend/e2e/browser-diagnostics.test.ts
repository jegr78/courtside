import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import type { DockerDiagnosticCommand } from "./browser-diagnostics";
import {
  applicationLogBuffer,
  classifyBrowserFailure,
  collectBrowserDiagnostics,
  diagnoseUnexpectedBrowserTest,
  observeBrowserDisconnect,
  retainBrowserDiagnostics
} from "./browser-diagnostics";

describe("browser diagnostics", () => {
  it("given a successful test, when its fixture ends, then no diagnostic is collected", async () => {
    // given
    const diagnose = vi.fn();

    // when
    await diagnoseUnexpectedBrowserTest({
      status: "passed",
      expectedStatus: "passed",
      errors: [],
      pageCrashed: false,
      browserConnected: true
    }, diagnose);

    // then
    expect(diagnose).not.toHaveBeenCalled();
  });

  it("given an unexpected target loss, when its fixture ends, then diagnosis completes before cleanup", async () => {
    // given
    let completed = false;
    const diagnose = vi.fn(() => {
      completed = true;
      return Promise.resolve();
    });

    // when
    await diagnoseUnexpectedBrowserTest({
      status: "failed",
      expectedStatus: "passed",
      errors: [{ message: "Target page, context or browser has been closed" }],
      pageCrashed: false,
      browserConnected: true
    }, diagnose);

    // then
    expect(diagnose).toHaveBeenCalledWith("target-lost");
    expect(completed).toBe(true);
  });

  it("given Playwright times a test out without an error message, when its fixture ends, then the timeout remains classified", async () => {
    // given
    const diagnose = vi.fn().mockResolvedValue(undefined);

    // when
    await diagnoseUnexpectedBrowserTest({
      status: "timedOut",
      expectedStatus: "passed",
      errors: [],
      pageCrashed: false,
      browserConnected: true
    }, diagnose);

    // then
    expect(diagnose).toHaveBeenCalledWith("test-timeout");
  });

  it.each([
    [true, true, ["ordinary failure"], "page-crashed"],
    [false, false, ["ordinary failure"], "browser-disconnected"],
    [false, true, ["page.goto: WebKit encountered an internal error"], "browser-internal-error"],
    [false, true, ["frame.evaluate: Target page, context or browser has been closed"], "target-lost"],
    [false, true, ["Test timeout of 60000ms exceeded"], "test-timeout"],
    [false, true, ["Error: expect(locator).toBeVisible() failed"], "product-failure"],
    [false, true, [{ message: "Keyboard focus did not reach the control", cause: { message: "courtside-product-failure" } }], "product-failure"],
    [false, true, ["Expected the control to be visible"], "harness-incomplete"]
  ])("given observed browser state, when a test fails, then its failure class is derived",
    (pageCrashed, browserConnected, failures, expected) => {
      // given
      const errors = failures.map((failure) => typeof failure === "string" ? { message: failure } : failure);

      // when
      const reason = classifyBrowserFailure(errors, { pageCrashed, browserConnected });

      // then
      expect(reason).toBe(expected);
    });

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

  it("given related service containers and an application process, when collecting diagnostics, then the whole journey state is retained", async () => {
    // given
    const command = vi.fn((args: string[]) => {
      const containerId = args.at(-1);
      if (args[0] === "inspect") return Promise.resolve(JSON.stringify({ Status: "running", containerId }));
      if (args[0] === "stats") return Promise.resolve(JSON.stringify({ CPUPerc: "4%", containerId }));
      return Promise.resolve(`container=${containerId}`);
    });

    // when
    const diagnostics = await collectBrowserDiagnostics(
      "browser-1", "webkit", "target-lost", command, 5_000, {
        relatedContainers: { proxy: "proxy-1", postgres: "postgres-1" },
        applicationState: { pid: 42, exitCode: null, signalCode: null, killed: false }
      });

    // then
    expect(diagnostics.applicationState).toEqual({ pid: 42, exitCode: null, signalCode: null, killed: false });
    expect(diagnostics.relatedContainers).toMatchObject({
      proxy: {
        containerId: "proxy-1",
        containerState: { Status: "running", containerId: "proxy-1" },
        containerStats: { CPUPerc: "4%", containerId: "proxy-1" }
      },
      postgres: {
        containerId: "postgres-1",
        containerState: { Status: "running", containerId: "postgres-1" },
        containerStats: { CPUPerc: "4%", containerId: "postgres-1" }
      }
    });
    expect(command).toHaveBeenCalledTimes(9);
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
      schemaVersion: 1 as const,
      browserName: "../../outside",
      reason: "browser-disconnected" as const,
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

  it("given two failures in one millisecond, when retaining diagnostics, then neither artifact is overwritten", () => {
    // given
    vi.spyOn(Date, "now").mockReturnValue(1_787_592_000_000);
    const diagnostics = {
      schemaVersion: 1 as const,
      browserName: "webkit",
      reason: "target-lost" as const,
      recordedAt: "2026-08-24T12:00:00.000Z",
      containerId: "container-6",
      diagnosticErrors: [],
      host: {
        freeMemoryBytes: 1,
        totalMemoryBytes: 2,
        loadAverage: [0, 0, 0],
        processMemory: process.memoryUsage()
      }
    };

    // when
    const first = retainBrowserDiagnostics(diagnostics);
    const second = retainBrowserDiagnostics(diagnostics);

    // then
    try {
      expect(second).not.toBe(first);
    } finally {
      for (const path of new Set([first, second])) rmSync(path);
      vi.restoreAllMocks();
    }
  });

  it("given an application that logged, when diagnostics are collected, then the log travels with them", async () => {
    // given
    const command: DockerDiagnosticCommand = () => Promise.resolve("{}");
    const log = applicationLogBuffer(3);
    log.append(Buffer.from("first line\nsecond li"));
    log.append(Buffer.from("ne\nthird line\nfourth line\n"));

    // when
    const diagnostics = await collectBrowserDiagnostics("container-1", "webkit", "product-failure",
      command, 5_000, { applicationState: { exitCode: null, signalCode: null, killed: false }, applicationLog: () => log.text() });

    // then — the oldest line fell out of the window, the newest is the one a failure needs
    expect(diagnostics.applicationState?.recentLog).toBe("second line\nthird line\nfourth line");
    expect(diagnostics.diagnosticErrors).toEqual([]);
  });

  it("given a log carrying a credential, when diagnostics are collected, then the artefact hides it", async () => {
    // given
    const command: DockerDiagnosticCommand = () => Promise.resolve("{}");

    // when
    const diagnostics = await collectBrowserDiagnostics("container-1", "webkit", "product-failure",
      command, 5_000, {
        applicationState: { exitCode: null, signalCode: null, killed: false },
        applicationLog: () => 'password="hunter2-and-then-some" done'
      });

    // then
    expect(diagnostics.applicationState?.recentLog).toContain('password="<redacted>"');
    expect(diagnostics.applicationState?.recentLog).not.toContain("hunter2-and-then-some");
  });

  it("given a log that cannot be read, when diagnostics are collected, then they still arrive and say why", async () => {
    // given
    const command: DockerDiagnosticCommand = () => Promise.resolve("{}");

    // when
    const diagnostics = await collectBrowserDiagnostics("container-1", "webkit", "product-failure",
      command, 5_000, {
        applicationState: { exitCode: null, signalCode: null, killed: false },
        applicationLog: () => { throw new Error("log stream closed"); }
      });

    // then
    expect(diagnostics.applicationState?.recentLog).toBeUndefined();
    expect(diagnostics.diagnosticErrors).toContain("log stream closed");
  });

  it("given a failed test, when diagnostics are collected, then they name it and quote its errors", async () => {
    // given
    const command: DockerDiagnosticCommand = () => Promise.resolve("{}");

    // when
    const diagnostics = await collectBrowserDiagnostics("container-1", "webkit", "product-failure",
      command, 5_000, {
        failedTest: {
          title: "an installed PWA preserves the signed-in journey",
          projectName: "webkit-pwa",
          status: "failed",
          errors: ["expect(locator).toBeVisible() failed", "Timeout: 3000ms"]
        }
      });

    // then — without it, a retained file says which browser failed but never which test
    expect(diagnostics.failedTest).toEqual({
      title: "an installed PWA preserves the signed-in journey",
      projectName: "webkit-pwa",
      status: "failed",
      errors: ["expect(locator).toBeVisible() failed", "Timeout: 3000ms"]
    });
  });

  it("given a test error carrying a credential, when it is retained, then the artefact hides it", async () => {
    // given
    const command: DockerDiagnosticCommand = () => Promise.resolve("{}");

    // when
    const diagnostics = await collectBrowserDiagnostics("container-1", "webkit", "product-failure",
      command, 5_000, {
        failedTest: {
          title: "signing in",
          projectName: "webkit-pwa",
          status: "failed",
          errors: ['expected password="hunter2-and-then-some"']
        }
      });

    // then
    expect(diagnostics.failedTest?.errors[0]).toContain('password="<redacted>"');
    expect(diagnostics.failedTest?.errors[0]).not.toContain("hunter2-and-then-some");
  });

  it("given a coloured assertion failure, when it is classified, then the product carries the blame", () => {
    // given — Playwright dresses its own message in ANSI, whatever the reporter is told about colour
    const coloured = "Error: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m)."
      + "\u001b[22mtoBeVisible\u001b[2m(\u001b[22m\u001b[2m)\u001b[22m failed\n\nLocator: getByTestId('x')";

    // when / then — without stripping it, every product failure is filed as a harness problem
    expect(classifyBrowserFailure([{ message: coloured }],
      { pageCrashed: false, browserConnected: true })).toBe("product-failure");
  });

  it("given a coloured error, when it is retained, then the artefact reads as text", async () => {
    // given
    const command: DockerDiagnosticCommand = () => Promise.resolve("{}");

    // when
    const diagnostics = await collectBrowserDiagnostics("container-1", "webkit", "product-failure",
      command, 5_000, {
        failedTest: {
          title: "signing in", projectName: "webkit-pwa", status: "failed",
          errors: ["\u001b[31mexpected visible\u001b[39m"]
        }
      });

    // then
    expect(diagnostics.failedTest?.errors[0]).toBe("expected visible");
  });
});
