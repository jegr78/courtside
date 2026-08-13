import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const backendKeys = () => readFileSync(join(root, "src/main/resources/messages.properties"), "utf8")
  .split("\n")
  .filter((line) => line.trim() && !line.trim().startsWith("#"))
  .map((line) => line.slice(0, line.indexOf("=")).trim());

const keysOf = (block) => new Set([...block.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]));

const localeKeys = () => {
  const source = readFileSync(join(root, "frontend/src/i18n.ts"), "utf8");
  const blocks = source.match(
    /^ {2}de: \{ translation: \{\n([\s\S]*?)\n {2}\} \},\n {2}en: \{ translation: \{\n([\s\S]*?)\n {2}\} \}\n\};/m
  );
  assert.ok(blocks, "could not locate the de and en translation blocks in i18n.ts");
  return { de: keysOf(blocks[1]), en: keysOf(blocks[2]) };
};

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
