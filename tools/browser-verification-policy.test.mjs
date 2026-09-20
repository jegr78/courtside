import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const config = readFileSync(new URL("../frontend/playwright.config.ts", import.meta.url), "utf8");
const setup = readFileSync(new URL("../frontend/e2e/global-setup.ts", import.meta.url), "utf8");

test("given the regular browser gate, when projects are grouped, then visual evidence runs before functional shards", () => {
  // when / then
  assert.match(config, /browserProjectGroup\(orderedProjects, process\.env\.COURTSIDE_BROWSER_GROUP\)/);
  assert.ok(config.indexOf("name: \"visual\"") < config.indexOf("name: \"chromium\""));
});

test("given a successful browser run, when the application writes logs, then they stay buffered unless requested", () => {
  // when / then
  assert.match(setup,
    /applicationLog\.append\(chunk\);[\s\S]+COURTSIDE_VERBOSE_TEST_LOGS === "true"[\s\S]+process\.stdout\.write\(chunk\)/);
});
