import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { RELEASE_NOTES_LIMIT, cumulativeReleaseNotes } from "./release-notes.mjs";

test("given a release candidate tag, when notes are selected, then the complete stable release line is returned", () => {
  // given
  const changelog = "# Changelog\n\n## 0.1.0 (2026-09-14)\n\n### Features\n\n* complete history\n"
    + "\n## Maintainer note\n\n* manually recovered entry\n\n## 0.0.1\n\n* earlier\n";

  // when
  const notes = cumulativeReleaseNotes(changelog, "v0.1.0-rc.2");

  // then
  assert.equal(notes, "## 0.1.0 (2026-09-14)\n\n### Features\n\n* complete history\n"
    + "\n## Maintainer note\n\n* manually recovered entry\n");
});

test("given the repository changelog, when initial notes are selected, then recovered security entries remain", () => {
  // given
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

  // when
  const notes = cumulativeReleaseNotes(changelog, "v0.1.0-rc.2");

  // then
  assert.match(notes, /keeps rejected values out of the advice\s+log/);
  assert.match(notes, /let a member book when the club serves Courtside without TLS/);
});

test("given another release line or split candidate headings, when notes are selected, then ambiguous history is refused", () => {
  // given
  const wrongLine = "# Changelog\n\n## 0.2.0\n\n* later\n";
  const split = "# Changelog\n\n## 0.1.0-rc.2\n\n* delta\n\n## 0.1.0\n\n* history\n";
  const candidateOnly = "# Changelog\n\n## 0.1.0-rc.2\n\n* delta\n";

  // when / then
  assert.throws(() => cumulativeReleaseNotes(wrongLine, "v0.1.0-rc.2"), /exactly one 0\.1\.0/);
  assert.throws(() => cumulativeReleaseNotes(split, "v0.1.0-rc.2"), /exactly one 0\.1\.0/);
  assert.throws(() => cumulativeReleaseNotes(candidateOnly, "v0.1.0-rc.2"),
    /must use the 0\.1\.0 release-line heading/);
});

test("given the initial release contains a breaking section, when notes are selected, then misleading upgrade claims are refused", () => {
  // given
  const changelog = "# Changelog\n\n## 0.1.0\n\n### ⚠ BREAKING CHANGES\n\n* pre-release change\n";

  // when / then
  assert.throws(() => cumulativeReleaseNotes(changelog, "v0.1.0"), /must not claim breaking changes/);
});

test("given an invalid tag or malformed changelog, when notes are selected, then publication fails closed", () => {
  // when / then
  assert.throws(() => cumulativeReleaseNotes("# Changelog\n", "0.1.0"), /tag is invalid/);
  assert.throws(() => cumulativeReleaseNotes("# Changelog\n\n## 0.1.0\n", "v0.1.0+local"), /tag is invalid/);
});

test("given this repository's changelog, when its release line is cut, then GitHub can still store the body", () => {
  // given
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

  // when
  const notes = cumulativeReleaseNotes(changelog, "v0.1.0");

  // then
  assert.ok(notes.length <= RELEASE_NOTES_LIMIT, `the 0.1.0 notes have ${notes.length} characters`);
});

test("given release-please entries whose commit links exceed the body limit, when notes are cut, then they keep their pull requests and drop the commit links", () => {
  // given
  const entry = (number) => `* change number ${number} lands for members `
    + `([#${number}](https://github.com/jegr78/courtside/issues/${number})) `
    + `([4342aab](https://github.com/jegr78/courtside/commit/4342aabdb264178f581cc19639e3a92e7cef69a8))\n`;
  const changelog = `# Changelog\n\n## 0.1.0 (2026-09-14)\n\n### Bug Fixes\n\n${
    Array.from({ length: 700 }, (_, index) => entry(1000 + index)).join("")}`;
  assert.ok(changelog.length > RELEASE_NOTES_LIMIT, "the fixture must exceed the limit with its commit links");

  // when
  const notes = cumulativeReleaseNotes(changelog, "v0.1.0-rc.12");

  // then
  assert.ok(notes.length <= RELEASE_NOTES_LIMIT, `the notes have ${notes.length} characters`);
  assert.doesNotMatch(notes, /\/commit\//, "the release body must not carry commit links");
  assert.match(notes, /^\* change number 1699 lands for members \(\[#1699\]\(https:\/\/github\.com\/jegr78\/courtside\/issues\/1699\)\)$/m,
    "every entry must keep its pull request link");
});

test("given a release line longer than GitHub stores, when its notes are cut, then the build refuses it", () => {
  // given
  const changelog = `# Changelog\n\n## 0.2.0\n\n### Features\n\n${"* entry\n".repeat(20000)}`;

  // when / then
  assert.throws(() => cumulativeReleaseNotes(changelog, "v0.2.0"), /GitHub accepts a release body of 125000/);
});
