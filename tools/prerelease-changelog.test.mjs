import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizePrereleaseChangelog } from "./prerelease-changelog.mjs";
import { cumulativeReleaseNotes } from "./release-notes.mjs";

// A newer line on top, as in a release pull request, is not part of the history these cases replay.
function fromTheLine(version, changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8")) {
  return `# Changelog\n\n${changelog.slice(changelog.indexOf(`## ${version} (`))}`;
}

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
    /### Bug fixes\n\n\* preserve cumulative release-line history\n\* earlier fix/);
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
    /### Features\n\n\* describe the same change for first-time users\n\* existing feature/);
});

test("given an already cumulative changelog, when normalization repeats, then it is unchanged", () => {
  // given
  const changelog = "# Changelog\n\n## 0.1.0\n\n### Features\n\n* complete history\n";

  // when / then
  assert.equal(normalizePrereleaseChangelog(changelog), changelog);
});

test("given ambiguous generated history, when normalization runs, then it fails closed", () => {
  // given
  const twoCandidates = "# Changelog\n\n## 0.1.0-rc.3\n\n### Features\n\n* latest\n"
    + "\n## 0.1.0-rc.2\n\n### Features\n\n* earlier\n\n## 0.1.0\n\n### Features\n\n* base\n";
  const duplicateSections = "# Changelog\n\n## 0.1.0-rc.2\n\n### Features\n\n* one"
    + "\n\n### Features\n\n* two\n\n## 0.1.0\n\n### Features\n\n* base\n";

  // when / then
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
  const changelog = fromTheLine("0.1.0");
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

// Written by release-please 17.6.0's DefaultChangelogNotes with this repository's changelog sections.
const GENERATED_GRADUATION = `## [0.1.0](https://github.com/jegr78/courtside/compare/v0.1.0-rc.8...v0.1.0) (2026-10-01)


### Bug fixes

* preserve cumulative release-line history ([#982](https://github.com/jegr78/courtside/issues/982)) ([6b183ca](https://github.com/jegr78/courtside/commit/6b183ca8d701161ad6b5974df2d99eb1d1f183e9))


### Documentation

* capture each guide in a browser that speaks its language ([#979](https://github.com/jegr78/courtside/issues/979)) ([e1fe7d1](https://github.com/jegr78/courtside/commit/e1fe7d154a5e0a23f3778c1f68ddd5e1211184c3))

`;
const GENERATED_NEW_LINE = `## [0.2.0-rc.1](https://github.com/jegr78/courtside/compare/v0.1.0...v0.2.0-rc.1) (2026-10-01)


### Bug fixes

* preserve cumulative release-line history ([#982](https://github.com/jegr78/courtside/issues/982)) ([6b183ca](https://github.com/jegr78/courtside/commit/6b183ca8d701161ad6b5974df2d99eb1d1f183e9))


### Documentation

* capture each guide in a browser that speaks its language ([#979](https://github.com/jegr78/courtside/issues/979)) ([e1fe7d1](https://github.com/jegr78/courtside/commit/e1fe7d154a5e0a23f3778c1f68ddd5e1211184c3))

`;

test("given this repository's changelog, when release-please graduates the line to 0.1.0, then one release line "
  + "remains and carries the release date", () => {
  // given
  const changelog = fromTheLine("0.1.0");
  const generated = changelog.replace("## 0.1.0 (", `${GENERATED_GRADUATION}## 0.1.0 (`);
  assert.equal([...generated.matchAll(/^## .*0\.1\.0/gm)].length, 2, "release-please adds a second 0.1.0 heading");

  // when
  const normalized = normalizePrereleaseChangelog(generated);

  // then
  assert.equal([...normalized.matchAll(/^## .*0\.1\.0/gm)].length, 1, "a release body needs exactly one line");
  assert.match(normalized, /^## 0\.1\.0 \(2026-10-01\)$/m, "the stable release is dated when it was released");
  assert.match(normalized, /### Bug fixes\n\n\* preserve cumulative release-line history/);
  assert.match(cumulativeReleaseNotes(normalized, "v0.1.0"), /^## 0\.1\.0 \(2026-10-01\)/);
});

test("given a released 0.1.0, when release-please opens the 0.2.0 line with its first candidate, then the line "
  + "gets its own cumulative section", () => {
  // given
  const released = "# Changelog\n\n## 0.1.0 (2026-10-01)\n\n### Features\n\n* base\n";
  const generated = released.replace("## 0.1.0 (", `${GENERATED_NEW_LINE}## 0.1.0 (`);

  // when
  const normalized = normalizePrereleaseChangelog(generated);

  // then
  assert.match(normalized, /^## 0\.2\.0 \(2026-10-01\)\n\n### Bug fixes\n\n\* preserve cumulative/m);
  assert.doesNotMatch(normalized, /0\.2\.0-rc\.1/, "the candidate heading is folded, not kept");
  assert.match(normalized, /^## 0\.1\.0 \(2026-10-01\)\n\n### Features\n\n\* base$/m, "the released line is untouched");
  assert.match(cumulativeReleaseNotes(normalized, "v0.2.0-rc.1"), /^## 0\.2\.0 \(2026-10-01\)/);
  assert.equal(normalizePrereleaseChangelog(normalized), normalized, "a second run changes nothing");
});

test("given a release pull request's changelog with the next line on top, when the 0.1.0 history is replayed, then "
  + "only that line is read", () => {
  // given
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const releasePullRequest = changelog.replace("## 0.1.0 (", "## 0.2.0 (2026-10-12)\n\n### Features\n\n* next\n\n## 0.1.0 (");

  // when
  const history = fromTheLine("0.1.0", releasePullRequest);

  // then
  assert.match(history, /^# Changelog\n\n## 0\.1\.0 \(/, "the replay starts at the line it is about");
  assert.doesNotMatch(history, /0\.2\.0/);
});

// Written by release-please 17.6.0's DefaultChangelogNotes for a fix on release/0.1 after v0.1.0.
const GENERATED_PATCH = `## [0.1.1](https://github.com/jegr78/courtside/compare/v0.1.0...v0.1.1) (2026-10-12)


### Bug fixes

* correct the sentence about courts ([bbbbbbb](https://github.com/jegr78/courtside/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb))

`;

test("given this repository's changelog on a release branch, when release-please prepends a patch, then the patch keeps "
  + "its own section and its notes can be cut", () => {
  // given
  const changelog = fromTheLine("0.1.0");
  const generated = changelog.replace("## 0.1.0 (", `${GENERATED_PATCH}## 0.1.0 (`);
  const second = generated.replace("## [0.1.1](", `${GENERATED_PATCH.replaceAll("0.1.1", "0.1.2")
    .replace("v0.1.0...v0.1.2", "v0.1.1...v0.1.2")}## [0.1.1](`);

  // when
  const normalized = normalizePrereleaseChangelog(generated);

  // then
  assert.equal(normalized, generated, "a patch is no candidate delta, so nothing is folded into 0.1.0");
  assert.equal(normalizePrereleaseChangelog(second), second, "the next patch leaves the earlier one alone");
  const notes = cumulativeReleaseNotes(normalized, "v0.1.1");
  assert.match(notes, /^## \[0\.1\.1\]\(https:\/\/github\.com\/jegr78\/courtside\/compare\/v0\.1\.0\.\.\.v0\.1\.1\) \(2026-10-12\)/);
  assert.match(notes, /\* correct the sentence about courts\n$/, "the release body drops the commit link and ends at 0.1.0");
  assert.doesNotMatch(notes, /^## 0\.1\.0/m);
});

test("given a normalized release line, when two further candidates are folded in, then one blank line stays under its heading", () => {
  // given
  const candidate = (version, entry) => `## [${version}](https://example.test/compare) (2026-10-21)


### Bug fixes

* ${entry}

`;
  const line = `# Changelog

## 0.3.0 (2026-10-18)

### Bug fixes

* first fix

## 0.2.0 (2026-10-10)

### Features

* earlier feature
`;

  // when
  const second = normalizePrereleaseChangelog(line.replace("## 0.3.0 (", `${candidate("0.3.0-rc.2", "second fix")}## 0.3.0 (`));
  const third = normalizePrereleaseChangelog(second.replace("## 0.3.0 (", `${candidate("0.3.0-rc.3", "third fix")}## 0.3.0 (`));

  // then
  assert.equal(third, `# Changelog

## 0.3.0 (2026-10-18)

### Bug fixes

* third fix
* second fix
* first fix

## 0.2.0 (2026-10-10)

### Features

* earlier feature
`, "each candidate keeps the heading, its single blank line and the line below untouched");
});

const REPO = "https://github.com/jegr78/courtside";
const MESSAGES_AREA_TITLE = `* name the messages area in the guide indexes and pin only the pointer phrase in mails ([#1642](${REPO}/issues/1642)) `
  + `([372eeeb](${REPO}/commit/372eeebf0cc093ff0d7108b1e04114aec7c9e473))`;
const MESSAGES_AREA_BODY = `* name the messages area in the guide indexes and pin only the pointer phrase in mails `
  + `([372eeeb](${REPO}/commit/372eeebf0cc093ff0d7108b1e04114aec7c9e473)), closes [#1632](${REPO}/issues/1632)`;
const MY_BOOKINGS_TITLE = `* **frontend:** keep My bookings listed while it reloads after a cancellation ([#1587](${REPO}/issues/1587)) `
  + `([de51894](${REPO}/commit/de51894001b6889ce985b24980be2d1bed9de59c))`;
const MY_BOOKINGS_BODY = `* **frontend:** keep My bookings listed while the list reloads after a cancellation `
  + `([de51894](${REPO}/commit/de51894001b6889ce985b24980be2d1bed9de59c))`;
const LOCK_FIX = `* **booking:** withdraw from a booking only under its row lock ([#1638](${REPO}/issues/1638)) `
  + `([0b4c2b4](${REPO}/commit/0b4c2b4aff21e3c0661cfcdcbbae644518e4d3e7)), closes [#1630](${REPO}/issues/1630)`;
const DAY_STRIP_FIX = `* **frontend:** rest the court plan's day strip on whole items on phones ([#1591](${REPO}/issues/1591)) `
  + `([c695279](${REPO}/commit/c69527929e1adee0299f9badd3a5c7aee02d6aa8))`;

function rc3Candidate(cumulativeBugFixes) {
  return `# Changelog

## [0.3.0-rc.3](${REPO}/compare/v0.3.0-rc.2...v0.3.0-rc.3) (2026-10-22)


### Bug fixes

${LOCK_FIX}
${MESSAGES_AREA_BODY}


### Documentation

${MESSAGES_AREA_TITLE}

## 0.3.0 (2026-10-18)

### Bug fixes

${cumulativeBugFixes}

## 0.2.0 (2026-10-12)

### Features

* earlier line
`;
}

test("given a squash commit whose body repeats a conventional header, when the candidate is folded, then the commit "
  + "keeps only the entry that names its pull request", () => {
  // given — #1642 was titled docs: and its body began with the branch's fix: commit.
  const changelog = rc3Candidate(DAY_STRIP_FIX);

  // when
  const normalized = normalizePrereleaseChangelog(changelog);

  // then
  assert.equal(normalized.split("372eeebf0cc093ff0d7108b1e04114aec7c9e473").length - 1, 1, "one entry per commit");
  assert.match(normalized, /### Documentation\n\n\* name the messages area .*\(\[#1642\]/);
  assert.doesNotMatch(normalized, /closes \[#1632\]/, "the body's entry is the one dropped");
});

test("given duplicates already in the cumulative line, when the next candidate is folded, then they collapse to the "
  + "entry that names its pull request", () => {
  // given — de51894 (#1587) reached 0.3.0 twice in rc.2.
  const changelog = rc3Candidate(`${MY_BOOKINGS_TITLE}\n${MY_BOOKINGS_BODY}\n${DAY_STRIP_FIX}`);

  // when
  const normalized = normalizePrereleaseChangelog(changelog);

  // then
  assert.equal(normalized.split("de51894001b6889ce985b24980be2d1bed9de59c").length - 1, 1, "one entry per commit");
  assert.match(normalized, /keep My bookings listed while it reloads after a cancellation \(\[#1587\]/);
});

test("given a candidate and the cumulative line with entries in one section, when folded, then the section is one list", () => {
  // given
  const changelog = rc3Candidate(`${MY_BOOKINGS_TITLE}\n\n${DAY_STRIP_FIX}`);

  // when
  const normalized = normalizePrereleaseChangelog(changelog);

  // then
  const bugFixes = /### Bug fixes\n\n([\s\S]*?)\n\n###/.exec(normalized)?.[1];
  assert.deepEqual(bugFixes?.split("\n"), [LOCK_FIX, MY_BOOKINGS_TITLE, DAY_STRIP_FIX], "no blank line splits the list");
  assert.equal(normalizePrereleaseChangelog(normalized), normalized, "a second run changes nothing");
});

test("given a section whose only entry repeats a commit listed elsewhere, when folded, then its heading goes too", () => {
  // given
  const changelog = `# Changelog

## [0.3.0-rc.3](${REPO}/compare/v0.3.0-rc.2...v0.3.0-rc.3) (2026-10-22)


### Bug fixes

${MESSAGES_AREA_BODY}


### Documentation

${MESSAGES_AREA_TITLE}

## 0.3.0 (2026-10-18)

### Features

* earlier feature
`;

  // when
  const normalized = normalizePrereleaseChangelog(changelog);

  // then
  assert.doesNotMatch(normalized, /### Bug fixes/, "an empty section is left out");
  assert.match(normalized, /### Documentation\n\n\* name the messages area/);
});

test("given the same entry twice, when folded, then it is listed once", () => {
  // given
  const changelog = rc3Candidate(`${DAY_STRIP_FIX}\n${DAY_STRIP_FIX}`);

  // when
  const normalized = normalizePrereleaseChangelog(changelog);

  // then
  assert.equal(normalized.split("c69527929e1adee0299f9badd3a5c7aee02d6aa8").length - 1, 1, "one entry per commit");
});

test("given this repository's changelog, when the next candidate is folded into the open line, then every commit is "
  + "listed once and each section is one list", () => {
  // given
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const line = /^## (\d+\.\d+\.\d+) \(/m.exec(changelog)[1];
  const generated = changelog.replace(`## ${line} (`,
    `## [${line}-rc.99](${REPO}/compare) (2026-10-22)\n\n\n### Bug fixes\n\n${LOCK_FIX}\n\n\n## ${line} (`);

  // when
  const normalized = normalizePrereleaseChangelog(generated);

  // then
  const start = normalized.indexOf(`## ${line} (`);
  const body = normalized.slice(start, normalized.indexOf("\n## ", start + 1));
  const commits = [...body.matchAll(/\/commit\/([0-9a-f]{40})\)\)/g)].map((match) => match[1]);
  assert.deepEqual(commits.filter((commit, index) => commits.indexOf(commit) !== index), [], "no commit is listed twice");
  assert.doesNotMatch(body, /^\* .*\n\n\* /m, "no blank line splits a section's list");
});

test("given a release pull request whose open line is already folded, when normalization runs again, then its "
  + "duplicates collapse, each section is one list and older lines stay as they are", () => {
  // given — #1607 kept the entries of the normalizer before #1644, because a hidden commit left it unchanged.
  const olderLine = `## 0.2.0 (2026-10-15)\n\n### Bug fixes\n\n${DAY_STRIP_FIX}\n\n${DAY_STRIP_FIX}\n`;
  const changelog = `# Changelog\n\n## 0.3.0 (2026-10-18)\n\n### Bug fixes\n\n${LOCK_FIX}\n${MESSAGES_AREA_BODY}\n\n`
    + `${MY_BOOKINGS_TITLE}\n${MY_BOOKINGS_BODY}\n\n### Documentation\n\n${MESSAGES_AREA_TITLE}\n\n${olderLine}`;

  // when
  const normalized = normalizePrereleaseChangelog(changelog);

  // then
  assert.equal(normalized,
    `# Changelog\n\n## 0.3.0 (2026-10-18)\n\n### Bug fixes\n\n${LOCK_FIX}\n${MY_BOOKINGS_TITLE}\n\n`
    + `### Documentation\n\n${MESSAGES_AREA_TITLE}\n\n${olderLine}`, "the open line is cleaned and nothing else");
  assert.equal(normalizePrereleaseChangelog(normalized), normalized, "a second run changes nothing");
});
