import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/test-stability.yml", import.meta.url), "utf8");
const build = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
const browserOrder = workflow.slice(workflow.indexOf("  browser-order:"), workflow.indexOf("  browser-compatibility:"));

test("given periodic stability evidence, when reading its workflow, then backend and browser order proofs retain first attempts", () => {
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /reversealphabetical, random/);
  assert.match(workflow, /surefire\.runOrder\.random\.seed/);
  assert.match(workflow, /project_order: \[configured, reversed\]/);
  assert.match(workflow, /COURTSIDE_PROJECT_ORDER:/);
  assert.doesNotMatch(workflow, /--workers=2/);
  assert.doesNotMatch(workflow, /for attempt in 1 2 3/);
  assert.doesNotMatch(workflow, /retries:/);
  assert.match(workflow, /Upload first-attempt evidence/);
  assert.match(workflow, /Upload first-attempt browser evidence/);
});

test("given the WebKit reliability matrix, when comparing local and hosted execution, then both use the bounded orchestrator", () => {
  assert.match(browserOrder, /npm run reliability:webkit -- --order \"\$\{COURTSIDE_PROJECT_ORDER\}\"/);
  assert.match(browserOrder, /browser-order:[\s\S]*timeout-minutes: 40/);
  assert.match(browserOrder, /Package application\n\s+timeout-minutes: 10/);
  assert.match(browserOrder, /Prove browser isolation under varied project order\n\s+timeout-minutes: 27/);
  assert.match(browserOrder, /quality\/webkit-reliability\.schema\.json/);
  assert.match(browserOrder, /frontend\/test-results\/webkit-reliability\/\*\.json/);
  assert.match(browserOrder, /if: \$\{\{ always\(\) && steps\.validate-webkit-record\.outcome == 'success' \}\}/);
  assert.doesNotMatch(browserOrder, /npm run test:e2e/);
  assert.doesNotMatch(browserOrder, /continue-on-error/);
  assert.match(browserOrder, /Upload first-attempt browser evidence[\s\S]*retention-days: 14/);
  assert.match(browserOrder, /Upload redacted WebKit reliability history[\s\S]*retention-days: 90/);
});

test("given a required build failure, when collecting evidence, then backend and browser diagnostics survive", () => {
  assert.match(build, /timeout-minutes: 30/);
  assert.match(build, /target\/surefire-reports\/\*\.xml/);
  assert.match(build, /frontend\/test-results\/visual-journeys/);
  assert.match(build, /frontend\/test-results\/\*\*\/trace\.zip/);
  assert.match(build, /frontend\/test-results\/\*\*\/\*\.png/);
  assert.match(build, /frontend\/test-results\/browser-diagnostics\/\*\.json/);
  assert.match(browserOrder, /frontend\/test-results\/browser-diagnostics\/\*\.json/);
  assert.match(browserOrder, /frontend\/test-results\/browser-gate-outcome\.json/);
  assert.match(browserOrder, /frontend\/test-results\/\*\*\/trace\.zip/);
  assert.match(browserOrder, /frontend\/test-results\/\*\*\/error-context\.md/);
  assert.doesNotMatch(build, /frontend\/playwright-report/);
  assert.doesNotMatch(workflow, /frontend\/playwright-report/);
});
