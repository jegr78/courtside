import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const document = yaml.load(readFileSync(new URL("../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));
const setupView = readFileSync(new URL("../frontend/src/views/AdminSetupView.tsx", import.meta.url), "utf8");
const configurationView = readFileSync(
  new URL("../frontend/src/views/AdminConfigurationView.tsx", import.meta.url), "utf8");

// what the instance serves rather than what a board sets: the locales it ships, and the logo
// projection that logoUrl and logoUploaded already account for
const derived = ["supportedLocales", "logoFallbackUrl", "installedAppName"];

function declaredFields(schemaName) {
  const schema = document.components.schemas[schemaName];
  assert.ok(schema, `the API document no longer declares ${schemaName}`);
  const fields = [
    ...Object.keys(schema.properties ?? {}),
    ...(schema.allOf ?? []).flatMap((part) => Object.keys(part.properties ?? {})),
    ...(schema.allOf ?? [])
      .filter((part) => part.$ref)
      .flatMap((part) => declaredFields(part.$ref.replace("#/components/schemas/", "")))
  ];
  assert.ok(fields.length > 0, `${schemaName} resolved to no fields, so this guard would compare nothing`);
  return [...new Set(fields)];
}

function listedFields(source, declaration, indent) {
  // anchored at a line start so a comment naming the declaration cannot redirect the scan
  const start = source.search(new RegExp(`^${declaration}`, "mu"));
  assert.ok(start >= 0, `${declaration} is gone, so this guard no longer reads what it names`);
  const end = source.indexOf("\n" + " ".repeat(indent - 2) + "}", start);
  assert.ok(end > start, `${declaration} has no closing brace at indent ${indent - 2}`);
  const fields = [...source.slice(start, end).matchAll(new RegExp(`^ {${indent}}(\\w+):`, "gmu"))]
    .map(([, field]) => field);
  assert.ok(fields.length > 0, `${declaration} resolved to no fields, so this guard would compare nothing`);
  return fields;
}

test("given a field a board configures, when the setup step judges the club, then the factory inventory names it", () => {
  // when / then
  assert.deepEqual(
    listedFields(setupView, "const factoryConfiguration", 2).toSorted(),
    declaredFields("AdminClubConfig").filter((field) => !derived.includes(field)).toSorted(),
    "AdminSetupView's factory configuration has drifted from AdminClubConfig");
});

test("given a field a board may change, when the configuration form submits, then the editable list names it", () => {
  // when / then
  assert.deepEqual(
    listedFields(configurationView, "function editable\\(", 4).toSorted(),
    declaredFields("ClubConfigRequest").toSorted(),
    "AdminConfigurationView's editable list has drifted from ClubConfigRequest");
});

test("given a field excluded from the comparison, when the document is read, then no board can write it", () => {
  // when / then
  const declared = declaredFields("AdminClubConfig");
  const writable = declaredFields("ClubConfigRequest");
  for (const field of derived) {
    assert.ok(declared.includes(field), `${field} is excluded but the document no longer declares it`);
    assert.ok(!writable.includes(field),
      `${field} is excluded from the comparison although ClubConfigRequest lets a board write it`);
  }
});
