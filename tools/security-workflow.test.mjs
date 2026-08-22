import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const build = readFileSync(join(repository, ".github/workflows/build.yml"), "utf8");
const codeql = readFileSync(join(repository, ".github/codeql/codeql-config.yml"), "utf8");
const release = readFileSync(join(repository, ".github/workflows/release.yml"), "utf8");
const scheduled = readFileSync(join(repository, ".github/workflows/security-assessment.yml"), "utf8");
const policy = readFileSync(join(repository, "docs/security-scanning.md"), "utf8");
const assessment = readFileSync(join(repository, "docs/security-assessment.md"), "utf8");

test("given a pull request, when the required build runs, then dependency, source and built Java surfaces are scanned", () => {
  // when / then
  assert.match(build, /actions\/dependency-review-action@[a-f0-9]{40}/);
  assert.match(build, /github\/codeql-action\/init@[a-f0-9]{40}/);
  assert.match(build, /queries: security-extended/);
  assert.match(build, /config-file: \.\/\.github\/codeql\/codeql-config\.yml/);
  assert.match(codeql, /frontend\/coverage\/\*\*\/\*/);
  assert.match(build, /extract --layers --launcher --destination build\/security\/runtime/);
  assert.match(build, /aquasecurity\/trivy-action@[a-f0-9]{40}/);
  assert.match(build, /scan-type: rootfs/);
  assert.match(build, /scanners: vuln/);
  assert.match(build, /scanners: secret,misconfig/);
  assert.match(build, /--trivy build\/security\/trivy-runtime\.json[\s\S]*--trivy build\/security\/trivy-source\.json/);
  assert.match(build, /node tools\/security-findings\.mjs/);
  assert.match(build, /--assessment-policy not-applicable/);
  assert.match(build, /--scope required-build/);
});

test("given stable assessment suites, when scheduling them, then safe traffic is bounded and evidence fails closed", () => {
  // when / then
  assert.match(scheduled, /schedule:[\s\S]+cron:/);
  assert.match(scheduled, /timeout-minutes: 45/);
  assert.match(scheduled, /security-run "\$RUN_ID" safe/);
  assert.match(scheduled, /security-assessment-gate\.mjs/);
  assert.match(scheduled, /--subject "\$IMAGE_DIGEST"/);
  assert.match(scheduled, /security-cleanup "\$RUN_ID"/);
  assert.match(scheduled, /retention-days: 14/);
  assert.match(build, /security-update-report\.mjs[\s\S]+github\.event\.pull_request\.base\.sha/);
});

test("given changed assessment bytes, when the required build runs, then paired immutable evidence is compared", () => {
  // when / then
  assert.match(build, /tool-update-comparison:/);
  assert.match(build, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(build, /git worktree add --detach/);
  assert.match(build, /courtside-security-base\/mvnw" -B[\s\S]+courtside-security-base\/pom\.xml" frontend:install-node-and-npm/);
  assert.match(build, /working-directory: \$\{\{ runner\.temp \}\}\/courtside-security-base\/frontend/);
  assert.match(build, /npm-cli\.js ci --ignore-scripts/);
  assert.doesNotMatch(build, /courtside-security-base\/frontend\/node_modules/);
  assert.match(build, /security-run "\$BASE_RUN_ID" active/);
  assert.match(build, /security-run "\$CANDIDATE_RUN_ID" active/);
  assert.match(build, /security-tool-comparison\.mjs/);
  assert.match(build, /COMPARATOR_ROOT="\$BASE_ROOT"/);
  assert.match(build, /--base-contract "\$BASE_ROOT\/security\/run-contract\.json"/);
  assert.match(build, /--candidate-contract security\/run-contract\.json/);
  assert.match(build, /security-cleanup "\$BASE_RUN_ID" \|\| BASE_CLEANUP=\$\?/);
  assert.match(build, /security-cleanup "\$CANDIDATE_RUN_ID" \|\| CANDIDATE_CLEANUP=\$\?/);
  assert.match(build, /needs: \[quality, tool-update-comparison\]/);
  assert.match(build, /candidate-ref "\$HEAD_REF"/);
});

test("given a release candidate, when publishing it, then its exact digest passes the active gate first", () => {
  // when / then
  assert.match(release, /\n  active-security:\n    needs: \[image, qualify\]/);
  assert.match(release, /security-run "\$RUN_ID" active/);
  assert.match(release, /--authorize "authorize-active-\$RUN_ID"/);
  assert.match(release, /--subject "\$\{IMAGE##\*@\}"/);
  assert.match(release, /--assessment-gate build\/security-input\/active-security-summary\.json/);
  assert.match(release, /security-record:\n    needs: \[build, image, qualify, active-security\]/);
});

test("given destructive assessment capability, when exposing it manually, then only the local CLI and exact confirmation can execute it", () => {
  // when / then
  assert.equal(existsSync(join(repository, ".github/workflows/security-destructive.yml")), false);
  assert.match(assessment, /Destructive assessments use the local CLI only/);
  assert.match(assessment, /authorize-destructive-<run-id>/);
});

test("given security evidence, when workflows retain it, then only normalized reports become artifacts", () => {
  // when / then
  assert.match(scheduled, /umask 077/);
  assert.match(release, /umask 077/);
  assert.match(build, /build\/security\/summary\.json/);
  assert.doesNotMatch(build, /path: build\/security\s*$/m);
  assert.match(build, /rm -rf build\/security\/trivy-runtime\.json build\/security\/trivy-source\.json build\/security\/codeql/);
  assert.match(release, /build\/uat-smoke\/security-summary-/);
  assert.match(release, /rm -f build\/uat-smoke\/trivy-/);
  assert.match(release, /npm-cli\.js --prefix frontend audit --json/);
  assert.match(release, /release-security-record/);
  assert.match(release, /--summary build\/security-input\/release-build\.json/);
  assert.match(release, /--assessment-policy not-applicable/g);
  assert.match(release, /--trivy build\/security\/trivy-source\.json/);
  assert.match(release, /--codeql build\/security\/codeql/);
  assert.match(release, /--npm-version/);
  assert.match(release, /--trivy-version[\s\S]+trivy --version/);
  assert.match(release, /node tools\/security-supply-chain\.mjs/);
  assert.match(release, /cosign verify[\s\S]+gh attestation verify[\s\S]+security-supply-chain\.mjs/);
});

test("given a scanner finding, when it is triaged, then exceptions are precise, expiring and single-maintainer compatible", () => {
  // when / then
  assert.match(policy, /High and Critical/);
  assert.match(policy, /scanner, finding id and target/);
  assert.match(policy, /expiry/);
  assert.match(policy, /independentReview.*false/);
  assert.match(policy, /scanner outage/i);
  assert.match(release, /node tools\/security-findings\.mjs/);
  assert.match(policy, /scan scope/);
});
