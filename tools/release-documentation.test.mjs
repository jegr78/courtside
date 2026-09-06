import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { selectUpgradeOrigins } from "./courtside.upgrade-smoke.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

function repositoryFile(path) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

const document = repositoryFile("docs/releasing.md");
const workflow = yaml.load(repositoryFile(".github/workflows/release.yml"));
const source = repositoryFile(".github/workflows/release.yml");

// Nobody types the tag any more, so the thing to hold is that what writes it and what answers it
// still agree on its shape — a tag without the leading v would start nothing at all.
test("given the release trigger, when release-please writes a tag, then the workflow answers that shape",
  () => {
    // given
    const triggers = workflow.on ?? workflow[true];
    const config = JSON.parse(repositoryFile("release-please-config.json"));

    // when / then
    assert.deepEqual(triggers.push.tags, ["v*"]);
    assert.equal(config["include-v-in-tag"], true);
    assert.equal(config["include-component-in-tag"], false,
      "a component prefix would put something before the v and the trigger would miss it");
    assert.match(document, /release pull request/i,
      "the document has to say what produces the tag now that nobody pushes one");
  });

test("given the jobs a release runs, when the document explains them, then it names every one", () => {
  // given
  const jobs = Object.keys(workflow.jobs);

  // when / then
  assert.ok(jobs.length >= 8, `the release workflow declares only ${jobs.length} jobs`);
  for (const job of jobs) {
    assert.match(document, new RegExp("`" + job + "`"),
      `docs/releasing.md explains no job named ${job}, so a release runs a step nobody documented`);
  }
});

test("given the checks a release refuses on, when the document lists them, then each is still there",
  () => {
    // given
    const refusals = [...source.matchAll(/^ {6}- name: (Refuse|Demand) ([^\n]+)$/gm)]
      .map((match) => `${match[1]} ${match[2]}`);

    // when / then
    assert.ok(refusals.length >= 3, `the workflow refuses on only ${refusals.length} checks`);
    assert.match(document, /## What the release refuses before it builds anything/);
    assert.equal(document.split("\n")
      .filter((line) => line.startsWith("**") && line.includes("`main`")).length >= 1, true,
    "the document has to say that a tag outside main is refused");
    assert.match(document, /releaseReadiness/,
      "the nightly evidence the release demands is named in the workflow and nowhere in the document");
    assert.match(document, /npm audit/,
      "the one nightly failure that does not stop a release is a carve-out a reader needs");
  });

test("given the release body, when the document promises what it carries, then the workflow adds it",
  () => {
    // given
    const publish = workflow.jobs.publish.steps
      .find((step) => (step.uses ?? "").startsWith("softprops/action-gh-release"));

    // when / then
    assert.ok(publish, "the release no longer publishes through the action this document describes");
    for (const file of publish.with.files.trim().split("\n").map((line) => line.trim())) {
      const name = file.split("/").pop();
      assert.ok(document.includes(name.replace(/\.[a-z]+$/, "")) || document.includes(name),
        `the release attaches ${name} and docs/releasing.md does not mention it`);
    }
  });

test("given a candidate tag, when the release resolves upgrade origins, then the document describes what happens",
  () => {
    // given
    const publish = workflow.jobs.publish.steps
      .find((step) => (step.uses ?? "").startsWith("softprops/action-gh-release"));

    // when / then
    assert.deepEqual(selectUpgradeOrigins("v0.3.0-rc.2", ["v0.2.0", "v0.3.0-rc.1"]),
      ["v0.2.0", "v0.3.0-rc.1"]);
    assert.doesNotMatch(document, /Prereleases do not work/,
      "candidates reach publish now, so the document may no longer say they cannot");
    assert.match(document, /^## Candidates$/m);
    assert.match(String(publish.with.prerelease), /contains\(github\.ref_name, '-'\)/,
      "the flag decides how a candidate is published and is reachable now");
  });

// A tag that failed before publish stays where it is, so reading the history from local tags let a
// failed release shorten the next one's notes and offer an image that was never pushed.
test("given a tag that never published, when the release reads its history, then it reads releases instead",
  () => {
    // given
    const published = workflow.jobs.build.steps
      .find((step) => step.name === "Read the releases this repository has published");
    const collect = workflow.jobs.build.steps.find((step) => step.name === "Collect the upgrade notes");
    const origins = workflow.jobs.build.steps
      .find((step) => step.name === "Resolve supported database upgrade origins");

    // when / then
    assert.match(published.run, /gh api --paginate "repos\/\$\{GITHUB_REPOSITORY\}\/releases"/);
    assert.match(published.run, /--published-tags/);
    assert.doesNotMatch(collect.run, /git describe/,
      "the notes anchor comes from what was published, not from the tags that happen to exist");
    for (const step of [collect, origins]) {
      assert.equal(step.env.PUBLISHED_TAGS, "${{ steps.published.outputs.tags }}");
      assert.match(step.run, /"\$PUBLISHED_TAGS"/,
        "the tag list travels through the environment rather than into the script");
    }
  });

// The action rewrites the tag pattern and clears `latest` for a prerelease, so a candidate never
// moves a tag a club may have pinned.
test("given a candidate, when the image is tagged, then no floating tag follows it", () => {
  // given
  const meta = workflow.jobs.publish.steps
    .find((step) => (step.uses ?? "").startsWith("docker/metadata-action"));
  const release = workflow.jobs.publish.steps
    .find((step) => (step.uses ?? "").startsWith("softprops/action-gh-release"));

  // when / then
  assert.equal(meta.with.flavor, undefined,
    "a flavor input would override the default that holds latest back for a candidate");
  assert.match(String(release.with.prerelease), /contains\(github\.ref_name, '-'\)/,
    "and the GitHub release is marked so its own latest never resolves to a candidate");
  assert.match(document, /a candidate is published under its own version and nothing else/i);
});

test("given the tags a release publishes, when the document names them, then it names every one", () => {
  // given
  const meta = workflow.jobs.publish.steps
    .find((step) => (step.uses ?? "").startsWith("docker/metadata-action"));
  const patterns = meta.with.tags.trim().split("\n")
    .map((line) => /pattern=(.+)$/.exec(line.trim())?.[1])
    .filter(Boolean);

  // when / then
  assert.deepEqual(patterns, ["{{version}}", "{{major}}.{{minor}}", "{{major}}"]);
  assert.equal(meta.with.flavor, undefined,
    "the action's default holds `latest` back for a candidate and moves it for a release, and the document says so");
  assert.match(document, /`latest`/,
    "a club pinning latest moves with every release and the document has to name that tag");
  assert.match(document, /`<major>\.<minor>`/);
});

// The document now says a failed tag costs the next release nothing. That rests entirely on both
// reads coming from published releases; if either goes back to the tag history, the promise is false.
test("given a failed tag, when the document says it costs nothing, then neither read touches the tag history",
  () => {
    // when / then
    assert.doesNotMatch(source, /git describe/);
    assert.doesNotMatch(source, /git tag --list/);
    assert.match(document, /come from the releases this\nrepository has \*\*published\*\*/,
      "the document explains where the two reads look, and the workflow has to keep looking there");
  });
