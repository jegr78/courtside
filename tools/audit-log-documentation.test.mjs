import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function repositoryFile(path) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

const SNAPSHOT = "src/test/resources/domain-event-payload.properties";
const recordedTypes = repositoryFile(SNAPSHOT).split("\n")
  .filter((line) => line.includes("=") && !line.startsWith("#"))
  .map((line) => line.slice(0, line.indexOf("=")).trim());

const families = new Map();
for (const type of recordedTypes) {
  families.set(type.slice(0, type.indexOf(".")),
    [...families.get(type.slice(0, type.indexOf("."))) ?? [], type]);
}

const design = repositoryFile("docs/design.md");
const dataModel = repositoryFile("docs/data-model.md");
const api = repositoryFile("src/main/resources/api/openapi.yaml");

function auditOperation() {
  const start = api.indexOf("  /api/admin/audit:");
  assert.notEqual(start, -1, "the API document no longer describes GET /api/admin/audit");
  const end = api.indexOf("\n  /api/", start + 1);
  return api.slice(start, end === -1 ? api.length : end);
}

const names = (document, types) => types.some((type) => document.includes(`\`${type}\``));

// Restricted to families the snapshot knows, so a Java package name in prose is not an event type.
const mentionedIn = (document) =>
  [...document.matchAll(/`([a-z]+\.[A-Za-z]+\.[A-Za-z]+)`/g)].map((match) => match[1])
    .filter((type) => families.has(type.slice(0, type.indexOf("."))));

test("given the recorded payload snapshot, when it is read, then it still carries several families",
  () => {
    // when / then
    assert.ok(families.size >= 8,
      `the snapshot holds only ${families.size} families, so this gate proves nothing`);
  });

test("given every family the log holds, when the data model describes the table, then it names each one",
  () => {
    // when / then
    for (const [family, types] of families) {
      assert.ok(names(dataModel, types),
        `docs/data-model.md names no recorded ${family} event, so a reader of the table cannot `
        + `tell it holds them. Name one of: ${types.join(", ")}`);
    }
  });

test("given every family the log returns, when the API document describes the endpoint, then it names each one",
  () => {
    // given
    const operation = auditOperation();

    // when / then
    for (const [family, types] of families) {
      assert.ok(names(operation, types),
        `the readAuditLog block names no recorded ${family} event, so a client cannot tell what a `
        + `page can contain. Name one of: ${types.join(", ")}`);
    }
  });

// The specification once stated that bookings were not recorded while four booking events were.
test("given the booking events the log holds, when the specification describes it, then it names one",
  () => {
    // when / then
    assert.ok(names(design, families.get("booking") ?? []),
      "docs/design.md names no recorded booking event, so section 0 can claim again that the log "
      + "excludes them");
  });

test("given an event type a document names, when the snapshot no longer records it, then it is found",
  () => {
    // given
    const documents = [["docs/data-model.md", dataModel], ["the readAuditLog block", auditOperation()]];

    // when / then
    for (const [label, document] of documents) {
      const mentioned = mentionedIn(document);
      assert.ok(mentioned.length > 0, `${label} names no event type at all`);
      for (const type of mentioned) {
        assert.ok(recordedTypes.includes(type),
          `${label} names ${type}, which ${SNAPSHOT} no longer records`);
      }
    }
  });
