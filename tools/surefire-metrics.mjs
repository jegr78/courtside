#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FLYWAY = /Successfully applied (\d+) migrations? to schema .*?\(execution time (\d+):(\d+)\.(\d+)s\)/g;
const STARTED = /Started \w+ in [\d.]+ seconds/g;
const SUITE_TIME = /<testsuite\b[^>]*?\stime="([\d.]+)"/;

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function suiteMetrics(reports) {
  const perMigration = [];
  let migrationsApplied = null;
  let contextStarts = 0;
  let seconds = 0;
  for (const report of reports) {
    seconds += Number(SUITE_TIME.exec(report)?.[1] ?? 0);
    contextStarts += report.match(STARTED)?.length ?? 0;
    for (const [, count, minutes, secs, millis] of report.matchAll(FLYWAY)) {
      const applied = Number(count);
      migrationsApplied = Math.max(migrationsApplied ?? 0, applied);
      perMigration.push((Number(minutes) * 60_000 + Number(secs) * 1000 + Number(millis)) / applied);
    }
  }
  const msPerMigration = median(perMigration);
  const testClassMinutes = seconds / 60;
  return {
    testClasses: reports.length,
    testClassMinutes,
    contextStarts,
    migrationsApplied,
    msPerMigration,
    normalisedWork: msPerMigration ? testClassMinutes / msPerMigration : null
  };
}

const round = (value) => value === null ? "unknown" : value.toFixed(2);

function main([directory, output]) {
  if (!directory || !output) throw new Error("usage: surefire-metrics.mjs <surefire-reports directory> <output json>");
  const reports = readdirSync(directory).filter((name) => /^TEST-.*\.xml$/.test(name)).map((name) => readFileSync(join(directory, name), "utf8"));
  const metrics = suiteMetrics(reports);
  writeFileSync(output, `${JSON.stringify(metrics, null, 2)}\n`);
  const line = `Suite metrics: ${metrics.testClasses} classes, ${round(metrics.testClassMinutes)} class minutes, ${metrics.contextStarts} context starts, ${round(metrics.msPerMigration)} ms per migration, normalised work ${round(metrics.normalisedWork)}`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
