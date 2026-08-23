import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { freemem, loadavg, totalmem } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export interface BrowserDiagnostics {
  browserName: string;
  reason: string;
  recordedAt: string;
  containerId: string;
  containerState?: Record<string, unknown>;
  containerStats?: Record<string, unknown>;
  containerLogs?: string;
  diagnosticErrors: string[];
  host: {
    freeMemoryBytes: number;
    totalMemoryBytes: number;
    loadAverage: number[];
    processMemory: NodeJS.MemoryUsage;
  };
}

export type DockerDiagnosticCommand = (args: string[], signal: AbortSignal) => Promise<string>;

interface DisconnectSource {
  on(event: "disconnected", listener: () => void): unknown;
  removeListener(event: "disconnected", listener: () => void): unknown;
}

export function observeBrowserDisconnect(browser: DisconnectSource, diagnose: () => Promise<unknown>): () => Promise<void> {
  let diagnostics: Promise<{ error?: Error }> | undefined;
  const disconnected = () => {
    diagnostics ??= diagnose().then(
      () => ({}),
      (error: unknown) => ({ error: error instanceof Error ? error : new Error("Browser diagnosis failed") })
    );
  };
  browser.on("disconnected", disconnected);
  return async () => {
    browser.removeListener("disconnected", disconnected);
    const result = await diagnostics;
    if (result?.error !== undefined) throw result.error;
  };
}

const dockerCommand: DockerDiagnosticCommand = async (args, signal) =>
  (await executeFile("docker", args, { maxBuffer: 1024 * 1024, signal })).stdout;

function safeLogs(value: string): string {
  return value
    .replaceAll(/((?:https?|wss?):\/\/[^\s/?#]+)[^\s]*/gi, "$1/<redacted>")
    .replaceAll(/(["']?(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|csrf(?:-token)?|xsrf(?:-token)?|token|secret|api[-_]?key)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^,}\r\n]+)/gi,
      "$1\"<redacted>\"")
    .replaceAll(/\b[A-Za-z0-9_-]{24,}\b/g, "<redacted>")
    .slice(-16_384);
}

async function capture(command: DockerDiagnosticCommand, args: string[], errors: string[], timeoutMs: number): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Docker diagnostic command timed out after ${timeoutMs} ms`)), timeoutMs);
  try {
    return await command(args, controller.signal);
  } catch (error) {
    const failure: unknown = controller.signal.aborted ? controller.signal.reason as unknown : error;
    errors.push(failure instanceof Error ? failure.message : "Docker diagnostic command failed");
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function json(value: string | undefined, errors: string[]): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    errors.push("Docker diagnostic output was not valid JSON");
    return undefined;
  }
}

export async function collectBrowserDiagnostics(containerId: string, browserName: string, reason: string,
  command: DockerDiagnosticCommand = dockerCommand, timeoutMs = 5_000): Promise<BrowserDiagnostics> {
  const diagnosticErrors: string[] = [];
  const [state, stats, logs] = await Promise.all([
    capture(command, ["inspect", "--format", "{{json .State}}", containerId], diagnosticErrors, timeoutMs),
    capture(command, ["stats", "--no-stream", "--format", "{{json .}}", containerId], diagnosticErrors, timeoutMs),
    capture(command, ["logs", "--tail", "200", containerId], diagnosticErrors, timeoutMs)
  ]);
  return {
    browserName,
    reason,
    recordedAt: new Date().toISOString(),
    containerId,
    containerState: json(state, diagnosticErrors),
    containerStats: json(stats, diagnosticErrors),
    containerLogs: logs === undefined ? undefined : safeLogs(logs),
    diagnosticErrors,
    host: {
      freeMemoryBytes: freemem(),
      totalMemoryBytes: totalmem(),
      loadAverage: loadavg(),
      processMemory: process.memoryUsage()
    }
  };
}

export function retainBrowserDiagnostics(diagnostics: BrowserDiagnostics): string {
  if (!new Set(["chromium", "firefox", "webkit"]).has(diagnostics.browserName)) {
    throw new Error("Unsupported browser name for diagnostics");
  }
  const directory = resolve("test-results", "browser-diagnostics");
  mkdirSync(directory, { recursive: true });
  const filename = `${diagnostics.browserName}-${Date.now()}.json`;
  const path = resolve(directory, filename);
  writeFileSync(path, `${JSON.stringify(diagnostics, null, 2)}\n`, { mode: 0o600 });
  return path;
}
