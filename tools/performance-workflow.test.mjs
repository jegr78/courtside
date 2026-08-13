import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const workflow = readFileSync(fileURLToPath(new URL("../.github/workflows/performance-smoke.yml", import.meta.url)), "utf8");

test("given routine performance automation, when inspecting triggers, then pull requests keep only the deterministic build gate", () => {
  // when / then
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /node-version: '24'/);
  assert.doesNotMatch(workflow, /uses: [^\n]+@v\d/);
  assert.match(workflow, /persist-credentials: false/);
});

test("given shared runner variation, when executing performance smoke, then only the bounded local profile is automated", () => {
  // when / then
  assert.match(workflow, /node tools\/courtside\.mjs perf --skip-verify --no-credential-output/);
  assert.match(workflow, /node tools\/courtside\.mjs perf-run smoke/);
  assert.doesNotMatch(workflow, /baseline|peak|stress|soak|browser|funnel|uat/i);
  assert.match(workflow, /timeout-minutes: 20/);
});

test("given a smoke failure, when the workflow completes, then reports survive and no baseline is changed", () => {
  // when / then
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /build\/performance\/smoke/);
  assert.match(workflow, /node tools\/courtside\.mjs perf-reset courtside-perf/);
  assert.doesNotMatch(workflow, /perf-promote|performance\/baselines/);
});

test("given a smoke failure, when collecting diagnostics, then container logs are captured before cleanup", () => {
  // given
  const capture = workflow.indexOf("node tools/courtside.mjs perf-logs --no-follow");
  const upload = workflow.indexOf("uses: actions/upload-artifact@");
  const cleanup = workflow.indexOf("node tools/courtside.mjs perf-reset courtside-perf");

  // when / then
  assert.match(workflow, /- name: Capture container logs\n        if: failure\(\)/);
  assert.match(workflow, /> build\/performance\/smoke\/container-logs\.txt 2>&1 \|\| true/);
  assert.ok(capture >= 0);
  assert.ok(capture < upload);
  assert.ok(upload < cleanup);
});
