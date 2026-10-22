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

const runsNpm = (step) => /\bnpm(-cli\.js)? (ci|install)\b/.test(String(step.run ?? ""));
const usesNetwork = (step) => step.uses === NETWORK;
const usesToolDependencies = (step) => step.uses === TOOL_DEPENDENCIES;

// Maven's default lifecycle, in order.
const LIFECYCLE = ["validate", "initialize", "generate-sources", "process-sources", "generate-resources",
  "process-resources", "compile", "process-classes", "generate-test-sources", "process-test-sources",
  "generate-test-resources", "process-test-resources", "test-compile", "process-test-classes", "test",
  "prepare-package", "package", "pre-integration-test", "integration-test", "post-integration-test", "verify",
  "install", "deploy"];

function frontendBuild() {
  const pom = read("pom.xml");
  const plugin = /<artifactId>frontend-maven-plugin<\/artifactId>[\s\S]*?<\/plugin>/.exec(pom)[0];
  const npmPhases = [...plugin.matchAll(/<execution>([\s\S]*?)<\/execution>/g)]
    .filter(([, execution]) => /<goal>npm<\/goal>/.test(execution))
    .map(([, execution]) => LIFECYCLE.indexOf(/<phase>([^<]+)<\/phase>/.exec(execution)[1]));
  const skippingProfiles = [...pom.matchAll(/<profile>\s*<id>([^<]+)<\/id>([\s\S]*?)<\/profile>/g)]
    .filter(([, , body]) => /<frontend\.skip>true<\/frontend\.skip>/.test(body))
    .map(([, id]) => id);
  return { firstNpmPhase: Math.min(...npmPhases), skippingProfiles };
}

function commandsOf(run) {
  return String(run ?? "").replace(/\\\n/g, " ").split(/\n|&&|;/).map((line) => line.trim()).filter(Boolean);
}

function mavenReachesNpm(command, { firstNpmPhase, skippingProfiles }) {
  if (!/(^|\/|")mvnw"?(\s|$)/.test(command)) return false;
  const tokens = command.split(/\s+/).map((token) => token.replace(/^"|"$/g, ""));
  if (tokens.some((token) => /^-Dfrontend\.skip(=true)?$/.test(token))) return false;
  const profiles = tokens.filter((token) => token.startsWith("-P")).flatMap((token) => token.slice(2).split(","));
  if (profiles.some((profile) => skippingProfiles.includes(profile))) return false;
  if (tokens.some((token) => /frontend-maven-plugin:npm(@|$)/.test(token))) return true;
  return tokens.some((token) => LIFECYCLE.indexOf(token) >= firstNpmPhase);
}

// A courtside tool step may build the application through Maven, so it counts as reaching npm.
const runsCourtsideTool = (command) => /\btools\/courtside[.\w-]*\.mjs\b/.test(command);

function reachesNpm(step, frontend) {
  if (runsNpm(step)) return true;
  return commandsOf(step.run).some((command) => mavenReachesNpm(command, frontend) || runsCourtsideTool(command));
}

function workflowJobs() {
  return readdirSync(new URL("../.github/workflows/", import.meta.url))
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) => Object.entries(yaml.load(read(`.github/workflows/${name}`)).jobs ?? {})
      .map(([id, job]) => ({ name: `${name}#${id}`, job })));
}

// An expression budget counts with the smallest value it can choose.
function minutesOf(value, fallback) {
  if (value === undefined) return fallback;
  return Math.min(...String(value).match(/\d+/g).map(Number));
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

test("the frontend build is found in the pom and the java-only profile skips it", () => {
  const frontend = frontendBuild();
  assert.equal(LIFECYCLE[frontend.firstNpmPhase], "prepare-package", "npm must run in the lifecycle the scan reads");
  assert.ok(frontend.skippingProfiles.includes("java-only"), "java-only must be recognised as skipping npm");
  assert.ok(mavenReachesNpm("./mvnw -B package -DskipTests", frontend), "a package build runs npm ci");
  assert.ok(mavenReachesNpm("./mvnw -B com.github.eirslett:frontend-maven-plugin:npm@npm-ci", frontend),
    "the explicit npm goal runs npm ci");
  assert.ok(!mavenReachesNpm("./mvnw -B test -Pjava-only", frontend), "a test build stops before npm");
  assert.ok(!mavenReachesNpm("./mvnw -B package -Pjava-only", frontend), "java-only skips npm");
  assert.ok(!mavenReachesNpm("./mvnw -B package -Dfrontend.skip=true", frontend), "frontend.skip skips npm");
});

test("every npm install in a workflow runs with bounded registry requests inside its time budget", () => {
  const frontend = frontendBuild();
  const worst = worstCaseSeconds(networkSettings());
  let installs = 0;
  const unbounded = [];
  for (const { name, job } of workflowJobs()) {
    let bounded = false;
    for (const step of job.steps ?? []) {
      if (usesNetwork(step) || usesToolDependencies(step)) bounded = true;
      if (!reachesNpm(step, frontend) && !usesToolDependencies(step)) continue;
      installs++;
      if (!bounded) unbounded.push(`${name}: "${step.name ?? step.uses}"`);
      const minutes = Math.min(minutesOf(step["timeout-minutes"], Infinity),
        minutesOf(job["timeout-minutes"], GITHUB_DEFAULT_JOB_MINUTES));
      assert.ok(worst * 2 <= minutes * 60,
        `${name}: one stalled npm request may take ${worst}s, more than half of the ${minutes} min budget`);
    }
  }
  assert.deepEqual(unbounded, [], "these steps install before the npm-network action runs");
  assert.ok(installs > 0, "the scan must find the workflow installs");
});
