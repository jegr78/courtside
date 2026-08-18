import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const visual = readFileSync(new URL("../frontend/e2e/visual-regression.spec.ts", import.meta.url), "utf8");
const playwright = readFileSync(new URL("../frontend/playwright.config.ts", import.meta.url), "utf8");
const eslint = readFileSync(new URL("../frontend/eslint.config.js", import.meta.url), "utf8");
const setup = readFileSync(new URL("../frontend/e2e/global-setup.ts", import.meta.url), "utf8");
const snapshots = new URL("../frontend/e2e/visual-regression.spec.ts-snapshots/", import.meta.url);

test("given stable product views, when qualifying the UI, then reviewed pixel baselines cover every principal surface", () => {
  for (const surface of [
    "court-plan", "booking-dialog", "booking-validation", "personal-bookings",
    "series-preview", "admin-configuration", "admin-facility"
  ]) {
    assert.match(visual, new RegExp(`\\"${surface}\\.png\\"`));
  }
  assert.equal(existsSync(snapshots), true);
  const reviewed = readdirSync(snapshots).filter((file) => file.endsWith(".png"));
  assert.equal(reviewed.length, 7);
  assert.deepEqual(reviewed.filter((file) => /-(darwin|linux)\.png$/.test(file)), []);
});

test("given visual baselines, when running them on different hosts, then their path and rendering controls stay deterministic", () => {
  assert.doesNotMatch(playwright, /snapshotPathTemplate:.*\{platform\}/);
  assert.match(visual, /journeyService\.pinnedBrowser\(\)/);
  assert.match(setup, /mcr\.microsoft\.com\/playwright:[^"]*@sha256:/);
  assert.match(visual, /timezoneId: "Europe\/Berlin"/);
  assert.doesNotMatch(visual, /expect\(page\)\.toHaveScreenshot/);
  assert.doesNotMatch(visual, /stableScreenshot\(page,/);
  assert.match(playwright, /updateSnapshots: "missing"/);
  assert.doesNotMatch(visual, /fullPage/);
  assert.match(visual, /animations: "disabled"/);
  assert.match(visual, /caret: "hide"/);
  assert.match(visual, /document\.fonts\.ready/);
  assert.match(visual, /mask:/);
});

test("given retained browser diagnostics, when linting after a failed run, then generated trace sources are excluded", () => {
  assert.match(eslint, /"test-results"/);
});
