import { runPath } from "./context";
import { appendFileSync } from "node:fs";
import { test } from "@playwright/test";

export async function step<T>(persona: string, name: string, fn: () => Promise<T>): Promise<T> {
  const start = new Date().toISOString();
  try { return await test.step(`${persona}: ${name}`, fn); } finally {
    appendFileSync(runPath("steps.jsonl"), JSON.stringify({ project: test.info().project.name, persona, name, start, end: new Date().toISOString() }) + "\n");
  }
}
