import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { choosePublishedBaseline, execute, strictAncestor, writePublishedBaseline } from "./published-npm-baseline.mjs";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "security-findings.fixtures");
const rc7Record = JSON.parse(readFileSync(join(fixtures, "rc7-security-record.json"), "utf8"));
const skippedRecord = () => {
  const record = structuredClone(rc7Record);
  for (const source of record.sources) {
    for (const evidence of source.evidenceSources) if (evidence.scanner === "npm") Object.assign(evidence, { status: "skipped", reason: "service-unavailable" });
  }
  return record;
};
const choose = ({ tags, ancestors, records }) => choosePublishedBaseline({
  subject: "c".repeat(40), tags,
  isStrictAncestor: async (tag) => ancestors.includes(tag),
  readRecord: async (tag) => records[tag] ?? null
});

test("given published releases, when choosing the baseline, then the newest strict ancestor with a completed npm audit wins", async () => {
  // when
  const choice = await choose({
    tags: ["v0.4.0", "v0.5.0-rc.8", "v0.5.0-rc.7", "not-a-version"],
    ancestors: ["v0.4.0", "v0.5.0-rc.7"],
    records: { "v0.4.0": rc7Record, "v0.5.0-rc.7": rc7Record }
  });

  // then
  assert.equal(choice.release, "v0.5.0-rc.7", "rc.8 is no ancestor of the subject, and order follows semantic versions");
  assert.deepEqual(choice.inspected, [{ tag: "v0.5.0-rc.8", outcome: "not-an-ancestor" }, { tag: "v0.5.0-rc.7", outcome: "chosen" }]);
});

test("given the newest ancestor did not complete its npm audit or has no record, when choosing, then an older one is taken", async () => {
  // when
  const skipped = await choose({ tags: ["v0.5.0-rc.7", "v0.4.0"], ancestors: ["v0.5.0-rc.7", "v0.4.0"],
    records: { "v0.5.0-rc.7": skippedRecord(), "v0.4.0": rc7Record } });
  const missing = await choose({ tags: ["v0.5.0-rc.7", "v0.4.0"], ancestors: ["v0.5.0-rc.7", "v0.4.0"],
    records: { "v0.4.0": rc7Record } });

  // then
  assert.equal(skipped.release, "v0.4.0", "a release whose own audit was skipped cannot vouch for anything");
  assert.equal(skipped.inspected[0].outcome, "npm-audit-not-completed");
  assert.equal(missing.release, "v0.4.0");
  assert.equal(missing.inspected[0].outcome, "no-security-record");
});

test("given no usable published release, when choosing, then there is no baseline and the reason says why", async () => {
  // when
  const choice = await choose({ tags: ["v0.5.0-rc.7"], ancestors: [], records: {} });

  // then
  assert.equal(choice.release, null);
  assert.equal(choice.reason, "no-published-ancestor-with-completed-npm-audit");
});

test("given a chosen release, when writing the baseline, then its own frontend manifest and lockfile are used", async () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-npm-baseline-"));
  const shown = [];
  const show = async (tag, path) => { shown.push(`${tag}:${path}`); return `{"from":"${tag}:${path}"}`; };

  try {
    // when
    await writePublishedBaseline({ directory, choice: { release: "v0.5.0-rc.7", inspected: [] }, show });
    await writePublishedBaseline({ directory: join(directory, "none"), choice: { release: null, reason: "no-published-ancestor-with-completed-npm-audit", inspected: [] }, show });

    // then
    assert.deepEqual(shown, ["v0.5.0-rc.7:frontend/package.json", "v0.5.0-rc.7:frontend/package-lock.json"]);
    assert.equal(JSON.parse(readFileSync(join(directory, "package-lock.json"), "utf8")).from, "v0.5.0-rc.7:frontend/package-lock.json");
    assert.deepEqual(JSON.parse(readFileSync(join(directory, "baseline.json"), "utf8")), { release: "v0.5.0-rc.7", inspected: [] });
    assert.equal(JSON.parse(readFileSync(join(directory, "none", "baseline.json"), "utf8")).release, null);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), "courtside-npm-baseline-git-"));
  const git = (...args) => execFileSync("git", ["-c", "user.name=Jane Doe", "-c", "user.email=jane.doe@example.org", ...args],
    { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  mkdirSync(join(root, "frontend"));
  const commit = (lock, tag) => {
    writeFileSync(join(root, "frontend", "package.json"), '{"name":"frontend"}');
    writeFileSync(join(root, "frontend", "package-lock.json"), lock);
    git("add", ".");
    git("commit", "-q", "-m", tag);
    git("tag", tag);
    return git("rev-parse", "HEAD");
  };
  return { root, git, commit };
}

const respond = (status, body) => ({ status, json: async () => body, text: async () => JSON.stringify(body) });
const github = (records) => async (url) => {
  const path = new URL(url).pathname;
  if (path.endsWith("/releases")) return respond(200, Object.keys(records).map((tag) => ({ tag_name: tag, draft: false })));
  const tag = decodeURIComponent(path.split("/releases/tags/")[1] ?? "");
  if (tag) return records[tag] ? respond(200, { assets: [{ id: tag.length, name: "security-record.json" }] }) : respond(200, { assets: [] });
  const asset = Number(path.split("/releases/assets/")[1]);
  return respond(200, Object.values(records).find((_, index) => Object.keys(records)[index].length === asset));
};

test("given a real history, when ancestry is checked, then an older tag counts and the subject's own tag does not", async () => {
  // given
  const { root, commit } = repository();
  try {
    commit('{"lock":"old"}', "v0.1.0");
    const head = commit('{"lock":"new"}', "v0.2.0");

    // when / then
    assert.equal(await strictAncestor("v0.1.0", head, root), true);
    assert.equal(await strictAncestor("v0.2.0", head, root), false, "a rerun on a tagged commit cannot use its own release as baseline");
    await assert.rejects(strictAncestor("v9.9.9", head, root), "an unknown tag is an error, not a missing ancestor");
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("given published releases on GitHub, when the baseline runs end to end, then the older release's own lockfile is written", async () => {
  // given
  const { root, commit } = repository();
  const output = join(root, "baseline");
  try {
    commit('{"lock":"old"}', "v0.1.0");
    const head = commit('{"lock":"new"}', "v0.2.0");

    // when
    const choice = await execute(["--subject", head, "--directory", output], { GITHUB_REPOSITORY: "example/courtside", GH_TOKEN: "token" },
      github({ "v0.2.0": rc7Record, "v0.1.0": rc7Record }), root);

    // then
    assert.equal(choice.release, "v0.1.0");
    assert.equal(readFileSync(join(output, "package-lock.json"), "utf8"), '{"lock":"old"}');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("given the GitHub API fails, when the baseline runs, then there is no baseline and the reason and cause are kept", async () => {
  // given
  const { root, commit } = repository();
  const output = join(root, "baseline");
  try {
    commit('{"lock":"old"}', "v0.1.0");
    const head = commit('{"lock":"new"}', "v0.2.0");

    // when
    const choice = await execute(["--subject", head, "--directory", output], { GITHUB_REPOSITORY: "example/courtside", GH_TOKEN: "token" },
      async () => respond(502, {}), root);

    // then
    assert.equal(choice.release, null, "an outage is never read as a baseline");
    assert.equal(choice.reason, "baseline-unavailable");
    assert.match(choice.detail, /HTTP 502/);
    assert.equal(existsSync(join(output, "package-lock.json")), false);
    assert.equal(JSON.parse(readFileSync(join(output, "baseline.json"), "utf8")).reason, "baseline-unavailable");
  } finally {
    rmSync(root, { recursive: true });
  }
});
