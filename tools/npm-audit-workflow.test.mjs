import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const workflow = readFileSync(new URL("../.github/workflows/npm-audit.yml", import.meta.url), "utf8");
const build = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const frontendPackage = JSON.parse(readFileSync(new URL("../frontend/package.json", import.meta.url), "utf8"));

test("given the remote audit, when workflows select its cadence, then pull requests omit it and Tuesday runs retain evidence", () => {
  // given
  const auditSteps = Object.entries(yaml.load(build).jobs).flatMap(([job, { steps = [] }]) => steps
    .filter((step) => /audit:security|npm-cli\.js audit/.test(step.run ?? ""))
    .map((step) => ({ job, name: step.name, condition: String(step.if ?? "") })));

  // when / then
  assert.ok(auditSteps.length > 0, "the scheduled build no longer rehearses the release npm policy");
  for (const { job, name, condition } of auditSteps) {
    assert.equal(condition, "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
      `${job}: ${name} reaches the npm registry outside a scheduled or dispatched build`);
  }
  assert.match(workflow, /schedule:[\s\S]+cron: '17 3 \* \* 2'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /npm run audit:security -- --output \.\.\/build\/security\/npm\.json/);
  assert.match(workflow, /--scope scheduled-npm-audit/);
  assert.match(workflow, /Require a completed scheduled audit[\s\S]+\.status == "completed"/);
  assert.match(workflow, /npm-audit-summary\.json/);
});

test("given local and release audit entry points, when invoked, then both use the classified runner", () => {
  // when / then
  assert.equal(frontendPackage.scripts["audit:security"], "node ../tools/npm-audit.mjs");
  assert.match(release, /npm-cli\.js run audit:security/);
});
