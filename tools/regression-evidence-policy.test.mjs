import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const visual = readFileSync(new URL("../frontend/e2e/visual-regression.spec.ts", import.meta.url), "utf8");
const fixtures = readFileSync(new URL("../frontend/e2e/fixtures.ts", import.meta.url), "utf8");
const playwright = readFileSync(new URL("../frontend/playwright.config.ts", import.meta.url), "utf8");
const eslint = readFileSync(new URL("../frontend/eslint.config.js", import.meta.url), "utf8");
const setup = readFileSync(new URL("../frontend/e2e/global-setup.ts", import.meta.url), "utf8");
const snapshots = new URL("../frontend/e2e/visual-regression.spec.ts-snapshots/", import.meta.url);

// The capture names come from the spec that takes them, so a surface added there needs no second list here.
function capturedBaselines(spec) {
  const single = [...spec.matchAll(/"([a-z0-9-]+\.png)"/g)].map(([, name]) => name);
  const themed = [...spec.matchAll(/baseline\("([a-z0-9-]+)"\)/g)].flatMap(([, surface]) => [`${surface}.png`, `${surface}-light.png`]);
  return [...new Set([...single, ...themed])].sort();
}

test("given stable product views, when qualifying the UI, then reviewed pixel baselines cover every principal surface", () => {
  // given
  assert.match(visual, /const baseline = \(surface: string\) => theme === "dark" \? `\$\{surface\}\.png` : `\$\{surface\}-light\.png`;/,
    "a themed capture still names its dark baseline after the surface and its light one with -light");
  for (const surface of ["court-plan", "booking-dialog", "admin-navigation", "admin-overview", "phone-court-plan"]) {
    assert.match(visual, new RegExp(`(?:"${surface}\\.png"|baseline\\("${surface}"\\))`), `${surface} is still captured`);
  }
  assert.equal(existsSync(snapshots), true);

  // when
  const captured = capturedBaselines(visual);
  const reviewed = readdirSync(snapshots).filter((file) => file.endsWith(".png")).sort();

  // then
  assert.deepEqual(captured.filter((name) => !reviewed.includes(name)), [], "every captured surface has a reviewed baseline");
  assert.deepEqual(reviewed.filter((name) => !captured.includes(name)), [], "no baseline is left without the capture that drew it");
  assert.deepEqual(reviewed.filter((file) => /-(darwin|linux)\.png$/.test(file)), []);
});

test("given visual baselines, when running them on different hosts, then their path and rendering controls stay deterministic", () => {
  assert.doesNotMatch(playwright, /snapshotPathTemplate:.*\{platform\}/);
  assert.match(fixtures, /journeyService\.pinnedBrowser\(browserName, info\.project\.use\.locale\)/);
  assert.match(setup, /\.withEnvironment\(language\.environment\)/);
  // A capture shows the club whose language it is published in, and the world for that club is
  // taken once at startup rather than translated in front of the camera.
  assert.match(fixtures, /journeyService\.reset\(start, clubLanguage\(info\.project\.use\.locale\)\)/);
  assert.match(playwright, /name: "visual"/);
  assert.match(setup, /mcr\.microsoft\.com\/playwright:[^"]*@sha256:/);
  // Browsers reach the application through the same reverse proxy a club runs, read from the
  // deployment so that a literal here could not name a build the club does not run.
  assert.match(setup, /new GenericContainer\(deployedProxyImage\(\)\)/);
  assert.doesNotMatch(setup, /caddy(?::[\w.-]+)?@sha256:[a-f0-9]{64}/);
  assert.match(setup, /playwright\/cli\.js launch-server/);
  assert.match(setup, /withCopyDirectoriesToContainer/);
  assert.doesNotMatch(setup, /\bnpx playwright\b/);
  assert.doesNotMatch(setup, /--unsafe/);
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
