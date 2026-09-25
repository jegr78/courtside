import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const localeFiles = { de: "frontend/src/locales/de.ts", en: "frontend/src/locales/en.ts" };

export function localeSources() {
  return Object.fromEntries(Object.entries(localeFiles).map(([locale, path]) => {
    const source = readFileSync(join(root, path), "utf8");
    assert.match(source, /^ {2}"app\.name":/m, `could not locate the translation entries in ${path}`);
    return [locale, source];
  }));
}

const keysOf = (source) => new Set([...source.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]));

export function localeKeys() {
  const { de, en } = localeSources();
  return { de: keysOf(de), en: keysOf(en) };
}
