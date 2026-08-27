import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { localeKeys } from "./i18n-bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The rendered heading of a rule card is composed at runtime from the rule type, so a type the
// bundles do not name reaches a board as the raw key rather than as a word.
const ruleTypes = () => readFileSync(join(root, "src/main/resources/api/openapi.yaml"), "utf8")
  .split("\n")
  .filter((line) => line.includes("enum: [OPENING_HOURS"))
  .flatMap((line) => line.slice(line.indexOf("[") + 1, line.indexOf("]")).split(",").map((v) => v.trim()));

// A parameter's label is looked up by its name, so a parameter the bundles do not name reaches a
// board as the raw key above the input it is supposed to describe.
const ruleParameters = () => [...readFileSync(
  join(root, "src/main/java/org/courtside/rules/internal/RuleParameters.java"), "utf8")
  .matchAll(/Map\.of\("(\w+)", new Bounds\(/g)].map((match) => match[1]);

const backendKeys = () => readFileSync(join(root, "src/main/resources/messages.properties"), "utf8")
  .split("\n")
  .filter((line) => line.trim() && !line.trim().startsWith("#"))
  .map((line) => line.slice(0, line.indexOf("=")).trim());

test("given every backend message key, when checking each locale of the web client bundle, then every key is translated there", () => {
  // given
  const { de, en } = localeKeys();
  const keys = backendKeys();

  // when
  const missingDe = keys.filter((key) => !de.has(key));
  const missingEn = keys.filter((key) => !en.has(key));

  // then
  assert.deepEqual(missingDe, [], `de renders these codes as error.generic: ${missingDe.join(", ")}`);
  assert.deepEqual(missingEn, [], `en renders these codes as error.generic: ${missingEn.join(", ")}`);
  assert.deepEqual(de, en, "the de and en client bundles must define the same keys");
});

test("given every rule type the contract names, when checking both client bundles, then each has a title", () => {
  // given
  const { de, en } = localeKeys();
  const types = ruleTypes();

  // when
  const missing = types.flatMap((type) => [
    ...(de.has(`admin.rules.type.${type}`) ? [] : [`de:${type}`]),
    ...(en.has(`admin.rules.type.${type}`) ? [] : [`en:${type}`])
  ]);

  // then
  assert.ok(types.length > 0, "the contract must name at least one rule type");
  assert.deepEqual(missing, [], `these rule cards would show their key as a heading: ${missing.join(", ")}`);
});

test("given every rule parameter the contract names, when checking both client bundles, then each has a label", () => {
  // given
  const { de, en } = localeKeys();
  const parameters = ruleParameters();

  // when
  const missing = parameters.flatMap((name) => [
    ...(de.has(`admin.rules.parameter.${name}`) ? [] : [`de:${name}`]),
    ...(en.has(`admin.rules.parameter.${name}`) ? [] : [`en:${name}`])
  ]);

  // then
  assert.ok(parameters.length > 0, "the contract must name at least one rule parameter");
  assert.deepEqual(missing, [], `these inputs would be labelled with their key: ${missing.join(", ")}`);
});
