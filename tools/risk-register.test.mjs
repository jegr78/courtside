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

test("given the maintained risks, when validating the register, then every risk is closed and owned", () => {
  // when
  const result = validateRiskRegister(register, { catalog, exceptions });

  // then
  const maintained = register.areas.flatMap((area) => area.risks.map(({ id }) => id)).toSorted();
  assert.ok(maintained.length > 0, "the register keeps at least one risk");
  assert.equal(result.riskCount, maintained.length);
  assert.deepEqual(result.riskIds.toSorted(), maintained);
});

test("given malformed governance data, when validating, then the register fails closed", () => {
  // given
  const duplicate = structuredClone(register);
  duplicate.areas[0].risks.push(structuredClone(duplicate.areas[0].risks[0]));
  const unknownField = structuredClone(register);
  unknownField.areas[0].risks[0].secret = "should-not-be-here";
  const injectedMarkdown = structuredClone(register);
  injectedMarkdown.areas[0].risks[0].openGap = "Safe | forged column";
  const personalData = structuredClone(register);
  personalData.automationGaps[0].summary = "Contact jane.doe@example.org";

  // when / then
  assert.throws(() => validateRiskRegister(duplicate, { catalog, exceptions }),
    /duplicate risk ID/i);
  assert.throws(() => validateRiskRegister(unknownField, { catalog, exceptions }),
    /schema/i);
  assert.throws(() => validateRiskRegister(injectedMarkdown, { catalog, exceptions }),
    /unsafe generated Markdown/i);
  assert.throws(() => renderQualityStrategy(strategy, injectedMarkdown), /unsafe generated Markdown/i);
  assert.throws(() => validateRiskRegister(personalData, { catalog, exceptions }),
    /personal-data shaped text/i);
});

test("given an unowned acceptance, when checking governance, then it cannot disappear from the register", () => {
  // given
  const unowned = structuredClone(exceptions);
  unowned.riskAcceptances.push({ ...unowned.riskAcceptances[0], id: "unowned-acceptance" });
  const deadReference = structuredClone(register);
  deadReference.areas[0].risks[2].acceptanceIds = ["missing-acceptance"];

  // when / then
  assert.throws(() => validateRiskRegister(register, { catalog, exceptions: unowned }),
    /no quality risk relationship/i);
  assert.throws(() => validateRiskRegister(deadReference, { catalog, exceptions }),
    /unknown acceptance/i);
});

test("given an assessment risk reference, when it is orphaned, then validation rejects the catalog", () => {
  // given
  const orphaned = structuredClone(catalog);
  orphaned.tests[0].qualityRiskIds = ["MISSING-1"];

  // when / then
  assert.throws(() => validateRiskRegister(register, { catalog: orphaned, exceptions }),
    /unknown risk ID MISSING-1/i);
  const uncovered = structuredClone(catalog);
  uncovered.threatModel.surfaces.push({ id: "new-product-surface", title: "New product surface" });
  assert.throws(() => validateRiskRegister(register, { catalog: uncovered, exceptions }),
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
