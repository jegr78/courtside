import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const strategy = readFileSync(new URL("../docs/quality-strategy.md", import.meta.url), "utf8");
const pullRequestTemplate = readFileSync(new URL("../.github/pull_request_template.md", import.meta.url), "utf8");

test("given the quality strategy, when reviewing product risks, then every maintained risk area is present", () => {
  // when / then
  for (const area of [
    "Identity and security",
    "Booking",
    "Membership and synchronization",
    "Administration",
    "PWA and UI",
    "Operations and release"
  ]) {
    assert.match(strategy, new RegExp(`### ${area}`));
  }
  for (const field of [
    "Impact", "Likelihood", "Invariant", "Boundaries", "Level", "Frequency",
    "Environment", "Synthetic data", "Evidence", "Owner", "Residual risk"
  ]) {
    assert.match(strategy, new RegExp(`\\| ${field} `));
  }
});

test("given a pull request, when declaring quality evidence, then the maintained strategy is the source", () => {
  // when / then
  assert.match(pullRequestTemplate, /docs\/quality-strategy\.md/);
  assert.match(pullRequestTemplate, /Affected risk IDs/);
  assert.match(pullRequestTemplate, /Evidence/);
  assert.match(pullRequestTemplate, /Residual risk/);
});

test("given known residual test risks, when reading the strategy, then their existing issues remain authoritative", () => {
  // when / then
  for (const issue of [33, 35, 45]) {
    assert.match(strategy, new RegExp(`github\\.com/jegr78/courtside/issues/${issue}`));
  }
});
