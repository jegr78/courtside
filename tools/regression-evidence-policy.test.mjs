import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const visual = readFileSync(new URL("../frontend/e2e/visual-regression.spec.ts", import.meta.url), "utf8");
const playwright = readFileSync(new URL("../frontend/playwright.config.ts", import.meta.url), "utf8");
const eslint = readFileSync(new URL("../frontend/eslint.config.js", import.meta.url), "utf8");
const snapshots = new URL("../frontend/e2e/visual-regression.spec.ts-snapshots/", import.meta.url);

test("given stable product views, when qualifying the UI, then reviewed pixel baselines cover every principal surface", () => {
  for (const surface of [
    "court-plan", "booking-dialog", "booking-validation", "personal-bookings",
    "series-preview", "admin-configuration", "admin-facility"
  ]) {
    assert.match(visual, new RegExp(`\\"${surface}\\.png\\"`));
  }
  assert.equal(existsSync(snapshots), true);
  assert.equal(readdirSync(snapshots).filter((file) => file.endsWith(".png")).length, 7);
});

test("given visual baselines, when running them on different hosts, then their path and rendering controls stay deterministic", () => {
  assert.match(playwright, /snapshotPathTemplate/);
  assert.match(visual, /animations: "disabled"/);
  assert.match(visual, /caret: "hide"/);
  assert.match(visual, /document\.fonts\.ready/);
  assert.match(visual, /mask:/);
});

test("given retained browser diagnostics, when linting after a failed run, then generated trace sources are excluded", () => {
  assert.match(eslint, /"test-results"/);
});
