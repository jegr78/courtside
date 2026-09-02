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
    "Impact", "Likelihood", "Invariant", "Positive boundaries", "Negative boundaries", "Level", "Frequency",
    "Environment", "Synthetic data", "Evidence", "Owner", "Residual risk"
  ]) {
    assert.match(strategy, new RegExp(`\\| ${field} `));
  }
  assert.equal(strategy.match(/\| Positive boundaries \| Negative boundaries \|/g)?.length, 6);
});

test("given a pull request, when declaring quality evidence, then the maintained strategy is the source", () => {
  // when / then
  assert.equal(pullRequestTemplate.includes(
    "https://github.com/jegr78/courtside/blob/main/docs/quality-strategy.md"), true);
  assert.match(pullRequestTemplate, /Affected risk IDs/);
  assert.match(pullRequestTemplate, /Evidence/);
  assert.match(pullRequestTemplate, /Residual risk/);
});

test("given tracked residual test risks, when reading the strategy, then their existing issues remain authoritative", () => {
  // when / then
  for (const issue of [45]) {
    assert.match(strategy, new RegExp(`github\\.com/jegr78/courtside/issues/${issue}`));
  }
});

test("given a reduced GitHub entry, when reading the strategy, then it names who runs the validator", () => {
  // when / then
  assert.match(strategy, /the documentation job runs their validators itself/i);
  assert.match(strategy, /a job of its own profiles\s+actually\s+executes/i);
  assert.match(strategy, /derived from what those jobs run rather than from which profile happens to own/i);
});

test("given no admission step, when reading the strategy, then failing closed and the rollback are explicit", () => {
  // when / then
  assert.match(strategy, /no separate admission step/i);
  assert.match(strategy, /everything unrecognised fails closed/i);
  assert.match(strategy, /`COURTSIDE_TEST_PROFILES` forces the complete job set/i);
  assert.match(strategy, /a typo escalates rather than silently\s+reducing/i);
  assert.match(strategy, /is the immediate rollback/i);
});
