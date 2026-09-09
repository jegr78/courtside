import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repositoryFile = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const catalog = JSON.parse(repositoryFile("security/assessment-catalog.json"));
const contract = repositoryFile("docs/security-assessment.md");

const controls = catalog.controlCoverage.flatMap((coverage) => coverage.controls);

const stated = (control) =>
  typeof control.rationale === "string" && control.rationale.trim().length > 0;

test("given the controls the catalog pins, when they are read, then there are enough to judge",
  () => {
    // when / then
    assert.ok(controls.length >= 300,
      `the catalog pins ${controls.length} controls, too few for this gate to mean anything`);
  });

test("given a control that is not implemented, when its disposition is read, then the catalog says why",
  () => {
    // given
    const undecided = controls.filter((control) => control.status !== "implemented");

    // when / then
    for (const control of undecided) {
      assert.ok(stated(control),
        `${control.id} is ${control.status} and the catalog does not say why. A disposition is a `
        + "rationale here, not an issue in the tracker");
    }
  });

test("given a control that names a tracking issue, when it is read, then the reason lives here too",
  () => {
    // given
    const tracked = controls.filter((control) => control.trackingIssue !== undefined);

    // when / then
    for (const control of tracked) {
      assert.ok(stated(control),
        `${control.id} points at issue ${control.trackingIssue} and explains nothing here. An `
        + "issue can be closed, renamed or archived; the catalog is what a reader still has");
    }
  });

test("given the disposition rule, when the process document is read, then it still refuses the reflex",
  () => {
    // when / then
    assert.match(contract, /A disposition is a rationale in this catalog, not an issue in the tracker/,
      "docs/security-assessment.md no longer states where a reading puts what it could not anchor");
    assert.match(contract, /`blocked`: execution needs a missing capability or external state, with a rationale/,
      "docs/security-assessment.md requires a tracking issue for a blocked control again");
  });
