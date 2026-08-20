import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repository = fileURLToPath(new URL("..", import.meta.url));

const SEARCHED = ["tools", "frontend/src", "frontend/e2e", "deploy"];
const SKIPPED = new Set(["node_modules", "dist", "coverage", "test-results", "playwright-report"]);
const EXTENSIONS = new Set([".mjs", ".js", ".cjs", ".ts", ".tsx"]);

const SETTING = /rejectUnauthorized\s*:\s*([^,\s}]+)/;
const ENVIRONMENT = /NODE_TLS_REJECT_UNAUTHORIZED/;

const weakened = (line) => SETTING.exec(line)?.[1] !== undefined && SETTING.exec(line)[1] !== "true";
const wholesale = (line) => ENVIRONMENT.test(line);

function sources(directory) {
  let entries;
  try {
    entries = readdirSync(join(repository, directory), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIPPED.has(entry.name) ? [] : sources(join(directory, entry.name));
    }
    return EXTENSIONS.has(extname(entry.name)) ? [join(directory, entry.name)] : [];
  });
}

// This file names both patterns in order to search for them.
const SELF = relative(repository, fileURLToPath(import.meta.url));

function offenders(offends) {
  return SEARCHED.flatMap(sources).filter((file) => file !== SELF).flatMap((file) => {
    const lines = readFileSync(join(repository, file), "utf8").split("\n");
    return lines.flatMap((line, index) => (offends(line) ? [`${file}:${index + 1}`] : []));
  });
}

test("given the repository's own JavaScript, when it opens TLS, then no call weakens the check", () => {
  // when / then
  assert.deepEqual(offenders(weakened), [],
    "rejectUnauthorized takes true or nothing at all. Anything else — a literal false, or a value "
    + "that happens to be falsy — turns a handshake that proves something into one that proves "
    + "nothing, and CodeQL only flags the literal.");
});

test("given the repository's own JavaScript, when it opens TLS, then it never switches the check off wholesale", () => {
  // when / then
  assert.deepEqual(offenders(wholesale), [],
    "NODE_TLS_REJECT_UNAUTHORIZED disables validation for the whole process, including calls made "
    + "by libraries that never asked for it");
});
