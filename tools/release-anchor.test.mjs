import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { anchorRefOf, ensureAnchor, releaseVersionOf } from "./release-anchor.mjs";

const commit = "a".repeat(40);
const tool = new URL("./release-anchor.mjs", import.meta.url).pathname;

test("given a version and a commit, when the anchor is named, then the branch carries both", () => {
  // when / then
  assert.equal(anchorRefOf("0.2.0-rc.1", commit), `refs/heads/release-anchor/v0.2.0-rc.1/${commit}`);
  assert.throws(() => anchorRefOf("0.2.0-rc.1", "abc"), /full 40-character sha/);
  assert.throws(() => anchorRefOf("v0.2.0", commit), /not a release version/);
});

test("given a pushed commit, when its manifest is compared with its parent's, then only a release commit names a version", () => {
  // when / then
  assert.equal(releaseVersionOf("0.2.0-rc.1", "0.1.0"), "0.2.0-rc.1");
  assert.equal(releaseVersionOf("0.1.0", "0.1.0"), null, "an ordinary commit carries the version it inherited");
  assert.equal(releaseVersionOf("0.1.0", null), "0.1.0", "the first release has no parent manifest");
});

function github(existing) {
  const created = [];
  return { created, get: () => existing, create: (ref, sha) => created.push([ref, sha]) };
}

test("given no anchor, when the candidate ensures one, then it is created at the release commit", () => {
  // given
  const api = github(null);

  // when
  const outcome = ensureAnchor({ version: "0.2.0-rc.1", commit, branch: "main", github: api });

  // then
  assert.equal(outcome, "created");
  assert.deepEqual(api.created, [[`refs/heads/release-anchor/v0.2.0-rc.1/${commit}`, commit]]);
});

test("given the anchor already names the commit, when the candidate ensures it, then nothing is written", () => {
  // given
  const api = github(commit);

  // when / then
  assert.equal(ensureAnchor({ version: "0.2.0-rc.1", commit, branch: "main", github: api }), "present");
  assert.deepEqual(api.created, [], "a re-run finds the anchor the push wrote");
});

test("given an anchor at another commit, when the candidate ensures it, then the run stops", () => {
  // when / then
  assert.throws(() => ensureAnchor({ version: "0.2.0-rc.1", commit, branch: "main", github: github("b".repeat(40)) }),
    /names b{40}, not a{40}/);
});

test("given GitHub refuses the anchor, when the candidate ensures it, then the refusal names the cause and the way on", () => {
  // given
  const api = { get: () => null, create: () => { throw new Error("Resource not accessible by personal access token (HTTP 403)"); } };

  // when / then
  assert.throws(() => ensureAnchor({ version: "0.2.0-rc.1", commit, branch: "main", github: api }), (error) => {
    assert.match(error.message, /HTTP 403/);
    assert.match(error.message, new RegExp(`${commit} no longer heads main`));
    assert.match(error.message, /dispatch the candidate for the head of main/);
    return true;
  });
});

// A stand-in gh answers ref lookups from `existing` and records every ref it is asked to create.
function runTool(arguments_, { existing = "", cwd } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "courtside-anchor-"));
  writeFileSync(join(directory, "gh"), `#!/usr/bin/env bash
case "$*" in
  *"git/ref/heads/"*) if [ -n "$EXISTING" ]; then echo "$EXISTING"; else echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi ;;
  *"git/refs "*) echo "$*" >> "$DIRECTORY/created" ;;
  *) exit 2 ;;
esac
`);
  chmodSync(join(directory, "gh"), 0o755);
  const output = execFileSync(process.execPath, [tool, ...arguments_], { encoding: "utf8", cwd, env: { ...process.env,
    PATH: `${directory}:${process.env.PATH}`, DIRECTORY: directory, EXISTING: existing,
    GITHUB_REPOSITORY: "jegr78/courtside" } });
  const created = existsSync(join(directory, "created")) ? readFileSync(join(directory, "created"), "utf8") : "";
  return { output, created };
}

function repositoryWithRelease(previous, next) {
  const directory = mkdtempSync(join(tmpdir(), "courtside-anchor-repo-"));
  const git = (...arguments_) => execFileSync("git", arguments_, { cwd: directory, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "jane.doe@example.org");
  git("config", "user.name", "Jane Doe");
  for (const version of [previous, next]) {
    writeFileSync(join(directory, ".release-please-manifest.json"), JSON.stringify({ ".": version }));
    git("add", ".");
    git("commit", "-q", "--allow-empty", "-m", `chore: ${version}`);
  }
  return { directory, head: git("rev-parse", "HEAD") };
}

test("given a pushed release commit, when release-please runs, then the anchor is written while the commit heads its branch", () => {
  // given
  const { directory, head } = repositoryWithRelease("0.1.0", "0.2.0-rc.1");

  // when
  const { created } = runTool(["release-commit", "--commit", head], { cwd: directory });

  // then
  assert.match(created, new RegExp(`git/refs -f ref=refs/heads/release-anchor/v0\\.2\\.0-rc\\.1/${head} -f sha=${head}`));
});

test("given a pushed ordinary commit, when release-please runs, then no anchor is written", () => {
  // given
  const { directory, head } = repositoryWithRelease("0.1.0", "0.1.0");

  // when
  const { created, output } = runTool(["release-commit", "--commit", head], { cwd: directory });

  // then
  assert.equal(created, "", "only a release commit is anchored");
  assert.match(output, /not a release commit/);
});

test("given a dispatched release, when the candidate ensures its anchor, then the existing one is accepted", () => {
  // when
  const { created, output } = runTool(["ensure", "--version", "0.2.0-rc.1", "--commit", commit, "--branch", "main"],
    { existing: commit });

  // then
  assert.equal(created, "", "an anchor the push wrote is not written again");
  assert.match(output, /present/);
});
