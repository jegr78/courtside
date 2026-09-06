import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const repository = new URL("../", import.meta.url);

function repositoryFile(path) {
  return readFileSync(new URL(path, repository), "utf8");
}

function repositoryJson(path) {
  return JSON.parse(repositoryFile(path));
}

function pagesIn(directory) {
  return readdirSync(new URL(directory, repository))
    .filter((name) => name.endsWith(".md"))
    .sort();
}

const workflow = yaml.load(repositoryFile(".github/workflows/pages.yml"));
const sitePackage = repositoryJson("site/package.json");
const frontendPackage = repositoryJson("frontend/package.json");
const config = repositoryFile("site/.vitepress/config.mts");

// A page that exists in one language only turns the language switch into a 404, and the switch is
// what the site promises.
test("given the pages the site serves, when a language is chosen, then both languages carry the same ones",
  () => {
    // given
    const german = pagesIn("site/");
    const english = pagesIn("site/en/");

    // when / then
    assert.ok(german.length >= 1, "the site serves no German page at all");
    assert.deepEqual(english, german);
  });

test("given the two locales, when the site is configured, then German is the one served at the root",
  () => {
    // when / then
    assert.match(config, /root:\s*\{\s*\n?\s*label: "Deutsch",\s*\n?\s*lang: "de-DE"/);
    assert.match(config, /en:\s*\{\s*\n?\s*label: "English",\s*\n?\s*lang: "en-US"/);
    assert.match(config, /base: "\/courtside\/"/,
      "a project page is served under the repository name, and every asset resolves against it");
  });

// VitePress asks for a Vite whose development server carries published advisories. The frontend
// pins a version that audits clean, and the override is what keeps the site on it.
test("given the site's dependencies, when Vite is resolved, then it is the version the frontend pins",
  () => {
    // given
    const pinned = frontendPackage.devDependencies.vite ?? frontendPackage.dependencies.vite;

    // when / then
    assert.ok(pinned, "the frontend no longer pins Vite, so the site has nothing to follow");
    assert.equal(sitePackage.overrides?.vite, pinned);
    assert.ok(sitePackage.devDependencies.esbuild,
      "that Vite no longer bundles the transform VitePress calls, so esbuild is declared here");
  });

test("given the deployment, when the workflow runs, then only main publishes and the rights are narrow",
  () => {
    // given
    const triggers = workflow.on ?? workflow[true];

    // when / then
    assert.deepEqual(triggers.push.branches, ["main"]);
    assert.equal(triggers.pull_request_target, undefined,
      "that trigger would run this workflow with the repository's own token on a fork's branch");
    assert.equal(triggers.pull_request, undefined);
    assert.match(workflow.jobs.deploy.if, /github\.ref == 'refs\/heads\/main'/,
      "workflow_dispatch can start this run from any branch, so the deploy job says which one publishes");
    assert.equal(workflow.permissions.contents, "read");
    assert.equal(workflow.permissions["id-token"], undefined,
      "the token that proves the deployment belongs to the job that deploys, not to the workflow");
    assert.equal(workflow.jobs.deploy.permissions["id-token"], "write");
    assert.deepEqual(workflow.jobs.deploy.needs, "build");
    assert.equal(workflow.jobs.deploy.environment.name, "github-pages");
  });

test("given a repository that never published, when the site is deployed, then the workflow enables Pages",
  () => {
    // given
    const configure = workflow.jobs.build.steps
      .find((step) => (step.uses ?? "").startsWith("actions/configure-pages"));

    // when / then
    assert.ok(configure, "nothing configures Pages, so a repository without it never publishes");
    assert.equal(configure.with.enablement, true);
  });

test("given a change to the site, when the profile is classified, then the documentation profile builds it",
  () => {
    // given
    const profiles = repositoryJson("ci/test-profiles.json").profiles;
    const contract = repositoryJson("ci/test-profile-contract.json");

    // when / then
    assert.ok(profiles.docs.prefixes.includes("site/"),
      "site/ classifies as an unknown path, which fails closed to the full profile");
    for (const base of ["site/package.json", "site/package-lock.json", "site/.npmrc",
      "site/.vitepress/config.mts"]) {
      assert.ok(profiles.full.exact.includes(base),
        `${base} decides what the site depends on, and a change to it selects the cheap `
        + "documentation profile — the frontend's equivalents are listed here for that reason");
    }
    assert.ok(contract.profiles.docs.localTasks.includes("site-build"),
      "the documentation profile selects site/ and then never builds it");
    assert.deepEqual(contract.localTaskDefinitions["site-build"].arguments,
      ["--prefix", "site", "run", "build"]);
  });
