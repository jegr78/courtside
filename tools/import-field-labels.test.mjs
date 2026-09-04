import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { localeKeys } from "./i18n-bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const canonicalFields = () => {
  const document = readFileSync(join(root, "src/main/resources/api/openapi.yaml"), "utf8");
  const declaration = document.match(/^ {4}CanonicalField:[\s\S]*?^ {6}enum: \[([^\]]+)\]/m);
  assert.ok(declaration, "could not locate the CanonicalField enum in the API document");
  return declaration[1].split(",").map((value) => value.trim());
};

test("given every field a snapshot can carry, when checking each locale, then the club reads a name for it", () => {
  // given
  const { de, en } = localeKeys();
  const fields = canonicalFields();

  // when
  const missing = fields.flatMap((field) => [
    ...(de.has(`admin.import.field.${field}`) ? [] : [`de: ${field}`]),
    ...(en.has(`admin.import.field.${field}`) ? [] : [`en: ${field}`])
  ]);

  // then
  assert.ok(fields.length >= 5, "the enum should not have shrunk to nothing");
  assert.deepEqual(missing, []);
});
