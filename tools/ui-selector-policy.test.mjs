import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const frontend = fileURLToPath(new URL("../frontend", import.meta.url));
const forbiddenQuery = /\b(?:find|get|query)(?:All)?By(?:Text|LabelText|PlaceholderText|DisplayValue|Title|AltText)\s*\(/g;
const forbiddenRoleName = /\bgetByRole\s*\([^,]+,\s*\{[^}]*\bname\s*:\s*["'`]/g;

test("given UI tests, when selecting elements, then rendered copy is never the locator", () => {
  // given
  const testFiles = files(frontend).filter((path) => /\.(?:test|spec)\.(?:ts|tsx)$/.test(path));

  // when
  const violations = testFiles.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const forbidden = path.includes("/e2e/")
      ? new RegExp(`${forbiddenQuery.source}|${forbiddenRoleName.source}`, "g")
      : forbiddenQuery;
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
