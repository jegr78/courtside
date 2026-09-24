import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { localeKeys } from "./i18n-bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function declaredProblemTypes(sources) {
  const slugs = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/new ProblemType\(\s*"([a-z0-9-]+)"/g)) slugs.add(match[1]);
    for (const match of source.matchAll(/"urn:courtside:error:([a-z0-9-]+)"/g)) slugs.add(match[1]);
  }
  return [...slugs].sort();
}

function unreadDeclarations(sources) {
  return sources.flatMap((source) => [...source.matchAll(/new ProblemType\((?!\s*")\s*([^,)]*)/g)].map((match) => match[1].trim()));
}

function javaSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? javaSources(join(directory, entry.name))
    : entry.name.endsWith(".java") ? [readFileSync(join(directory, entry.name), "utf8")] : []);
}

test("given a problem type declared either way, when the declarations are read, then its slug is found", () => {
  // when
  const slugs = declaredProblemTypes([
    'new ProblemType(\n            "court-unavailable", HttpStatus.CONFLICT,',
    'problem.setType(URI.create("urn:courtside:error:payload-too-large"));',
    'new ProblemType(slug, status, title, detail)'
  ]);

  // then
  assert.deepEqual(slugs, ["court-unavailable", "payload-too-large"]);
});

test("given every problem type the instance declares, when each locale is read, then it names exactly those types", () => {
  // given
  const { de, en } = localeKeys();
  const declared = declaredProblemTypes(javaSources(join(root, "src/main/java")));
  const translated = (locale) => [...locale].filter((key) => key.startsWith("error.type."))
    .map((key) => key.slice("error.type.".length)).sort();

  // when
  const inDe = translated(de);
  const inEn = translated(en);

  // then
  assert.ok(declared.length > 50, `only ${declared.length} problem types were found, so the scan is not reading the declarations`);
  assert.deepEqual(unreadDeclarations(javaSources(join(root, "src/main/java"))), [],
    "a problem type whose slug is not a literal cannot be matched to its message");
  assert.deepEqual(inDe, declared, "de must carry one \"error.type.<slug>\" message per declared problem type and no other");
  assert.deepEqual(inEn, declared, "en must carry one \"error.type.<slug>\" message per declared problem type and no other");
});
