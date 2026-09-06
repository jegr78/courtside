import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

function repositoryFile(path) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

const document = repositoryFile("docs/releasing.md");
const workflow = yaml.load(repositoryFile(".github/workflows/release.yml"));
const source = repositoryFile(".github/workflows/release.yml");

// The tag pattern is what a reader copies, so the document has to name the one the workflow reacts
// to rather than one that was true when it was written.
test("given the release trigger, when the document names a tag, then it is the tag the workflow answers",
  () => {
    // given
    const triggers = workflow.on ?? workflow[true];

    // when / then
    assert.deepEqual(triggers.push.tags, ["v*"]);
    assert.match(document, /```sh\n[\s\S]*git tag -a v\d+\.\d+\.\d+/,
      "the recipe has to cut a tag the release workflow reacts to");
    assert.match(document, /git push origin v\d+\.\d+\.\d+/);
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
    assert.match(document, /prerelease/i,
      "a hyphenated tag is published as a prerelease and a reader has to know that");
  });
