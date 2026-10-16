import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repository = fileURLToPath(new URL("..", import.meta.url));
const scanned = ["tools", "frontend/src", "frontend/e2e", "src/test"];
const sources = /\.(mjs|js|ts|tsx|java)$/;
const pinnedCount = new RegExp(["\\bKNOWN", "[A-Z0-9_]*", "COUNT\\b"].join("_"));

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return sources.test(entry.name) ? [path] : [];
  });
}

function pinnedCountConstants(root = repository) {
  return scanned.flatMap((directory) => files(join(root, directory)))
    .flatMap((path) => readFileSync(path, "utf8").split("\n")
      .map((line, index) => ({ line, at: `${relative(root, path)}:${index + 1}` }))
      .filter(({ line }) => pinnedCount.test(line)))
    .map(({ at }) => at);
}

test("given the test sources, when they are scanned, then none pins a count that grows with the product", () => {
  // when
  const pinned = pinnedCountConstants();

  // then
  assert.deepEqual(pinned, [], "derive the count from its source instead of a KNOWN_..._COUNT constant");
});
