import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cumulativeReleaseNotes } from "./release-notes.mjs";

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
