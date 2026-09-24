import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const accessibility = readFileSync(join(root, "frontend/e2e/accessibility.spec.ts"), "utf8");
const concurrentSession = readFileSync(join(root, "frontend/e2e/concurrent-session.spec.ts"), "utf8");
const documentation = readFileSync(join(root, "docs/accessibility-testing.md"), "utf8");
const fixtures = readFileSync(join(root, "frontend/e2e/fixtures.ts"), "utf8");
const playwright = readFileSync(join(root, "frontend/playwright.config.ts"), "utf8");
const pom = readFileSync(join(root, "pom.xml"), "utf8");
const stability = readFileSync(join(root, ".github/workflows/test-stability.yml"), "utf8");

test("given the required accessibility gate, when inspecting its browser coverage, then axe blocks in Chromium only", () => {
  assert.match(accessibility, /wcag22aa/);
  assert.match(accessibility, /initial password change is operable using only the keyboard/);
  assert.match(accessibility, /a booking is operable using only the keyboard/);
  assert.match(playwright, /name: "chromium-accessibility"/);
  assert.match(playwright, /name: "webkit-accessibility"/);
  assert.match(playwright, /COURTSIDE_WEBKIT_AXE/);
  assert.match(stability, /COURTSIDE_WEBKIT_AXE: 'true'/);
  assert.doesNotMatch(pom, /COURTSIDE_WEBKIT_AXE/);
  // Every browser draws in the pinned image, so the build installs none of them.
  assert.doesNotMatch(pom, /playwright install/);
  assert.match(fixtures, /connect\(await journeyService\.pinnedBrowser\(browserName, info\.project\.use\.locale\)\)/);
  assert.match(fixtures, /observeBrowserDisconnect\(pinned/);
  assert.match(fixtures, /journeyService\.browserDiagnostics\(browserName, "browser-disconnected"\)/);
  assert.match(fixtures, /failureDiagnostics: \[async \(\{ pinnedBrowser, browserName, journeyService, page \}/);
  assert.match(fixtures, /if \(!pinnedBrowser\.isConnected\(\)\) return;/);
  assert.match(fixtures, /diagnoseUnexpectedBrowserTest\(\{/);
  assert.match(fixtures, /status: testInfo\.status/);
  assert.match(fixtures, /\(reason\) => journeyService\.browserDiagnostics\(browserName, reason, \{/);
  assert.match(fixtures, /title: testInfo\.title/);
  assert.match(fixtures, /errors: testInfo\.errors\.map/);
  assert.doesNotMatch(fixtures, /\.launch\(/);
  assert.doesNotMatch(concurrentSession, /async \(\{ browser[, }]/);
  assert.match(concurrentSession, /async \(\{ pinnedBrowser, journeyService \}/);
});

test("given browser gates fail, when reporting their outcome, then product and harness claims remain distinct", () => {
  assert.match(playwright, /browser-gate-reporter/);
  assert.match(playwright, /name: "webkit-core"/);
  assert.match(playwright, /name: "chromium-accessibility"/);
  assert.match(playwright, /name: "webkit-accessibility"/);
});

test("given automation cannot decide assistive-technology usability, when qualifying a release, then the manual evidence stays explicit", () => {
  assert.match(documentation, /NVDA and Firefox/);
  assert.match(documentation, /VoiceOver and Safari/);
  assert.match(documentation, /400% browser zoom/);
  assert.match(documentation, /forced colours/);
  assert.match(documentation, /reduced motion/);
});

test("given the reflow check, when it narrows the viewport, then it proves the layout actually reflowed", () => {
  // Scaling with style.zoom leaves the media queries at the wide breakpoint, so it never reflows.
  assert.doesNotMatch(accessibility, /style\.zoom/);
  assert.match(accessibility, /setViewportSize\(\{ width: 320, height: 720 \}\)/);
  assert.match(accessibility, /expect\(layout\.reflowed\)\.toBe\(true\);/);
  assert.match(accessibility, /expect\(layout\.fonts\)\.toBe\("loaded"\);/);
  assert.match(accessibility, /\}\)\.toPass\(\);/);
  assert.doesNotMatch(accessibility, /toPass\(\{/);
  assert.doesNotMatch(accessibility, /expect\.poll/);
});

test("given a class list, when it removes the outline, then the removal is found under every variant", () => {
  // when / then
  assert.equal(outlineRemovals('className="form-control rounded-lg outline-none"').length, 1);
  assert.equal(outlineRemovals("className={`form-control ${width} focus:outline-hidden`}").length, 1);
  assert.equal(outlineRemovals('className="sm:focus-visible:outline-none"').length, 1);
  assert.deepEqual(outlineRemovals('className="focus-visible:outline-2 outline-offset-2 outline-(--cs-focus)"'), []);
  assert.deepEqual(outlineRemovals('const noneLeft = "outline-none-ish";'), []);
});

test("given the frontend sources, when a control styles its focus, then no class removes the outline", () => {
  // given
  const sources = sourceFiles(join(root, "frontend/src")).filter((path) => /\.(?:ts|tsx|css)$/.test(path));

  // when
  const violations = sources.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return outlineRemovals(source).map((offset) =>
      `${path.slice(root.length + 1)}:${source.slice(0, offset).split("\n").length}`);
  });

  // then
  assert.deepEqual(violations, [], "a component class sits below the utilities, so outline-none defeats its focus outline");
});

function outlineRemovals(source) {
  return [...source.matchAll(/(?<![\w-])(?:[\w-]+:)*outline-(?:none|hidden)(?![\w-])/g)].map((match) => match.index);
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? sourceFiles(join(directory, entry.name))
    : [join(directory, entry.name)]);
}
