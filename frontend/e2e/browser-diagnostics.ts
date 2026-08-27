import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { freemem, loadavg, totalmem } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { BrowserStartupFailureClass } from "./browser-container-lifecycle";

const executeFile = promisify(execFile);

export interface FailedTest {
  title: string;
  projectName: string;
  status: string;
  errors: string[];
}

export interface BrowserDiagnostics {
  schemaVersion: 1;
  browserName: string;
  reason: BrowserFailureReason;
  failedTest?: FailedTest;
  recordedAt: string;
  containerId: string;
  containerState?: Record<string, unknown>;
  containerStats?: Record<string, unknown>;
  containerLogs?: string;
  startupFailureClass?: BrowserStartupFailureClass;
  networkAttachments?: string[];
  networkAttachmentInspectionFailed?: boolean;
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
  recentLog?: string;
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
  "product-failure",
  "harness-incomplete",
  "browser-startup-failure"
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
  errors: ReadonlyArray<BrowserError>;
}

interface BrowserError {
  message?: string;
  cause?: BrowserError;
  value?: string;
}

interface DiagnosticContext {
  failedTest?: FailedTest;
  relatedContainers?: Record<string, string>;
  applicationState?: ApplicationProcessState;
  applicationLog?: () => string;
  startupFailureClass?: BrowserStartupFailureClass;
  networkAttachments?: string[];
  networkAttachmentInspectionFailed?: boolean;
}

export type DockerDiagnosticCommand = (args: string[], signal: AbortSignal) => Promise<string>;

interface DisconnectSource {
  on(event: "disconnected", listener: () => void): unknown;
  removeListener(event: "disconnected", listener: () => void): unknown;
}

// Playwright colours its own failure messages, so a pattern matching them has to read past the
// escapes rather than treat a product failure as a harness one.
const ANSI_STYLE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function plainText(value: string): string {
  return value.replaceAll(ANSI_STYLE, "");
}

export function classifyBrowserFailure(errors: ReadonlyArray<BrowserError>, state: FailureState): BrowserFailureReason {
  if (!state.browserConnected) return "browser-disconnected";
  if (state.pageCrashed) return "page-crashed";
  const messages = errors.map(({ message }) => plainText(message ?? "")).join("\n");
  if (/WebKit encountered an internal error/i.test(messages)) return "browser-internal-error";
  if (/Target page, context or browser has been closed/i.test(messages)) return "target-lost";
  if (state.timedOut || /Test timeout of \d+ms exceeded/i.test(messages)) return "test-timeout";
  if (errors.some(({ cause }) => cause?.message === "courtside-product-failure" || cause?.value === "courtside-product-failure")) {
    return "product-failure";
  }
  if (/(?:Error:\s*)?expect\([^\n]*\)\.(?:to|not\.)|expect\([^\n]*\) failed/i.test(messages)) return "product-failure";
  return "harness-incomplete";
}

export function productFailure(message: string): Error {
  return new Error(message, { cause: new Error("courtside-product-failure") });
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

function safeNetworkAttachments(values: string[] | undefined, errors: string[]): string[] | undefined {
  if (values === undefined) return undefined;
  if (values.some((value) => !/^[a-f0-9]{12,64}$/.test(value))) {
    errors.push("Docker reported an invalid network attachment identity");
    return undefined;
  }
  return [...new Set(values)];
}

export async function collectBrowserDiagnostics(containerId: string, browserName: string, reason: BrowserFailureReason,
  command: DockerDiagnosticCommand = dockerCommand, timeoutMs = 5_000,
  context: DiagnosticContext = {}): Promise<BrowserDiagnostics> {
  const browser = await collectContainerDiagnostics(containerId, command, timeoutMs);
  if (context.networkAttachmentInspectionFailed) {
    browser.diagnosticErrors.push("Browser network attachments could not be inspected");
  }
  const relatedContainers = Object.fromEntries(await Promise.all(
    Object.entries(context.relatedContainers ?? {}).map(async ([name, id]) =>
      [name, await collectContainerDiagnostics(id, command, timeoutMs)] as const)
  ));
  const applicationState = context.applicationState === undefined ? undefined : {
    ...context.applicationState,
    recentLog: applicationLog(context.applicationLog, browser.diagnosticErrors)
  };
  return {
    schemaVersion: 1,
    browserName,
    reason,
    failedTest: context.failedTest === undefined ? undefined : {
      title: plainText(context.failedTest.title),
      projectName: plainText(context.failedTest.projectName),
      status: plainText(context.failedTest.status),
      errors: context.failedTest.errors.map((error) => safeLogs(plainText(error)))
    },
    recordedAt: new Date().toISOString(),
    ...browser,
    startupFailureClass: context.startupFailureClass,
    networkAttachments: safeNetworkAttachments(context.networkAttachments, browser.diagnosticErrors),
    relatedContainers: Object.keys(relatedContainers).length === 0 ? undefined : relatedContainers,
    applicationState,
    host: {
      freeMemoryBytes: freemem(),
      totalMemoryBytes: totalmem(),
      loadAverage: loadavg(),
      processMemory: process.memoryUsage()
    }
  };
}

function applicationLog(read: (() => string) | undefined, errors: string[]): string | undefined {
  if (read === undefined) return undefined;
  try {
    return safeLogs(plainText(read()));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "The application log could not be read");
    return undefined;
  }
}

export interface ApplicationLogBuffer {
  append(chunk: Buffer | string): void;
  text(): string;
}

// The application is a process rather than a container, so the lines a failure needs are kept
// here instead of being fetched with docker logs.
export function applicationLogBuffer(limit: number): ApplicationLogBuffer {
  const lines: string[] = [];
  let pending = "";
  return {
    append(chunk) {
      pending += chunk.toString();
      const complete = pending.split("\n");
      pending = complete.pop() ?? "";
      for (const line of complete) {
        lines.push(line);
        if (lines.length > limit) lines.shift();
      }
    },
    text: () => lines.join("\n")
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
