import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../acceptance/", import.meta.url));
const SKIP = new Set(["node_modules", "config.example.json", "package.json", "package-lock.json", "README.md"]);
const RULES = [
  ["ISO date", /\b20\d\d-[01]\d-[0-3]\d\b/],
  ["UTC offset", /[+-](0\d|1[0-4]):[0-5]\d\b/],
  ["IPv4 address", /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/],
  ["host", /["'`/@](?![\w.-]*example\.org\b)[a-z0-9-]+(\.[a-z0-9-]+)*\.(ts\.net|com|de|net|io|dev|app|eu|org)\b/i]
];

const sources = (directory = root) => readdirSync(directory).flatMap((name) => {
  if (SKIP.has(name)) return [];
  const path = join(directory, name);
  return statSync(path).isDirectory() ? sources(path) : /\.(ts|mjs|json)$/.test(name) ? [{ path: relative(root, path), text: readFileSync(path, "utf8") }] : [];
});

export function literalOffences(files, usernames) {
  return files.flatMap(({ path, text }) => [
    ...RULES.filter(([, pattern]) => pattern.test(text)).map(([kind]) => `${path}: ${kind}`),
    ...usernames.filter((name) => text.includes(name)).map(() => `${path}: configured username`)
  ]);
}

test("given the harness sources, when scanned, then no date, offset, address, host or example username is written in them", () => {
  // given
  const usernames = Object.values(JSON.parse(readFileSync(join(root, "config.example.json"), "utf8")).personas).flat();
  // when / then
  assert.deepEqual(literalOffences(sources(), usernames), []);
});

test("given a source with a fixed week, a fixed offset, a private host and a username, when scanned, then each is named", () => {
  // given
  const file = { path: "journeys/x.spec.ts", text: 'gotoDay(page, "2030-03-11"); new Date("2030-03-11T10:00:00+02:00"); fetch("https://box.tail1234.ts.net"); persona("jane.doe");' };
  // when
  const offences = literalOffences([file], ["jane.doe"]);
  // then
  assert.deepEqual(offences.sort(), ["journeys/x.spec.ts: ISO date", "journeys/x.spec.ts: UTC offset", "journeys/x.spec.ts: configured username", "journeys/x.spec.ts: host"].sort());
});
