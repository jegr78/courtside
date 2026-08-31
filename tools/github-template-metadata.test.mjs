import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

export function validateIssueTemplate(source) {
  assert.equal(typeof source, "string");
  assert.ok(source.startsWith("---\n"));
  const end = source.indexOf("\n---\n", 4);
  assert.ok(end > 4);
  assert.equal(source.indexOf("\n---\n", end + 5), -1);
  const entries = source.slice(4, end).split("\n").map((line) => line.match(/^([a-z]+): ([^\r\n]+)$/u));
  assert.ok(entries.every((entry) => entry !== null));
  const frontmatter = Object.fromEntries(entries.map((entry) => [entry[1], entry[2]]));
  assert.equal(Object.keys(frontmatter).length, entries.length);
  assert.deepEqual(Object.keys(frontmatter).sort(), ["about", "labels", "name"]);
  assert.match(frontmatter.name, /^(?!null$|true$|false$|~$).+$/iu);
  assert.match(frontmatter.about, /^(?!null$|true$|false$|~$).+$/iu);
  assert.match(frontmatter.labels, /^[a-z0-9-]+(?:,\s*[a-z0-9-]+)*$/);
}

test("given issue templates, when validating frontmatter, then GitHub metadata is closed and typed", () => {
  // given
  const names = ["bug", "debt", "decision", "known-limit", "operations"];

  // when / then
  for (const name of names) {
    validateIssueTemplate(readFileSync(new URL(`../.github/ISSUE_TEMPLATE/${name}.md`, import.meta.url), "utf8"));
  }
});

test("given issue frontmatter is missing malformed duplicated or open, when validating, then each fails closed", () => {
  // given
  const source = readFileSync(new URL("../.github/ISSUE_TEMPLATE/bug.md", import.meta.url), "utf8");
  const cases = [
    source.replace(/^---\n/u, ""),
    source.replace("name: Bug\n", ""),
    source.replace("labels: bug", "labels:\n  - bug"),
    source.replace("labels: bug", "labels: bug\ncommand: ignored"),
    source.replace("labels: bug", "labels: bug\nlabels: debt"),
    source.replace("name: Bug", "name: true"),
    source.replace("\n---\n", "\n")
  ];

  // when / then
  for (const candidate of cases) assert.throws(() => validateIssueTemplate(candidate));
});
