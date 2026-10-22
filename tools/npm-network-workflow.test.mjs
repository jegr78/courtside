import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NETWORK = "./.github/actions/npm-network";
const TOOL_DEPENDENCIES = "./.github/actions/tool-dependencies";
const GITHUB_DEFAULT_JOB_MINUTES = 360;
const NPM_RETRY_FACTOR = 10;

function networkSettings() {
  const action = yaml.load(read(".github/actions/npm-network/action.yml"));
  const settings = {};
  for (const step of action.runs.steps) {
    for (const match of String(step.run ?? "").matchAll(/^\s*(NPM_CONFIG_[A-Z_]+)=(\S+)\s*$/gm)) {
      settings[match[1]] = match[2];
    }
  }
  return settings;
}

const runsNpm = (step) => /\bnpm (ci|install)\b/.test(String(step.run ?? ""));
const usesNetwork = (step) => step.uses === NETWORK;
const usesToolDependencies = (step) => step.uses === TOOL_DEPENDENCIES;

function workflowJobs() {
  return readdirSync(new URL("../.github/workflows/", import.meta.url))
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) => Object.entries(yaml.load(read(`.github/workflows/${name}`)).jobs ?? {})
      .map(([id, job]) => ({ name: `${name}#${id}`, job })));
}

function worstCaseSeconds(settings) {
  const timeout = Number(settings.NPM_CONFIG_FETCH_TIMEOUT) / 1000;
  const retries = Number(settings.NPM_CONFIG_FETCH_RETRIES);
  const minimum = Number(settings.NPM_CONFIG_FETCH_RETRY_MINTIMEOUT) / 1000;
  const maximum = Number(settings.NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT) / 1000;
  let waits = 0;
  for (let attempt = 0; attempt < retries; attempt++) {
    waits += Math.min(minimum * NPM_RETRY_FACTOR ** attempt, maximum);
  }
  return timeout * (retries + 1) + waits;
}

test("npm answers from its restored cache and makes no audit or notifier request", () => {
  const settings = networkSettings();
  assert.equal(settings.NPM_CONFIG_PREFER_OFFLINE, "true", "a restored cache must not be revalidated");
  assert.equal(settings.NPM_CONFIG_AUDIT, "false", "the install must not wait on the audit endpoint");
  assert.equal(settings.NPM_CONFIG_UPDATE_NOTIFIER, "false", "the install must not ask for a newer npm");
  for (const key of ["NPM_CONFIG_FETCH_TIMEOUT", "NPM_CONFIG_FETCH_RETRIES",
    "NPM_CONFIG_FETCH_RETRY_MINTIMEOUT", "NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT"]) {
    assert.match(String(settings[key]), /^\d+$/, `${key} must be set`);
  }
});

test("the tool dependencies bound npm before they install anything", () => {
  const steps = yaml.load(read(".github/actions/tool-dependencies/action.yml")).runs.steps;
  const network = steps.findIndex(usesNetwork);
  assert.notEqual(network, -1, "tool-dependencies must use the npm-network action");
  steps.forEach((step, index) => {
    if (runsNpm(step)) assert.ok(index > network, `${step.name} runs npm before its requests are bounded`);
  });
});

test("every npm install in a workflow runs with bounded registry requests inside its time budget", () => {
  const worst = worstCaseSeconds(networkSettings());
  let installs = 0;
  for (const { name, job } of workflowJobs()) {
    let bounded = false;
    for (const step of job.steps ?? []) {
      if (usesNetwork(step) || usesToolDependencies(step)) bounded = true;
      if (!runsNpm(step) && !usesToolDependencies(step)) continue;
      installs++;
      assert.ok(bounded, `${name}: "${step.name ?? step.uses}" installs before the npm-network action runs`);
      const minutes = Math.min(step["timeout-minutes"] ?? Infinity, job["timeout-minutes"] ?? GITHUB_DEFAULT_JOB_MINUTES);
      assert.ok(worst * 2 <= minutes * 60,
        `${name}: one stalled npm request may take ${worst}s, more than half of the ${minutes} min budget`);
    }
  }
  assert.ok(installs > 0, "the scan must find the workflow installs");
});
