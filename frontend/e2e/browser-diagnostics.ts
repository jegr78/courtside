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

export type DockerDiagnosticCommand = (args: string[]) => Promise<string>;

interface DisconnectSource {
  on(event: "disconnected", listener: () => void): unknown;
  removeListener(event: "disconnected", listener: () => void): unknown;
}

export function observeBrowserDisconnect(browser: DisconnectSource, diagnose: () => Promise<unknown>): () => Promise<void> {
  let diagnostics: Promise<unknown> | undefined;
  const disconnected = () => {
    diagnostics = diagnose();
  };
  browser.on("disconnected", disconnected);
  return async () => {
    browser.removeListener("disconnected", disconnected);
    await diagnostics;
  };
}

const dockerCommand: DockerDiagnosticCommand = async (args) =>
  (await executeFile("docker", args, { maxBuffer: 1024 * 1024 })).stdout;

function safeLogs(value: string): string {
  return value.slice(-16_384)
    .replaceAll(/((?:https?|wss?):\/\/[^\s/?#]+)[^\s]*/gi, "$1/<redacted>")
    .replaceAll(/(authorization|cookie|password|csrf)[=:]\s*[^\r\n]+/gi, "$1=<redacted>")
    .replaceAll(/\b[A-Za-z0-9_-]{24,}\b/g, "<redacted>");
}

async function capture(command: DockerDiagnosticCommand, args: string[], errors: string[]): Promise<string | undefined> {
  try {
    return await command(args);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Docker diagnostic command failed");
    return undefined;
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
  command: DockerDiagnosticCommand = dockerCommand): Promise<BrowserDiagnostics> {
  const diagnosticErrors: string[] = [];
  const [state, stats, logs] = await Promise.all([
    capture(command, ["inspect", "--format", "{{json .State}}", containerId], diagnosticErrors),
    capture(command, ["stats", "--no-stream", "--format", "{{json .}}", containerId], diagnosticErrors),
    capture(command, ["logs", "--tail", "200", containerId], diagnosticErrors)
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
