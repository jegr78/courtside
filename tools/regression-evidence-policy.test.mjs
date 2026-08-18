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
  // A missing baseline is Playwright's to report, and it does so by failing the run that would
  // have compared it; what cannot report itself is a file kept for a host that gates nothing.
  assert.equal(existsSync(snapshots), true);
  const reviewed = readdirSync(snapshots).filter((file) => file.endsWith(".png"));
  assert.deepEqual(reviewed.filter((file) => /-(darwin|linux)\.png$/.test(file)), []);
});

test("given visual baselines, when running them on different hosts, then their path and rendering controls stay deterministic", () => {
  assert.doesNotMatch(playwright, /snapshotPathTemplate:.*\{platform\}/);
  assert.match(visual, /test\.skip\(process\.platform !== "linux"/);
  assert.doesNotMatch(visual, /toHaveScreenshot\(page,/);
  assert.doesNotMatch(visual, /fullPage/);
  assert.match(visual, /animations: "disabled"/);
  assert.match(visual, /caret: "hide"/);
  assert.match(visual, /document\.fonts\.ready/);
  assert.match(visual, /mask:/);
});

test("given retained browser diagnostics, when linting after a failed run, then generated trace sources are excluded", () => {
  assert.match(eslint, /"test-results"/);
});
