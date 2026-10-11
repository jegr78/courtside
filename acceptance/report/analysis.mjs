import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attribute, classifyErrors } from "../lib/core.mjs";

const P95 = "histogram_quantile(0.95, sum by (le) (rate(http_server_requests_seconds_bucket[1m])))";
const jsonl = (path) => existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const stripColour = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

function walk(suite, visit) {
  for (const spec of suite.specs ?? []) for (const result of spec.tests) visit(spec, result);
  for (const child of suite.suites ?? []) walk(child, visit);
}

export function failuresOf(results) {
  const failures = [];
  for (const suite of results.suites ?? []) walk(suite, (spec, test) => {
    for (const result of test.results) {
      if (result.status === "passed" || result.status === "skipped") continue;
      const messages = (result.errors ?? []).map((error) => stripColour(error.message ?? ""));
      failures.push({ project: test.projectName, file: `journeys/${spec.file.split("/").at(-1)}`, title: spec.title, class: classifyErrors(messages),
        error: messages.join("\n").split("\n").slice(0, 3).join(" ").slice(0, 300), start: result.startTime,
        end: new Date(Date.parse(result.startTime) + result.duration).toISOString() });
    }
  });
  return failures;
}

function testWindows(results) {
  const windows = [];
  for (const suite of results.suites ?? []) walk(suite, (spec, test) => {
    for (const result of test.results) {
      windows.push({ project: test.projectName, persona: "test", name: spec.title, start: result.startTime,
        end: new Date(Date.parse(result.startTime) + result.duration).toISOString() });
    }
  });
  return windows;
}

export async function analyse(run, config) {
  const results = existsSync(join(run, "results.json")) ? JSON.parse(readFileSync(join(run, "results.json"), "utf8")) : { suites: [] };
  const failures = failuresOf(results);
  for (const failure of failures) {
    if (!config.metrics) { failure.serverP95Seconds = null; continue; }
    const at = Math.round(Date.parse(failure.end) / 1000);
    const answer = await fetch(`${config.metrics.url}?query=${encodeURIComponent(P95)}&time=${at}`).then((response) => response.json(), () => ({}));
    const value = Number(answer.data?.result?.[0]?.value?.[1]);
    failure.serverP95Seconds = Number.isFinite(value) ? value : null;
  }
  writeFileSync(join(run, "failures.json"), JSON.stringify(failures, null, 2));
  const steps = jsonl(join(run, "steps.jsonl"));
  const tests = testWindows(results);
  const from = existsSync(join(run, "run-started")) ? readFileSync(join(run, "run-started"), "utf8").trim() : "";
  const to = tests.map((test) => test.end).sort().at(-1) ?? new Date().toISOString();
  const lines = Object.values(config.logs).filter((path) => existsSync(path))
    .flatMap((path) => readFileSync(path, "utf8").split("\n"))
    .filter((line) => { const at = line.slice(0, 24); return at >= from && at <= to; });
  const byStep = attribute(lines, steps);
  const byTest = attribute(lines, tests);
  const attribution = byStep.map((line, index) => line.steps.length ? line : { ...byTest[index], viaTest: true });
  writeFileSync(join(run, "log-attribution.json"), JSON.stringify(attribution, null, 2));
  return { failures, attribution };
}
