import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const suites = ["frontend/src", "frontend/e2e", "tools"];
const declaration = /\b(?:it|test)\(\s*"([^"]+)"/g;
const camelCase = /^(?:given|when)[A-Za-z0-9]*_/;

function testFiles(directory) {
  return readdirSync(new URL(`../${directory}`, import.meta.url), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.test\.(ts|tsx|mjs)$/.test(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`);
}

function names(source) {
  return [...source.matchAll(declaration)].map((match) => match[1]);
}

// Java carries the given_when_then form in a method name, where a sentence cannot go. A JavaScript
// test names itself in a string, so the sentence fits and the two styles must not drift together.
test("given a test outside Java, when it is named, then it reads as a sentence", () => {
  const offenders = [];
  for (const directory of suites) {
    for (const file of testFiles(directory)) {
      for (const name of names(readFileSync(file, "utf8"))) {
        if (camelCase.test(name)) {
          offenders.push(`${file.slice(root.length)}: ${name}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `camelCase test names belong to Java only:\n${offenders.join("\n")}`);
});

test("given the scan itself, when it finds nothing, then it is because it read the suites", () => {
  const scanned = suites.flatMap((directory) => testFiles(directory));
  assert.ok(scanned.length > 40, `only ${scanned.length} test files were read`);
  assert.ok(scanned.some((file) => file.endsWith(".tsx")), "no component test was read");
  assert.ok(scanned.some((file) => file.endsWith(".mjs")), "no tool test was read");
  assert.ok(names(readFileSync(scanned[0], "utf8")).length > 0, "no name was extracted at all");
});
