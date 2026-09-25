import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const document = yaml.load(readFileSync(new URL("../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));
const setupView = readFileSync(new URL("../frontend/src/views/AdminSetupView.tsx", import.meta.url), "utf8");
const configurationRequest = readFileSync(
  new URL("../frontend/src/views/configuration/clubConfigForm.ts", import.meta.url), "utf8");

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
    listedFields(configurationRequest, "export function editable\\(", 4).toSorted(),
    declaredFields("ClubConfigRequest").toSorted(),
    "the configuration forms' editable list has drifted from ClubConfigRequest");
});

function ownedFields(source) {
  const start = source.search(/^export const ownedFields = \{/mu);
  assert.ok(start >= 0, "ownedFields is gone, so this guard no longer reads what each page owns");
  const end = source.indexOf("\n}", start);
  assert.ok(end > start, "ownedFields has no closing brace at the start of a line");
  const pages = [...source.slice(start, end).matchAll(/^ {2}(\w+): \[([^\]]*)\]/gmu)]
    .map(([, page, list]) => [page, [...list.matchAll(/"(\w+)"/gu)].map(([, field]) => field)]);
  assert.ok(pages.length > 1, "ownedFields resolved to fewer than two pages, so this guard would compare nothing");
  return pages;
}

test("given every field a board may change, when the configuration pages save, then exactly one page owns it", () => {
  // given
  const pages = ownedFields(configurationRequest);
  const owned = pages.flatMap(([, fields]) => fields);

  // when / then
  for (const field of new Set(owned)) {
    const owners = pages.filter(([, fields]) => fields.includes(field)).map(([page]) => page);
    assert.equal(owners.length, 1, `${field} is owned by ${owners.join(" and ")}, so their saves would overwrite each other`);
  }
  assert.deepEqual(owned.toSorted(), declaredFields("ClubConfigRequest").toSorted(),
    "a ClubConfigRequest field no page owns is written back from whatever was read, and a field that is not in the request is owned for nothing");
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
