import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const accessibility = readFileSync(join(root, "frontend/e2e/accessibility.spec.ts"), "utf8");
const documentation = readFileSync(join(root, "docs/accessibility-testing.md"), "utf8");
const fixtures = readFileSync(join(root, "frontend/e2e/fixtures.ts"), "utf8");
const playwright = readFileSync(join(root, "frontend/playwright.config.ts"), "utf8");
const pom = readFileSync(join(root, "pom.xml"), "utf8");

test("given the required accessibility gate, when inspecting its browser coverage, then axe runs in Chromium and WebKit", () => {
  assert.match(accessibility, /wcag22aa/);
  assert.match(accessibility, /initial password change is operable using only the keyboard/);
  assert.match(accessibility, /a booking is operable using only the keyboard/);
  assert.match(playwright, /name: "webkit-accessibility"/);
  assert.match(playwright, /testMatch: \/accessibility\\\.spec/);
  // Every browser draws in the pinned image, so the build installs none of them.
  assert.doesNotMatch(pom, /playwright install/);
  assert.match(fixtures, /connect\(await journeyService\.pinnedBrowser\(browserName\)\)/);
  assert.match(fixtures, /observeBrowserDisconnect\(pinned/);
  assert.match(fixtures, /journeyService\.browserDiagnostics\(browserName, "browser-disconnected"\)/);
  assert.doesNotMatch(fixtures, /\.launch\(/);
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
