import assert from "node:assert/strict";
import { test } from "node:test";
import { securityUpdateReport } from "./security-update-report.mjs";

test("given a proposed security-tool update, when comparing it with the base, then versions policies and schemas are visible", () => {
  // when
  const report = securityUpdateReport("origin/main");

  // then
  assert.match(report, /Previous runtime tools:/);
  assert.match(report, /Current runtime tools:/);
  assert.match(report, /security\/run-contract\.json/);
  assert.match(report, /security\/assessment-catalog\.json/);
  assert.match(report, /security\/assessment-gate\.schema\.json/);
  assert.match(report, /Previous SHA-256.*Current SHA-256.*Changed/);
});
