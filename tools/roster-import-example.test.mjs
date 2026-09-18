import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exampleFile = "examples/roster-import-example.csv";
const updateFile = "examples/roster-import-example-update.csv";
const exampleLink = `/${exampleFile}`;
const updateLink = `/${updateFile}`;

test("given the published roster example, when documentation is checked, then its data and instructions stay aligned", () => {
  // given
  const csv = readFileSync(resolve(repository, "site/public", exampleFile), "utf8");
  const updateCsv = readFileSync(resolve(repository, "site/public", updateFile), "utf8");
  const german = readFileSync(resolve(repository, "site/board-guide.md"), "utf8");
  const english = readFileSync(resolve(repository, "site/en/board-guide.md"), "utf8");

  // when
  const rows = csv.trimEnd().split("\n").map((row) => row.split(";"));
  const categories = rows.slice(1).map((row) => row[4]);
  const emails = rows.slice(1).map((row) => row[3]);
  const updates = updateCsv.trimEnd().split("\n").map((row) => row.split(";"));
  const members = new Map(rows.slice(1).map((row) => [row[0], row]));
  const updatedMembers = new Map(updates.slice(1).map((row) => [row[0], row]));
  const changed = [...updatedMembers]
    .filter(([number, row]) => row.join(";") !== members.get(number)?.join(";"))
    .map(([number]) => number);

  // then
  assert.deepEqual(rows[0], ["Member number", "First name", "Last name", "Email", "Category"]);
  assert.equal(rows.length, 25);
  assert.equal(categories.filter((category) => category === "Adult").length, 18);
  assert.equal(categories.filter((category) => category === "Junior").length, 6);
  assert.ok(emails.every((email) => email.endsWith("@example.org")));
  assert.equal(new Set(emails).size, emails.length);
  assert.deepEqual(updates[0], rows[0]);
  assert.equal(updates.length, 24);
  assert.deepEqual([...members.keys()].filter((number) => !updatedMembers.has(number)), ["EX-2006"]);
  assert.deepEqual(changed, ["EX-1001", "EX-1002"]);
  assert.deepEqual(updatedMembers.get("EX-1001")?.slice(1),
    ["Jane", "Doe", "jane.updated@example.org", "Adult"]);
  assert.deepEqual(updatedMembers.get("EX-1002")?.slice(1),
    ["John", "Roe", "john.roe@example.org", "Junior"]);
  assert.match(german, new RegExp(`\\]\\(${exampleLink.replaceAll(".", "\\.")}\\)`));
  assert.match(german, new RegExp(`\\]\\(${updateLink.replaceAll(".", "\\.")}\\)`));
  assert.match(german, /enthält 24 erfundene\s+Personen: 18 Erwachsene und 6 Jugendliche/u);
  assert.match(english, new RegExp(`\\]\\(${exampleLink.replaceAll(".", "\\.")}\\)`));
  assert.match(english, new RegExp(`\\]\\(${updateLink.replaceAll(".", "\\.")}\\)`));
  assert.match(english, /contains 24 fictional people:\s+18 adults and 6 juniors/u);
});
