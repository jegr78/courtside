import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const keysOf = (block) => new Set([...block.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]));

export function localeKeys() {
  const source = readFileSync(join(root, "frontend/src/i18n.ts"), "utf8");
  const blocks = source.match(
    /^ {2}de: \{ translation: \{\n([\s\S]*?)\n {2}\} \},\n {2}en: \{ translation: \{\n([\s\S]*?)\n {2}\} \}\n\};/m
  );
  assert.ok(blocks, "could not locate the de and en translation blocks in i18n.ts");
  return { de: keysOf(blocks[1]), en: keysOf(blocks[2]) };
}
