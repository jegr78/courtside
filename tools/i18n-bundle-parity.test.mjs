import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { localeKeys } from "./i18n-bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
