import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = readFileSync(new URL("../frontend/e2e/fixtures.ts", import.meta.url), "utf8");
const playwright = readFileSync(join(repository, "frontend/playwright.config.ts"), "utf8");
const pom = readFileSync(join(repository, "pom.xml"), "utf8");
const stability = readFileSync(join(repository, ".github/workflows/test-stability.yml"), "utf8");
const pwa = readFileSync(join(repository, "frontend/e2e/pwa-lifecycle.spec.ts"), "utf8");
const documentation = readFileSync(join(repository, "docs/browser-pwa-testing.md"), "utf8");

test("given supported desktop browsers, when qualifying a pull request, then Chromium and WebKit run core smoke journeys", () => {
  assert.match(playwright, /name: "chromium"/);
  assert.match(playwright, /name: "webkit-core"/);
  assert.match(playwright, /supported-browser\\\.spec\\\.ts/);
  assert.match(pom, /playwright install chromium/);
  assert.match(fixtures, /"webkit-core"/);
});

test("given periodic browser qualification, when the stability workflow runs, then Firefox and mobile devices produce evidence", () => {
  assert.match(stability, /playwright install --with-deps chromium webkit firefox/);
  assert.match(stability, /--project=firefox-periodic/);
  assert.match(stability, /--project=iphone-periodic/);
  assert.match(stability, /--project=android-periodic/);
  assert.match(stability, /--reporter=line,json/);
  assert.match(stability, /test-results\/browser-compatibility\.json/);
});

test("given the installed PWA, when its lifecycle is qualified, then shell availability and API cache privacy are asserted", () => {
  assert.match(pwa, /serviceWorker\.ready/);
  assert.match(pwa, /context\.setOffline\(true\)/);
  assert.match(pwa, /caches\.keys/);
  assert.match(pwa, /\/api\//);
});

test("given a release on physical devices, when recording evidence, then both mobile platforms and immutable candidate identity are required", () => {
  assert.match(documentation, /iOS\/Safari/);
  assert.match(documentation, /Android\/Chrome/);
  assert.match(documentation, /candidate commit, image digest/);
  assert.match(documentation, /link it from the release checklist/);
});
