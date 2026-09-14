import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizePrereleaseChangelog } from "./prerelease-changelog.mjs";
import { cumulativeReleaseNotes } from "./release-notes.mjs";

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

// Copied from what release-please 17.6 wrote to #981, links and all. The cases above transcribe
// that shape by hand; this one runs the normalizer over the pairing that actually occurred - the
// generator's own heading on top of the changelog this repository carries - because that pairing
// is the one nothing had read when it made every release pull request unmergeable.
const GENERATED_CANDIDATE = `## [0.1.0-rc.2](https://github.com/jegr78/courtside/compare/v0.1.0-rc.1...v0.1.0-rc.2) (2026-09-14)


### Bug fixes

* preserve cumulative release-line history ([#982](https://github.com/jegr78/courtside/issues/982)) ([6b183ca](https://github.com/jegr78/courtside/commit/6b183ca8d701161ad6b5974df2d99eb1d1f183e9))


### Documentation

* capture each guide in a browser that speaks its language ([#979](https://github.com/jegr78/courtside/issues/979)) ([e1fe7d1](https://github.com/jegr78/courtside/commit/e1fe7d154a5e0a23f3778c1f68ddd5e1211184c3))

`;

test("given this repository's own changelog, when release-please prepends a candidate to it, then normalizing leaves one release line a release can be cut from", () => {
  // given
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.equal(changelog.split("## 0.1.0 (").length, 2, "the cumulative heading is the anchor here");
  const generated = changelog.replace("## 0.1.0 (", `${GENERATED_CANDIDATE}## 0.1.0 (`);
  assert.equal([...generated.matchAll(/^## .*0\.1\.0/gm)].length, 2, "which the guard refuses");

  // when
  const normalized = normalizePrereleaseChangelog(generated);

  // then — one release line, and the candidate's entries landed in the sections they belong to
  assert.equal([...normalized.matchAll(/^## .*0\.1\.0/gm)].length, 1);
  assert.doesNotMatch(normalized, /0\.1\.0-rc\.2/);
  assert.match(normalized, /### Bug fixes\n\n\* preserve cumulative release-line history/);
  assert.match(normalized, /### Documentation\n\n\* capture each guide in a browser that speaks its language/);
  assert.match(normalized, /^### Notable changes$/m);

  // and the release body the tag publishes can still be cut from it
  const notes = cumulativeReleaseNotes(normalized, "v0.1.0-rc.2");
  assert.match(notes, /^## 0\.1\.0 \(/);
  assert.match(notes, /preserve cumulative release-line history/);
  assert.match(notes, /Missing from the generated entries/);
});
