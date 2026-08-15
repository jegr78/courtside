import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const build = readFileSync(join(repository, ".github/workflows/build.yml"), "utf8");
const release = readFileSync(join(repository, ".github/workflows/release.yml"), "utf8");
const policy = readFileSync(join(repository, "docs/security-scanning.md"), "utf8");

test("given a pull request, when the required build runs, then dependency, source and built Java surfaces are scanned", () => {
  // when / then
  assert.match(build, /actions\/dependency-review-action@[a-f0-9]{40}/);
  assert.match(build, /github\/codeql-action\/init@[a-f0-9]{40}/);
  assert.match(build, /queries: security-extended/);
  assert.match(build, /extract --layers --launcher --destination build\/security\/runtime/);
  assert.match(build, /aquasecurity\/trivy-action@[a-f0-9]{40}/);
  assert.match(build, /scan-type: rootfs/);
  assert.match(build, /scanners: vuln/);
  assert.match(build, /scanners: secret,misconfig/);
  assert.match(build, /--trivy build\/security\/trivy-runtime\.json[\s\S]*--trivy build\/security\/trivy-source\.json/);
  assert.match(build, /node tools\/security-findings\.mjs/);
});

test("given security evidence, when workflows retain it, then only normalized reports become artifacts", () => {
  // when / then
  assert.match(build, /build\/security\/summary\.json/);
  assert.doesNotMatch(build, /path: build\/security\s*$/m);
  assert.match(build, /rm -rf build\/security\/trivy-runtime\.json build\/security\/trivy-source\.json build\/security\/codeql/);
  assert.match(release, /build\/uat-smoke\/security-summary-/);
  assert.match(release, /rm -f build\/uat-smoke\/trivy-/);
});

test("given a scanner finding, when it is triaged, then exceptions are precise, expiring and single-maintainer compatible", () => {
  // when / then
  assert.match(policy, /High and Critical/);
  assert.match(policy, /scanner, finding id and target/);
  assert.match(policy, /expiry/);
  assert.match(policy, /independentReview.*false/);
  assert.match(policy, /scanner outage/i);
  assert.match(release, /node tools\/security-findings\.mjs/);
});
