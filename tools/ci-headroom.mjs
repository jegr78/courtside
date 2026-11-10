#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A limit sits at about twice the usual duration, and runners alone vary by more than half of that.
export const HEADROOM_LIMIT = 2 / 3;
const FAILING_EVENTS = new Set(["schedule", "workflow_dispatch"]);

export function workflowPath(reference) {
  const path = /^[^/]+\/[^/]+\/(\.github\/workflows\/[^@]+)@/.exec(reference ?? "")?.[1];
  if (!path) throw new Error(`GITHUB_WORKFLOW_REF does not name a workflow file: ${reference}`);
  return path;
}

// Runs before any dependency is installed, so it reads the job's own top-level key line by line.
export function timeoutMinutes(workflow, job) {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${job}:`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  const block = start === -1 ? [] : lines.slice(start + 1, end === -1 ? undefined : end);
  const minutes = Number(block.map((line) => /^ {4}timeout-minutes: (\d+)\s*$/.exec(line)?.[1]).find(Boolean));
  if (!Number.isFinite(minutes)) throw new Error(`${job} declares no timeout-minutes`);
  return minutes;
}

export function headroom({ started, now, timeoutMinutes: limit }) {
  const usedMinutes = (now - started) / 60;
  const fraction = usedMinutes / limit;
  return { usedMinutes, timeoutMinutes: limit, fraction, exceeded: fraction > HEADROOM_LIMIT };
}

export const describe = (record) => `${record.job} used ${record.usedMinutes.toFixed(1)} of ${record.timeoutMinutes} minutes (${Math.round(record.fraction * 100)} %), the limit for headroom is ${Math.round(HEADROOM_LIMIT * 100)} %`;

export function verdict(records, event) {
  const exceeded = records.filter((record) => record.exceeded);
  return { lines: records.map(describe), exceeded: exceeded.map(describe), fails: exceeded.length > 0 && FAILING_EVENTS.has(event) };
}

function measure([directory], env) {
  const started = Number(env.JOB_STARTED);
  if (!Number.isFinite(started) || started <= 0) throw new Error("JOB_STARTED is not set; the job's first step records it");
  const limit = timeoutMinutes(readFileSync(workflowPath(env.GITHUB_WORKFLOW_REF), "utf8"), env.GITHUB_JOB);
  const record = { job: env.HEADROOM_LABEL || env.GITHUB_JOB, ...headroom({ started, now: Math.floor(Date.now() / 1000), timeoutMinutes: limit }) };
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "headroom.json"), `${JSON.stringify(record, null, 2)}\n`);
  console.log(describe(record));
}

function report([directory], env) {
  const files = existsSync(directory) ? readdirSync(directory, { recursive: true }).filter((name) => String(name).endsWith("headroom.json")) : [];
  const result = verdict(files.map((name) => JSON.parse(readFileSync(join(directory, String(name)), "utf8"))), env.GITHUB_EVENT_NAME);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, result.lines.map((line) => `- ${line}\n`).join(""));
  result.lines.forEach((line) => console.log(line));
  const level = result.fails ? "error" : "warning";
  result.exceeded.forEach((line) => console.log(`::${level}::${line}; raise timeout-minutes to about twice the usual duration or make the job faster`));
  if (result.fails) process.exitCode = 1;
}

const COMMANDS = { measure, report };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = COMMANDS[process.argv[2]];
  if (!command) throw new Error("usage: ci-headroom.mjs measure <directory> | report <directory>");
  command(process.argv.slice(3), process.env);
}
