import { runPath } from "./context";
import { removalPath, replayEntries } from "./core.mjs";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { APIRequestContext } from "@playwright/test";

export type Entry = { kind: "booking" | "series" | "opening-week" | "opening-period" | "court-closure" | "account" | "template"; id: string; by?: string; project?: string; anchor?: string };
const FILE = runPath("ledger.jsonl");

export function recordCreated(entry: Entry) { appendFileSync(FILE, JSON.stringify({ ...entry, at: new Date().toISOString() }) + "\n"); }
export function readLedger(): Entry[] {
  return existsSync(FILE) ? readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
}

type Remove = (path: string) => Promise<{ status: () => number }>;

export async function replay(request: APIRequestContext, xsrf: string, entries = readLedger()) {
  return replayEntries(entries, (path: string) => request.delete(path, { headers: { "X-XSRF-TOKEN": xsrf } }));
}
