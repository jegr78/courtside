import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const frontend = fileURLToPath(new URL("../frontend", import.meta.url));
const forbiddenQuery = /\b(?:find|get|query)(?:All)?By(?:Text|LabelText|PlaceholderText|DisplayValue|Title|AltText)\s*\(/g;
const forbiddenRoleName = /\b(?:find|get|query)(?:All)?ByRole\s*\([^,]+,\s*\{[^}]*\bname\s*:\s*["'`/]/g;

test("given role queries, when their accessible name is rendered copy, then every query variant is forbidden", () => {
  // when / then
  for (const query of ["findByRole", "findAllByRole", "getByRole", "getAllByRole", "queryByRole", "queryAllByRole"]) {
    assert.match(`screen.${query}("button", { name: "Save" })`, new RegExp(forbiddenRoleName.source));
    assert.match(`screen.${query}("button", { name: /Save/ })`, new RegExp(forbiddenRoleName.source));
  }
  assert.doesNotMatch("screen.getByRole(role, { name: accessibleName })", new RegExp(forbiddenRoleName.source));
  assert.doesNotMatch("screen.getByRole(role)", new RegExp(forbiddenRoleName.source));
});

test("given UI tests, when selecting elements, then rendered copy is never the locator", () => {
  // given
  const testFiles = files(frontend).filter((path) => /\.(?:test|spec)\.(?:ts|tsx)$/.test(path));

  // when
  const violations = testFiles.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const forbidden = new RegExp(`${forbiddenQuery.source}|${forbiddenRoleName.source}`, "g");
    return [...source.matchAll(forbidden)].map((match) =>
      `${path.slice(frontend.length + 1)}:${source.slice(0, match.index).split("\n").length}`
    );
  });

  // then
  assert.deepEqual(violations, []);
});

function files(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !["node_modules", "dist", "test-results"].includes(entry.name))
    .flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(path) : [path];
  });
}
