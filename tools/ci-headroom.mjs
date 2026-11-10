#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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

function main(env) {
  const started = Number(env.JOB_STARTED);
  if (!Number.isFinite(started) || started <= 0) throw new Error("JOB_STARTED is not set; the job's first step records it");
  const limit = timeoutMinutes(readFileSync(workflowPath(env.GITHUB_WORKFLOW_REF), "utf8"), env.GITHUB_JOB);
  const result = headroom({ started, now: Math.floor(Date.now() / 1000), timeoutMinutes: limit });
  const line = `${env.GITHUB_JOB} used ${result.usedMinutes.toFixed(1)} of ${limit} minutes (${Math.round(result.fraction * 100)} %), the limit for headroom is ${Math.round(HEADROOM_LIMIT * 100)} %`;
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
  if (!result.exceeded) return console.log(line);
  if (FAILING_EVENTS.has(env.GITHUB_EVENT_NAME)) {
    console.error(`::error::${line}; raise timeout-minutes to about twice the usual duration or make the job faster`);
    process.exitCode = 1;
  } else {
    console.log(`::warning::${line}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.env);
