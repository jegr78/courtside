import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { freemem, loadavg, totalmem } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export interface BrowserDiagnostics {
  schemaVersion: 1;
  browserName: string;
  reason: BrowserFailureReason;
  recordedAt: string;
  containerId: string;
  containerState?: Record<string, unknown>;
  containerStats?: Record<string, unknown>;
  containerLogs?: string;
  diagnosticErrors: string[];
  relatedContainers?: Record<string, ContainerDiagnostics>;
  applicationState?: ApplicationProcessState;
  host: {
    freeMemoryBytes: number;
    totalMemoryBytes: number;
    loadAverage: number[];
    processMemory: NodeJS.MemoryUsage;
  };
}

export interface ContainerDiagnostics {
  containerId: string;
  containerState?: Record<string, unknown>;
  containerStats?: Record<string, unknown>;
  containerLogs?: string;
  diagnosticErrors: string[];
}

export interface ApplicationProcessState {
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killed: boolean;
}

export const browserFailureReasons = [
  "browser-disconnected",
  "browser-internal-error",
  "page-crashed",
  "target-lost",
  "test-timeout",
  "harness-incomplete"
] as const;

export type BrowserFailureReason = typeof browserFailureReasons[number];

interface FailureState {
  pageCrashed: boolean;
  browserConnected: boolean;
  timedOut?: boolean;
}

interface BrowserTestOutcome extends FailureState {
  status?: string;
  expectedStatus: string;
  errors: ReadonlyArray<{ message?: string }>;
}

interface DiagnosticContext {
  relatedContainers?: Record<string, string>;
  applicationState?: ApplicationProcessState;
}

export type DockerDiagnosticCommand = (args: string[], signal: AbortSignal) => Promise<string>;

interface DisconnectSource {
  on(event: "disconnected", listener: () => void): unknown;
  removeListener(event: "disconnected", listener: () => void): unknown;
}

export function classifyBrowserFailure(errors: ReadonlyArray<{ message?: string }>, state: FailureState): BrowserFailureReason {
  if (!state.browserConnected) return "browser-disconnected";
  if (state.pageCrashed) return "page-crashed";
  const messages = errors.map(({ message }) => message ?? "").join("\n");
  if (/WebKit encountered an internal error/i.test(messages)) return "browser-internal-error";
  if (/Target page, context or browser has been closed/i.test(messages)) return "target-lost";
  if (state.timedOut || /Test timeout of \d+ms exceeded/i.test(messages)) return "test-timeout";
  return "harness-incomplete";
}

export async function diagnoseUnexpectedBrowserTest(outcome: BrowserTestOutcome,
  diagnose: (reason: BrowserFailureReason) => Promise<unknown>): Promise<void> {
  if (outcome.status === outcome.expectedStatus) return;
  await diagnose(classifyBrowserFailure(outcome.errors, { ...outcome, timedOut: outcome.status === "timedOut" }));
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

export async function collectBrowserDiagnostics(containerId: string, browserName: string, reason: BrowserFailureReason,
  command: DockerDiagnosticCommand = dockerCommand, timeoutMs = 5_000,
  context: DiagnosticContext = {}): Promise<BrowserDiagnostics> {
  const browser = await collectContainerDiagnostics(containerId, command, timeoutMs);
  const relatedContainers = Object.fromEntries(await Promise.all(
    Object.entries(context.relatedContainers ?? {}).map(async ([name, id]) =>
      [name, await collectContainerDiagnostics(id, command, timeoutMs)] as const)
  ));
  return {
    schemaVersion: 1,
    browserName,
    reason,
    recordedAt: new Date().toISOString(),
    ...browser,
    relatedContainers: Object.keys(relatedContainers).length === 0 ? undefined : relatedContainers,
    applicationState: context.applicationState,
    host: {
      freeMemoryBytes: freemem(),
      totalMemoryBytes: totalmem(),
      loadAverage: loadavg(),
      processMemory: process.memoryUsage()
    }
  };
}

async function collectContainerDiagnostics(containerId: string, command: DockerDiagnosticCommand,
  timeoutMs: number): Promise<ContainerDiagnostics> {
  const diagnosticErrors: string[] = [];
  const [state, stats, logs] = await Promise.all([
    capture(command, ["inspect", "--format", "{{json .State}}", containerId], diagnosticErrors, timeoutMs),
    capture(command, ["stats", "--no-stream", "--format", "{{json .}}", containerId], diagnosticErrors, timeoutMs),
    capture(command, ["logs", "--tail", "200", containerId], diagnosticErrors, timeoutMs)
  ]);
  return {
    containerId,
    containerState: json(state, diagnosticErrors),
    containerStats: json(stats, diagnosticErrors),
    containerLogs: logs === undefined ? undefined : safeLogs(logs),
    diagnosticErrors
  };
}

export function retainBrowserDiagnostics(diagnostics: BrowserDiagnostics): string {
  if (!new Set(["chromium", "firefox", "webkit"]).has(diagnostics.browserName)) {
    throw new Error("Unsupported browser name for diagnostics");
  }
  const directory = resolve("test-results", "browser-diagnostics");
  mkdirSync(directory, { recursive: true });
  const filename = `${diagnostics.browserName}-${diagnostics.reason}-${Date.now()}-${randomUUID()}.json`;
  const path = resolve(directory, filename);
  writeFileSync(path, `${JSON.stringify(diagnostics, null, 2)}\n`, { mode: 0o600 });
  return path;
}
