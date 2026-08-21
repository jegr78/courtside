import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const api = yaml.load(readFileSync(join(root, "src/main/resources/api/openapi.yaml"), "utf8"));
const client = readFileSync(join(root, "frontend/src/api/client.ts"), "utf8");
const surfaceless = JSON.parse(
  readFileSync(new URL("./surfaceless-endpoints.json", import.meta.url), "utf8")
);

const methods = new Set(["get", "post", "put", "patch", "delete"]);

const contractOperations = () => Object.entries(api.paths)
  .flatMap(([path, item]) => Object.entries(item)
    .filter(([method]) => methods.has(method))
    .map(([method, operation]) => ({
      id: operation.operationId,
      label: `${method.toUpperCase()} ${path}`,
      path,
      method
    })));

// Each entry of the client's api object is one call, so splitting on them gives one block per
// call to read a path and a method out of. Without an explicit method a fetch is a GET, which is
// why a block naming none counts as one.
const calls = client.split(/\n {2}(?=[a-zA-Z]+: )/).slice(1).map((block) => ({
  block,
  method: (/method:\s*"([A-Z]+)"/.exec(block)?.[1] ?? "GET").toLowerCase()
}));

// A path is called when the client writes it with an interpolation per parameter and stops there,
// so /api/admin/roster is not satisfied by /api/admin/roster/${personId}. The method has to match
// too: listing a collection is not creating into it, and conflating the two hid the fact that no
// view could create a rule set.
const isCalled = ({ path, method }) => {
  const pattern = path.split(/\{[^}]+\}/)
    .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\$\\{[^}]+\\}");
  const writesPath = new RegExp(pattern + "(?=[?`\"'])");
  return calls.some((call) => call.method === method && writesPath.test(call.block));
};

test("given every endpoint the contract declares, when looking for its browser surface, then it is called or listed as deliberately without one", () => {
  // given
  const operations = contractOperations();

  // when
  const unreachable = operations.filter((operation) => !isCalled(operation) && !surfaceless[operation.id]);
  const listedYetCalled = operations.filter((operation) => isCalled(operation) && surfaceless[operation.id]);

  // then
  assert.deepEqual(unreachable.map((operation) => operation.label), [],
    "no view reaches these and surfaceless-endpoints.json does not say why");
  assert.deepEqual(listedYetCalled.map((operation) => operation.id), [],
    "the client calls these, so their surfaceless entry is stale and must go");
});

test("given the surfaceless inventory, when reading it, then every entry names a real operation and gives a reason", () => {
  // given
  const known = new Set(contractOperations().map((operation) => operation.id));

  // when
  const unknown = Object.keys(surfaceless).filter((id) => !known.has(id));
  const unreasoned = Object.entries(surfaceless)
    .filter(([, reason]) => typeof reason !== "string" || reason.trim().length < 20);

  // then
  assert.deepEqual(unknown, [], "these operationIds are not in the contract");
  assert.deepEqual(unreasoned.map(([id]) => id), [], "a reason has to say why, in a sentence");
});
