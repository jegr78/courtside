import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const setup = readFileSync(new URL("../frontend/e2e/global-setup.ts", import.meta.url), "utf8");
const fixtures = readFileSync(new URL("../frontend/e2e/fixtures.ts", import.meta.url), "utf8");
const playwright = readFileSync(new URL("../frontend/playwright.config.ts", import.meta.url), "utf8");

test("given several browser projects, when Playwright runs them, then one global journey world serves every worker", () => {
  assert.match(setup, /const service = await startJourneyService\(\)/);
  assert.match(setup, /await service\.pinnedBrowser\(browserName\)/);
  assert.match(setup, /process\.env\.COURTSIDE_JOURNEY_CONTROL/);
  assert.doesNotMatch(fixtures, /startJourneyService/);
  assert.doesNotMatch(fixtures, /service\.stop/);
  assert.match(playwright, /workers: 1/);
  assert.match(playwright, /timeout: 60_000/);
  assert.match(playwright, /Unsupported browser project order/);
});

test("given a mutable PWA asset and database, when the next test starts, then both return to their baseline", () => {
  assert.match(setup, /resetStaticAssets\(\)/);
  assert.match(setup, /resetJourneyData\(postgres!, tables\)/);
});
