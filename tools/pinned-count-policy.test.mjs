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

const productInventory = /\bapi\.paths\b|\bapi\.components\b|openapi\.yaml|src\/main\/|frontend\/src\b|\bshipped[A-Z]\w*|Inventory\(|\bsourceFiles\(|authorization-policy\.json|Policy\.\w+/;

function pinnedLengthAssertions(path, source) {
  const lines = source.split("\n");
  const definitions = new Map();
  lines.forEach((line, index) => {
    const definition = /\b(?:const|let)\s+(\w+)\s*=/.exec(line);
    if (definition) definitions.set(definition[1], lines.slice(index, index + 3).join("\n"));
  });
  return lines.flatMap((line, index) => {
    const pinned = /assert\.(?:equal|strictEqual)\(\s*([\w.?]+?)(?:\.filter\([^)]*\))?\??\.length,\s*(\d+)\s*[,)]/.exec(line);
    if (!pinned || Number(pinned[2]) < 2) return [];
    const root = pinned[1].split(/[.?]/)[0];
    const definition = definitions.get(root) ?? "";
    return productInventory.test(definition) || productInventory.test(pinned[1])
      ? [`${path}:${index + 1}`] : [];
  });
}

test("given a test that counts a product inventory, when it is scanned, then a literal length is reported", () => {
  // given
  const source = [
    "const passwordFields = shippedBrowserSources.flatMap(({ path, source }) => jsxPasswordFields(path, source));",
    "assert.equal(passwordFields.length, 12, \"Every added or removed password field needs a review\");",
    "const rows = parse(readFileSync(new URL(\"./example.csv\", import.meta.url), \"utf8\"));",
    "assert.equal(rows.length, 25);"
  ].join("\n");

  // when
  const pinned = pinnedLengthAssertions("synthetic.test.mjs", source);

  // then
  assert.deepEqual(pinned, ["synthetic.test.mjs:2"], "only the count over shipped sources is a pinned inventory");
});

test("given the tool tests, when they are scanned, then none compares a product inventory's length with a literal", () => {
  // when
  const pinned = files(join(repository, "tools"))
    .filter((path) => path.endsWith(".test.mjs") && !path.endsWith("pinned-count-policy.test.mjs"))
    .flatMap((path) => pinnedLengthAssertions(relative(repository, path), readFileSync(path, "utf8")));

  // then
  assert.deepEqual(pinned, [], "derive the expected count from the inventory's source or compare the named entries");
});
