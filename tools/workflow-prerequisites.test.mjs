import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { documentationTests } from "./docs-check.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const repository = new URL("../", import.meta.url);
const workflowDirectory = new URL(".github/workflows/", repository);
const spawnedTests = new Map([["tools/docs-check.mjs", documentationTests]]);
const mavenInstallPhases = ["package", "verify", "install", "deploy"];

function workflows() {
  return readdirSync(workflowDirectory)
    .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
    .map((entry) => ({
      workflow: entry,
      definition: yaml.load(readFileSync(new URL(entry, workflowDirectory), "utf8"))
    }));
}

function importedSpecifiers(source) {
  const patterns = [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]));
}

function resolveRelative(entry, specifier) {
  return new URL(specifier, new URL(entry, repository)).href.slice(repository.href.length);
}

function packageDependencies(entry, seen = new Set()) {
  if (seen.has(entry)) return [];
  seen.add(entry);
  const file = new URL(entry, repository);
  assert.ok(existsSync(file), `${entry} is invoked by a workflow but does not exist`);
  const source = readFileSync(file, "utf8");
  const unresolvable = /\b(?:import|require)\s*\(\s*[^"')\s]/.test(source)
    || /createRequire\s*\([^;]*\)\s*\(/.test(source);
  const dependencies = unresolvable ? [`${entry} imports an expression`] : [];
  for (const specifier of importedSpecifiers(source)) {
    if (specifier.startsWith("node:")) continue;
    if (specifier.startsWith(".")) dependencies.push(...packageDependencies(resolveRelative(entry, specifier), seen));
    else dependencies.push(specifier);
  }
  return dependencies;
}

function jobs(definition) {
  return Object.entries(definition.jobs ?? {}).map(([name, job]) => ({ job: name, ...job }));
}

function steps(job) {
  return (Array.isArray(job.steps) ? job.steps : []).filter((step) => typeof step.run === "string");
}

function workingDirectory(definition, job, step) {
  return step["working-directory"] ?? job.defaults?.run?.["working-directory"]
    ?? definition.defaults?.run?.["working-directory"] ?? ".";
}

function environment(definition, job, step) {
  return { ...(definition.env ?? {}), ...(job.env ?? {}), ...(step.env ?? {}) };
}

function invokesGitHubCli(run) {
  return /(?:^|[\s;&|(])gh\s/.test(run);
}

function invokedTools(run) {
  return [...run.matchAll(/(?:^|\s)\S*node\s+\S*?(tools\/[\w.-]+\.mjs)/g)].map((match) => match[1]);
}

function installsToolDependencies(run, directory) {
  if (/(?:^|\s)(?:\S*npm|\S*npm-cli\.js)\s+(?:ci|install)\b/.test(run) && !/\s-(?:-global|g)\b/.test(run)) {
    return directory === "frontend" || /--prefix\s+frontend\b/.test(run) || /\bcd\s+frontend\b/.test(run);
  }
  if (/(?:^|\s)\S*mvnw\b/.test(run) && !/-Pjava-only\b/.test(run) && !/-Dfrontend\.skip=true\b/.test(run)) {
    return mavenInstallPhases.some((phase) => new RegExp(`\\s${phase}(?:\\s|$)`).test(run))
      || /frontend-maven-plugin:npm@npm-ci\b/.test(run);
  }
  return false;
}

function stepsInvokingGitHubCliWithoutToken(definitions) {
  const found = [];
  for (const { workflow, definition } of definitions) {
    for (const job of jobs(definition)) {
      for (const step of steps(job)) {
        if (!invokesGitHubCli(step.run)) continue;
        const variables = environment(definition, job, step);
        if (variables.GH_TOKEN === undefined && variables.GITHUB_TOKEN === undefined) {
          found.push(`${workflow} :: ${job.job} :: ${step.name ?? step.run.split("\n")[0]}`);
        }
      }
    }
  }
  return found;
}

function stepsRunningToolsWithoutDependencies(definitions) {
  const found = [];
  for (const { workflow, definition } of definitions) {
    for (const job of jobs(definition)) {
      let installed = false;
      for (const step of steps(job)) {
        for (const tool of invokedTools(step.run)) {
          const executed = [tool, ...(spawnedTests.get(tool) ?? [])];
          if (!installed && executed.some((entry) => packageDependencies(entry).length > 0)) {
            found.push(`${workflow} :: ${job.job} :: ${tool}`);
          }
        }
        if (installsToolDependencies(step.run, workingDirectory(definition, job, step))) installed = true;
      }
    }
  }
  return found;
}

test("given a step that calls the GitHub CLI, when the workflow, job and step environments are merged, then a token is in scope", () => {
  // given
  const definitions = workflows();

  // when
  const unauthenticated = stepsInvokingGitHubCliWithoutToken(definitions);

  // then
  assert.deepEqual(unauthenticated, []);
});

test("given a step that runs a tool importing a package, when the steps before it are walked, then one of them installed the tool dependencies", () => {
  // given
  const definitions = workflows();

  // when
  const uninstalled = stepsRunningToolsWithoutDependencies(definitions);

  // then
  assert.deepEqual(uninstalled, []);
});

test("given one tool that reaches a package and one that does not, when their import closures are walked, then only the first reports a dependency", () => {
  // given
  const reaching = "tools/courtside.mjs";
  const selfContained = "tools/coverage-diff.mjs";

  // when / then
  assert.ok(packageDependencies(reaching).includes("ajv/dist/2020"));
  assert.deepEqual(packageDependencies(selfContained), []);
});
