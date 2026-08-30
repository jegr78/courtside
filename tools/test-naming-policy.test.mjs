import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const suites = ["frontend/src", "frontend/e2e", "tools"];

// A half-renamed name keeps the Java joints even where its first clause already reads as a sentence,
// and that is the form a sweep leaves behind, so it is the one worth catching.
const javaStyle = /_(?:when|then)[A-Z]|^(?:[Gg]iven|[Ww]hen)[A-Za-z0-9]*_/;
const declarations = [
  /(?<![.\w])(?:it|test|describe)(?:\.\w+)?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g,
  /\]\s*\)\s*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g
];

function testFiles(directory) {
  return readdirSync(new URL(`../${directory}`, import.meta.url), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.test\.(ts|tsx|mjs)$/.test(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`);
}

function names(source) {
  return declarations.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[2]));
}

// The working tree, not the index: these three directories hold sources rather than scratch, so a
// stray test file among them is worth the same answer as a committed one.
test("given a test outside Java, when it is named, then it reads as a sentence", () => {
  const offenders = [];
  for (const directory of suites) {
    for (const file of testFiles(directory)) {
      for (const name of names(readFileSync(file, "utf8"))) {
        if (javaStyle.test(name)) {
          offenders.push(`${file.slice(root.length)}: ${name}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `camelCase test names belong to Java only:\n${offenders.join("\n")}`);
});

test("given the pattern behind the scan, when it is asked directly, then it tells the forms apart", () => {
  // then
  assert.ok(javaStyle.test("givenA_whenB_thenC"), "a Java name is not recognised");
  assert.ok(javaStyle.test("whenA_thenB"), "a Java name without a given is not recognised");
  assert.ok(javaStyle.test("given a completed first attempt_whenBuildingIt_thenItHolds"),
    "a half renamed name is not recognised");
  assert.ok(!javaStyle.test("given a thing, when it happens, then it holds"), "a sentence is rejected");
  assert.ok(!javaStyle.test("given a value_type, when it is read, then it holds"),
    "an underscore that is not a joint is rejected");
});

test("given every declaration form in this tree, when the scan reads one, then it finds its name", () => {
  // given
  const source = `it("a plain one", () => {});
    describe("a group", () => {});
    it.skip("a skipped one", () => {});
    it.each([["a", "b"]])("a table driven one", () => {});
    test('a single quoted one', () => {});`;

  // then
  assert.deepEqual(names(source).sort(), [
    "a group", "a plain one", "a single quoted one", "a skipped one", "a table driven one"
  ]);
});

test("given the scan itself, when it reports no offender, then every suite was read", () => {
  // then
  for (const directory of suites) {
    assert.ok(testFiles(directory).length > 0, `${directory} contributed no test file`);
  }
  const scanned = suites.flatMap((directory) => testFiles(directory));
  assert.ok(scanned.some((file) => file.endsWith(".tsx")), "no component test was read");
  assert.ok(scanned.some((file) => file.endsWith(".mjs")), "no tool test was read");
});
