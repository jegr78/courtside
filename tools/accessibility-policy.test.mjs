import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const accessibility = readFileSync("e2e/accessibility.spec.ts", "utf8");
const documentation = readFileSync("../docs/accessibility-testing.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const playwright = readFileSync("playwright.config.ts", "utf8");
const pom = readFileSync("../pom.xml", "utf8");

test("given the required accessibility gate, when inspecting its browser coverage, then axe runs in Chromium and WebKit", () => {
  assert.equal(packageJson.devDependencies["@axe-core/playwright"], "4.10.2");
  assert.match(accessibility, /wcag22aa/);
  assert.match(playwright, /name: "webkit-accessibility"/);
  assert.match(playwright, /testMatch: \/accessibility\\\.spec/);
  assert.match(pom, /playwright install chromium webkit/);
});

test("given automation cannot decide assistive-technology usability, when qualifying a release, then the manual evidence stays explicit", () => {
  assert.match(documentation, /NVDA and Firefox/);
  assert.match(documentation, /VoiceOver and Safari/);
  assert.match(documentation, /400% browser zoom/);
  assert.match(documentation, /forced colours/);
  assert.match(documentation, /reduced motion/);
});
