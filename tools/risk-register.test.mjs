import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  renderQualityStrategy,
  validateRiskRegister
} from "./risk-register.mjs";

const register = JSON.parse(readFileSync(new URL("../quality/risk-register.json", import.meta.url), "utf8"));
const catalog = JSON.parse(readFileSync(new URL("../security/assessment-catalog.json", import.meta.url), "utf8"));
const exceptions = JSON.parse(readFileSync(new URL("../security/exceptions.json", import.meta.url), "utf8"));
const strategy = readFileSync(new URL("../docs/quality-strategy.md", import.meta.url), "utf8");
const buildWorkflow = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
const trackerWorkflow = readFileSync(new URL("../.github/workflows/nightly-failure-tracking.yml", import.meta.url), "utf8");

test("given the maintained risks, when validating the register, then every risk is closed and current", () => {
  // when
  const result = validateRiskRegister(register, { catalog, exceptions, today: "2026-09-05" });

  // then
  assert.equal(result.riskCount, 18);
  assert.deepEqual(result.riskIds, [
    "AD-1", "AD-2", "BK-1", "BK-2", "BK-3", "BK-4", "ID-1", "ID-2", "ID-3",
    "MB-1", "MB-2", "OP-1", "OP-2", "OP-3", "OP-4", "UI-1", "UI-2", "UI-3"
  ]);
});

test("given malformed governance data, when validating, then the register fails closed", () => {
  // given
  const duplicate = structuredClone(register);
  duplicate.areas[0].risks.push(structuredClone(duplicate.areas[0].risks[0]));
  const unknownField = structuredClone(register);
  unknownField.areas[0].risks[0].secret = "should-not-be-here";
  const lateReview = structuredClone(register);
  lateReview.areas[0].risks[0].nextReviewOn = "2026-12-05";
  const injectedMarkdown = structuredClone(register);
  injectedMarkdown.areas[0].risks[0].openGap = "Safe | forged column";
  const personalData = structuredClone(register);
  personalData.automationGaps[0].summary = "Contact jane.doe@example.org";

  // when / then
  assert.throws(() => validateRiskRegister(duplicate, { catalog, exceptions, today: "2026-09-05" }),
    /duplicate risk ID/i);
  assert.throws(() => validateRiskRegister(unknownField, { catalog, exceptions, today: "2026-09-05" }),
    /schema/i);
  assert.throws(() => validateRiskRegister(lateReview, { catalog, exceptions, today: "2026-09-05" }),
    /review deadline/i);
  assert.throws(() => validateRiskRegister(injectedMarkdown, { catalog, exceptions, today: "2026-09-05" }),
    /unsafe generated Markdown/i);
  assert.throws(() => renderQualityStrategy(strategy, injectedMarkdown), /unsafe generated Markdown/i);
  assert.throws(() => validateRiskRegister(personalData, { catalog, exceptions, today: "2026-09-05" }),
    /personal-data shaped text/i);
  const futureExceptions = structuredClone(exceptions);
  futureExceptions.riskAcceptances[0].expiresOn = "2027-11-30";
  assert.throws(() => validateRiskRegister(register, { catalog, exceptions: futureExceptions, today: "2026-12-05" }),
    /overdue/i);
  assert.throws(() => validateRiskRegister(register, { catalog, exceptions, today: "not-a-date" }),
    /invalid risk review date/i);
});

test("given acceptance and evidence expiry, when scheduling review, then the earliest date wins", () => {
  // given
  const governed = structuredClone(register);
  const risk = governed.areas.flatMap((area) => area.risks).find((entry) => entry.id === "ID-3");
  risk.acceptanceIds = ["remote-https-club-logo-2026"];
  risk.protectedEvidence = [{
    id: "security-run-2026-09-05",
    digest: `sha256:${"a".repeat(64)}`,
    status: "retained",
    expiresOn: "2026-10-15"
  }];
  risk.nextReviewOn = "2026-10-15";

  // when
  const result = validateRiskRegister(governed, { catalog, exceptions, today: "2026-09-05" });

  // then
  assert.equal(result.riskCount, 18);
  risk.nextReviewOn = "2026-10-16";
  assert.throws(() => validateRiskRegister(governed, { catalog, exceptions, today: "2026-09-05" }),
    /review deadline/i);
});

test("given an unowned or expired acceptance, when checking governance, then it cannot disappear from review", () => {
  // given
  const unowned = structuredClone(exceptions);
  unowned.riskAcceptances.push({ ...unowned.riskAcceptances[0], id: "unowned-acceptance" });
  const expired = structuredClone(exceptions);
  expired.riskAcceptances[0].expiresOn = "2026-09-04";
  const deadReference = structuredClone(register);
  deadReference.areas[0].risks[2].acceptanceIds = ["missing-acceptance"];

  // when / then
  assert.throws(() => validateRiskRegister(register, { catalog, exceptions: unowned, today: "2026-09-05" }),
    /no quality risk relationship/i);
  assert.throws(() => validateRiskRegister(register, { catalog, exceptions: expired, today: "2026-09-05" }),
    /expired/i);
  assert.throws(() => validateRiskRegister(deadReference, { catalog, exceptions, today: "2026-09-05" }),
    /unknown acceptance/i);
});

test("given a protected evidence reference, when it carries a location or payload, then validation rejects it", () => {
  // given
  const unsafe = structuredClone(register);
  unsafe.areas[0].risks[0].protectedEvidence = [{
    id: "security-run-2026-09-05",
    digest: `sha256:${"b".repeat(64)}`,
    status: "retained",
    expiresOn: "2026-10-15",
    location: "restricted/result.json"
  }];

  // when / then
  assert.throws(() => validateRiskRegister(unsafe, { catalog, exceptions, today: "2026-09-05" }),
    /schema/i);
  const expired = structuredClone(register);
  expired.areas[0].risks[2].protectedEvidence[0].expiresOn = "2026-09-04";
  expired.areas[0].risks[2].nextReviewOn = "2026-09-04";
  assert.throws(() => validateRiskRegister(expired, { catalog, exceptions, today: "2026-09-05" }),
    /protected evidence .* expired/i);
});

test("given an assessment risk reference, when it is orphaned, then validation rejects the catalog", () => {
  // given
  const orphaned = structuredClone(catalog);
  orphaned.tests[0].qualityRiskIds = ["MISSING-1"];

  // when / then
  assert.throws(() => validateRiskRegister(register, { catalog: orphaned, exceptions, today: "2026-09-05" }),
    /unknown risk ID MISSING-1/i);
  const uncovered = structuredClone(catalog);
  uncovered.threatModel.surfaces.push({ id: "new-product-surface", title: "New product surface" });
  assert.throws(() => validateRiskRegister(register, { catalog: uncovered, exceptions, today: "2026-09-05" }),
    /no risk-related assessment/i);
});

test("given the generated strategy section, when rendering twice, then output is stable and preserves prose", () => {
  // when
  const first = renderQualityStrategy(strategy, register);
  const second = renderQualityStrategy(first, register);

  // then
  assert.equal(first, strategy);
  assert.equal(second, first);
  assert.match(first, /## Test levels/);
});

test("given invalid generated markers, when rendering, then hand-written prose is protected", () => {
  // when / then
  assert.throws(() => renderQualityStrategy(strategy.replace("<!-- risk-register:booking:end -->", ""), register),
    /generated markers/i);
  assert.throws(() => renderQualityStrategy(strategy.replace("<!-- risk-register:booking:start -->", "<!-- risk-register:booking:end -->"), register),
    /generated markers/i);
});

test("given nightly governance drift, when the scheduled build fails, then the existing tracker owns it", () => {
  // when / then
  assert.match(buildWorkflow, /schedule:\s*\n\s*- cron:/);
  assert.match(buildWorkflow, /node tools\/docs-check\.mjs --check/);
  assert.match(trackerWorkflow, /- build/);
  assert.match(trackerWorkflow, /nightly-failure-tracker\.mjs/);
});
