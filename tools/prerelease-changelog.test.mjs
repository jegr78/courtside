import assert from "node:assert/strict";
import test from "node:test";

import { normalizePrereleaseChangelog } from "./prerelease-changelog.mjs";

test("given a generated candidate section, when it is normalized, then one cumulative release line remains", () => {
  // given — this is the shape release-please wrote to #981 after #982 merged.
  const changelog = `# Changelog

## [0.1.0-rc.2](https://example.test/compare) (2026-09-14)

### Bug fixes

* preserve cumulative release-line history

### Documentation

* show every guide section

## 0.1.0 (2026-09-14)

### Features

* complete first-release history

### Bug fixes

* earlier fix

### Missing from the generated entries

* manually recovered security fix

## 0.0.1

* older release
`;

  // when
  const normalized = normalizePrereleaseChangelog(changelog);

  // then
  assert.equal([...normalized.matchAll(/^## .*0\.1\.0/gm)].length, 1);
  assert.doesNotMatch(normalized, /0\.1\.0-rc\.2/);
  assert.match(normalized, /### Features\n\n\* complete first-release history/);
  assert.match(normalized,
    /### Bug fixes\n\n\* preserve cumulative release-line history\n\n\* earlier fix/);
  assert.match(normalized, /### Documentation\n\n\* show every guide section/);
  assert.match(normalized, /### Missing from the generated entries\n\n\* manually recovered security fix/);
  assert.match(normalized, /## 0\.0\.1\n\n\* older release/);
});

test("given the first public release, when release-please emits breaking notes, then no upgrade claim is retained", () => {
  // given
  const changelog = `# Changelog

## [0.1.0-rc.2](https://example.test/compare) (2026-09-14)

### ⚠ BREAKING CHANGES

* changed an unreleased contract

### Features

* describe the same change for first-time users

## 0.1.0 (2026-09-14)

### Features

* existing feature
`;

  // when
  const normalized = normalizePrereleaseChangelog(changelog);

  // then
  assert.doesNotMatch(normalized, /BREAKING CHANGES/);
  assert.match(normalized, /### Notable changes\n\n\* changed an unreleased contract/);
  assert.match(normalized,
    /### Features\n\n\* describe the same change for first-time users\n\n\* existing feature/);
});

test("given an already cumulative changelog, when normalization repeats, then it is unchanged", () => {
  // given
  const changelog = "# Changelog\n\n## 0.1.0\n\n### Features\n\n* complete history\n";

  // when / then
  assert.equal(normalizePrereleaseChangelog(changelog), changelog);
});

test("given ambiguous generated history, when normalization runs, then it fails closed", () => {
  // given
  const missingCore = "# Changelog\n\n## 0.1.0-rc.2\n\n### Features\n\n* delta\n";
  const twoCandidates = "# Changelog\n\n## 0.1.0-rc.3\n\n### Features\n\n* latest\n"
    + "\n## 0.1.0-rc.2\n\n### Features\n\n* earlier\n\n## 0.1.0\n\n### Features\n\n* base\n";
  const duplicateSections = "# Changelog\n\n## 0.1.0-rc.2\n\n### Features\n\n* one"
    + "\n\n### Features\n\n* two\n\n## 0.1.0\n\n### Features\n\n* base\n";

  // when / then
  assert.throws(() => normalizePrereleaseChangelog(missingCore), /matching cumulative heading/);
  assert.throws(() => normalizePrereleaseChangelog(twoCandidates), /exactly one generated candidate/);
  assert.throws(() => normalizePrereleaseChangelog(duplicateSections), /duplicate section headings/);
});
