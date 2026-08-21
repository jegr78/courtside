import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { localeKeys } from "./i18n-bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const api = yaml.load(readFileSync(join(root, "src/main/resources/api/openapi.yaml"), "utf8"));
const contractRoles = api.components.schemas.Role.enum;

// TypeScript cannot emit a runtime array from a generated union, so the values are written by hand
// and this is what keeps them from drifting away from the contract that declares them.
const offeredRoles = () => {
  const source = readFileSync(join(root, "frontend/src/views/AdminRosterView.tsx"), "utf8");
  const declared = source.match(/const roles: Role\[\] = \[([\s\S]*?)\];/);
  assert.ok(declared, "could not locate the roles array in AdminRosterView.tsx");
  return [...declared[1].matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
};

test("given the roles the contract declares, when a board assigns them, then the view offers every one", () => {
  // given
  const contract = [...contractRoles].toSorted();

  // when
  const offered = offeredRoles().toSorted();

  // then
  assert.deepEqual(offered, contract,
    "a role the contract declares and the view omits is one nobody can assign");
});

test("given the roles the contract declares, when one is rendered, then every locale translates it", () => {
  // given
  const { de, en } = localeKeys();

  // when
  const missingDe = contractRoles.filter((role) => !de.has(`role.${role}`));
  const missingEn = contractRoles.filter((role) => !en.has(`role.${role}`));

  // then
  assert.deepEqual(missingDe, [], "de renders these roles as their raw key");
  assert.deepEqual(missingEn, [], "en renders these roles as their raw key");
});
