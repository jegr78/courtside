import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  const planned = catalog.tests.find(({ status }) => status === "planned");
  const missingControlRationale = structuredClone(catalog);
  const blockedControl = missingControlRationale.controlCoverage.flatMap(({ controls }) => controls)
    .find(({ status }) => status === "blocked");
  delete blockedControl.rationale;
  const missingControlOwner = structuredClone(catalog);
  const plannedControl = missingControlOwner.controlCoverage.flatMap(({ controls }) => controls)
    .find(({ status }) => status === "planned");
  delete plannedControl.trackingIssue;

  // when / then
  assert.equal(validate({ ...catalog, tests: [{ ...blocked, rationale: undefined }] }), false);
  assert.equal(validate({ ...catalog, tests: [{ ...planned, trackingIssue: undefined }] }), false);
  assert.equal(validate(missingControlRationale), false);
  assert.equal(validate(missingControlOwner), false);
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

test("given the pinned OWASP inventories, when classifying controls, then no control is omitted or classified twice", () => {
  // given
  const controls = catalog.controlCoverage.flatMap(({ controls }) => controls);
  const controlIds = controls.map(({ id }) => id);
  const expectedInventories = {
    asvs: {
      commit: "936f29673daa69fe90e6fa706011f89aef201988",
      digest: "b0210d04c05d683bff51b9e7a91be3748c2b300c5ea13d2805d22647b0ceeefa"
    },
    wstg: {
      commit: "dd33419e10edb22b78d89325a6c2aad9f184e3a2",
      digest: "0133170c62fcb231d2cc3437dd4c6397590272885b9ba7cd4e94fceb8b82106b"
    }
  };

  // when / then
  assert.equal(new Set(controlIds).size, controlIds.length);
  assert.equal(controls.every(({ status }) => ["planned", "implemented", "blocked", "not-applicable"].includes(status)), true);
  for (const coverage of catalog.controlCoverage) {
    const digest = createHash("sha256")
      .update(coverage.controls.map(({ id }) => id).toSorted().join("\n"))
      .digest("hex");
    assert.equal(coverage.sourceCommit, expectedInventories[coverage.standard].commit);
    assert.equal(digest, expectedInventories[coverage.standard].digest);
  }
  for (const entry of catalog.tests) {
    for (const reference of [...entry.standardReferences.asvs, ...entry.standardReferences.wstg]) {
      assert.equal(controlIds.includes(reference), true, `${reference} is missing from control coverage`);
    }
  }
});

test("given assessment profiles and outcomes, when authorizing a run, then unsafe ambiguity fails closed", () => {
  // given
  const validate = new Ajv({ strict: true, strictRequired: false, allErrors: true }).compile(schema);

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
  assert.equal(validate({ ...catalog, profiles: { ...catalog.profiles, active: {
    ...catalog.profiles.active,
    allowedEnvironments: ["EXPLICIT_PRODUCTION"]
  } } }), false);
  assert.equal(validate({ ...catalog, profiles: { ...catalog.profiles, safe: {
    ...catalog.profiles.safe,
    productionRequiresExplicitAuthorization: false
  } } }), false);
});

test("given a single maintainer, when recording a security decision, then independent review is transparent but not mandatory", () => {
  // when / then
  assert.equal(catalog.governance.singleMaintainerMayApprove, true);
  assert.equal(catalog.governance.independentReviewRecorded, true);
  assert.equal(catalog.governance.missingIndependentReviewBlocks, false);
});
