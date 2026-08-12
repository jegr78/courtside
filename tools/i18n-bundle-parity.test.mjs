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

const clientKeys = () => {
  const source = readFileSync(join(root, "frontend/src/i18n.ts"), "utf8");
  return new Set([...source.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]));
};

test("given every backend message key, when checking the web client bundle, then each key is translated", () => {
  // given
  const translated = clientKeys();

  // when
  const missing = backendKeys().filter((key) => !translated.has(key));

  // then
  assert.deepEqual(missing, [],
    `The web client renders these codes as error.generic: ${missing.join(", ")}`);
});
