import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const catalog = JSON.parse(readFileSync(new URL("../security/assessment-catalog.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(new URL("../security/assessment-catalog.schema.json", import.meta.url), "utf8"));
const contract = readFileSync(new URL("../docs/security-assessment.md", import.meta.url), "utf8");

test("given the security catalog, when validating it, then every entry satisfies the documented schema", () => {
  // given
  const validate = new Ajv({ strict: true, strictRequired: false, allErrors: true }).compile(schema);

  // when
  const valid = validate(catalog);

  // then
  assert.equal(valid, true, JSON.stringify(validate.errors));
});

test("given an unresolved catalog entry, when validation runs, then ownership and rationale cannot be omitted", () => {
  // given
  const validate = new Ajv({ strict: true, strictRequired: false, allErrors: true }).compile(schema);
  const blocked = catalog.tests.find(({ status }) => status === "blocked");

  // when / then
  assert.equal(validate({ ...catalog, tests: [{ ...blocked, rationale: undefined }] }), false);
  assert.equal(validate({ ...catalog, tests: [{ ...catalog.tests[0], trackingIssue: undefined }] }), false);
});

test("given the shipped attack surface, when reading the catalog, then every actor and surface is covered", () => {
  // given
  const expectedRoles = [
    "ANONYMOUS", "MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER",
    "TREASURER", "ADMIN", "COMPROMISED_ACCOUNT"
  ];

  // when
  const coveredRoles = new Set(catalog.tests.flatMap((entry) => entry.roles));
  const coveredSurfaces = new Set(catalog.tests.map((entry) => entry.surface));

  // then
  assert.deepEqual(catalog.threatModel.roles, expectedRoles);
  assert.deepEqual([...coveredRoles].toSorted(), [...expectedRoles].toSorted());
  assert.deepEqual([...coveredSurfaces].toSorted(), catalog.threatModel.surfaces.map(({ id }) => id).toSorted());
});

test("given stable catalog identities, when maintaining coverage, then identifiers and named surfaces stay unique", () => {
  // given
  const testIds = catalog.tests.map(({ id }) => id);
  const surfaceIds = catalog.threatModel.surfaces.map(({ id }) => id);
  const severityLevels = catalog.severity.map(({ level }) => level);

  // when / then
  assert.equal(new Set(testIds).size, testIds.length);
  assert.equal(new Set(surfaceIds).size, surfaceIds.length);
  assert.deepEqual(severityLevels, ["P0", "P1", "P2", "P3"]);
  assert.equal(catalog.tests.some(({ status }) => status === "blocked"), true);
  assert.equal(catalog.tests.some(({ status }) => status === "implemented"), true);
  assert.equal(catalog.tests.some(({ status }) => status === "planned"), true);
});

test("given pinned standards, when referencing controls, then identifiers are version-qualified", () => {
  // when / then
  assert.deepEqual(catalog.standards, {
    wstg: "4.2",
    asvs: "5.0.0-level-2",
    apiSecurityTop10: "2023",
    owaspTop10: "2025",
    cvss: "4.0"
  });
  for (const entry of catalog.tests) {
    for (const reference of entry.standardReferences.asvs) assert.match(reference, /^v5\.0\.0-\d+\.\d+\.\d+$/);
    for (const reference of entry.standardReferences.wstg) assert.match(reference, /^WSTG-v4\.2-[A-Z]+-\d{2}$/);
  }
});

test("given assessment profiles and outcomes, when authorizing a run, then unsafe ambiguity fails closed", () => {
  // when / then
  assert.equal(catalog.profiles.safe.productionAllowed, true);
  assert.equal(catalog.profiles.safe.productionRequiresExplicitAuthorization, true);
  assert.equal(catalog.profiles.active.productionAllowed, false);
  assert.equal(catalog.profiles.destructive.productionAllowed, false);
  assert.equal(catalog.profiles.active.requiresExplicitAuthorization, true);
  assert.equal(catalog.profiles.destructive.requiresExplicitAuthorization, true);
  assert.equal(catalog.outcomes.incomplete.releaseEligible, false);
  assert.equal(catalog.outcomes.failed.releaseEligible, false);
  assert.match(contract, /does not replace an independent penetration test/i);
  assert.match(contract, /docs\/quality-strategy\.md/);
});

test("given a single maintainer, when recording a security decision, then independent review is transparent but not mandatory", () => {
  // when / then
  assert.equal(catalog.governance.singleMaintainerMayApprove, true);
  assert.equal(catalog.governance.independentReviewRecorded, true);
  assert.equal(catalog.governance.missingIndependentReviewBlocks, false);
});
