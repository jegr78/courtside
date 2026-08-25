import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type AddressInfo } from "node:net";
import type { DatabaseLock, JourneyService } from "./global-setup";
import { browserFailureReasons, type BrowserDiagnostics, type BrowserFailureReason, type FailedTest } from "./browser-diagnostics";

export interface JourneyControlReference {
  endpoint: string;
  token: string;
  baseURL: string;
  plainBaseURL: string;
  mailboxURL: string;
  visualDate: string;
}

interface JourneyCommand {
  operation: "pinnedBrowser" | "releasePinnedBrowser" | "browserDiagnostics" | "executeSql" | "holdDatabaseLock" | "waitForWaiters"
    | "releaseLock" | "publishServiceWorkerUpdate" | "reset" | "restart";
  browserName?: string;
  reason?: string;
  failedTest?: unknown;
  sql?: string;
  lockId?: string;
  count?: number;
}

interface JourneyResponse {
  result?: unknown;
  error?: string;
}

async function requestBody(request: IncomingMessage): Promise<JourneyCommand> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error("Journey control command exceeds 1 MiB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JourneyCommand;
}

function requiredString(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Journey control command requires ${name}`);
  return value;
}

function requiredBrowserFailureReason(value: string | undefined): BrowserFailureReason {
  const reason = browserFailureReasons.find((candidate) => candidate === value);
  if (!reason) throw new Error("Journey control command requires a browser failure reason");
  return reason;
}

function optionalFailedTest(value: unknown): FailedTest | undefined {
  if (value === undefined || value === null) return undefined;
  const candidate = value as Partial<FailedTest>;
  const errors = candidate.errors;
  if (typeof candidate.title !== "string" || typeof candidate.projectName !== "string"
    || typeof candidate.status !== "string" || !Array.isArray(errors)
    || errors.some((error) => typeof error !== "string")) {
    throw new Error("Journey control command carries a malformed failed test");
  }
  return { title: candidate.title, projectName: candidate.projectName, status: candidate.status, errors };
}

function requiredCount(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    throw new Error("Journey control command requires a non-negative count");
  }
  return value;
}

async function executeCommand(command: JourneyCommand, service: JourneyService,
  locks: Map<string, DatabaseLock>, signal: AbortSignal): Promise<unknown> {
  switch (command.operation) {
    case "pinnedBrowser": return service.pinnedBrowser(requiredString(command.browserName, "browserName"));
    case "releasePinnedBrowser": return service.releasePinnedBrowser(requiredString(command.browserName, "browserName"));
    case "browserDiagnostics": return service.browserDiagnostics(requiredString(command.browserName, "browserName"),
      requiredBrowserFailureReason(command.reason), optionalFailedTest(command.failedTest));
    case "executeSql": return service.executeSql(requiredString(command.sql, "sql"));
    case "holdDatabaseLock": {
      const lockId = randomUUID();
      locks.set(lockId, await service.holdDatabaseLock(requiredString(command.sql, "sql"), signal));
      return lockId;
    }
    case "waitForWaiters": return locks.get(requiredString(command.lockId, "lockId"))
      ?.waitForWaiters(requiredCount(command.count)) ?? Promise.reject(new Error("Unknown journey database lock"));
    case "releaseLock": {
      const lockId = requiredString(command.lockId, "lockId");
      const lock = locks.get(lockId);
      if (!lock) throw new Error("Unknown journey database lock");
      await lock.release();
      locks.delete(lockId);
      return undefined;
    }
    case "publishServiceWorkerUpdate": return service.publishServiceWorkerUpdate();
    case "reset": return service.reset();
    case "restart": return service.restart();
    default: throw new Error("Unknown journey control operation");
  }
}

function send(response: ServerResponse, status: number, body: JourneyResponse): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function startJourneyControl(service: JourneyService): Promise<{
  reference: JourneyControlReference;
  close(): Promise<void>;
}> {
  const token = randomUUID();
  const locks = new Map<string, DatabaseLock>();
  const serve = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "POST" || request.url !== "/"
        || request.headers.authorization !== `Bearer ${token}`) {
      send(response, 404, { error: "Journey control endpoint not found" });
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once("aborted", abort);
    response.once("close", abort);
    try {
      send(response, 200, { result: await executeCommand(await requestBody(request), service, locks, controller.signal) });
    } catch (error) {
      if (!response.destroyed) {
        send(response, 500, { error: error instanceof Error ? error.message : "Journey control command failed" });
      }
    } finally {
      request.off("aborted", abort);
      response.off("close", abort);
    }
  };
  const server = createServer((request, response) => void serve(request, response));
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    reference: {
      endpoint: `http://127.0.0.1:${port}/`,
      token,
      baseURL: service.baseURL,
      plainBaseURL: service.plainBaseURL,
      mailboxURL: service.mailboxURL,
      visualDate: service.visualDate
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function command<T>(reference: JourneyControlReference, request: JourneyCommand): Promise<T> {
  const response = await fetch(reference.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${reference.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(request)
  });
  const body = await response.json() as JourneyResponse;
  if (!response.ok) throw new Error(body.error ?? `Journey control rejected the command with ${response.status}`);
  if (body.error) throw new Error(body.error);
  return body.result as T;
}

export function connectJourneyService(reference: JourneyControlReference): JourneyService {
  return {
    baseURL: reference.baseURL,
    plainBaseURL: reference.plainBaseURL,
    mailboxURL: reference.mailboxURL,
    visualDate: reference.visualDate,
    pinnedBrowser: (browserName) => command(reference, { operation: "pinnedBrowser", browserName }),
    releasePinnedBrowser: (browserName) => command(reference, { operation: "releasePinnedBrowser", browserName }),
    browserDiagnostics: (browserName, reason, failedTest) => command<BrowserDiagnostics>(reference,
      { operation: "browserDiagnostics", browserName, reason, failedTest }),
    executeSql: (sql) => command(reference, { operation: "executeSql", sql }),
    holdDatabaseLock: async (sql) => {
      const lockId = await command<string>(reference, { operation: "holdDatabaseLock", sql });
      return {
        waitForWaiters: (count) => command(reference, { operation: "waitForWaiters", lockId, count }),
        release: () => command(reference, { operation: "releaseLock", lockId })
      };
    },
    publishServiceWorkerUpdate: () => command(reference, { operation: "publishServiceWorkerUpdate" }),
    reset: () => command(reference, { operation: "reset" }),
    restart: () => command(reference, { operation: "restart" })
  };
}
