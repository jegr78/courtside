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
  assert.match(scheduled, /security-image-inventory\.mjs safe \| xargs -n1 docker pull/);
  assert.match(scheduled, /security-assessment-gate\.mjs/);
  assert.match(scheduled, /--subject "\$IMAGE_DIGEST"/);
  assert.match(scheduled, /security-cleanup "\$RUN_ID"/);
  assert.match(scheduled, /retention-days: 14/);
  assert.match(build, /security-update-report\.mjs[\s\S]+github\.event\.pull_request\.base\.sha/);
});

test("given changed assessment bytes, when the required build runs, then paired immutable evidence is compared", () => {
  // when / then
  assert.match(build, /tool-update-comparison:/);
  assert.doesNotMatch(build, /git cat-file -e "\$BASE_REF:tools\/security-tool-comparison\.mjs"/);
  assert.match(build, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(build, /git worktree add --detach/);
  assert.match(build, /courtside-security-base\/mvnw" -B[\s\S]+courtside-security-base\/pom\.xml" frontend:install-node-and-npm/);
  assert.match(build, /working-directory: \$\{\{ runner\.temp \}\}\/courtside-security-base\/frontend/);
  assert.match(build, /npm-cli\.js ci --ignore-scripts/);
  assert.doesNotMatch(build, /courtside-security-base\/frontend\/node_modules/);
  assert.match(build, /security-run "\$BASE_RUN_ID" active/);
  assert.match(build, /security-run "\$CANDIDATE_RUN_ID" active/);
  assert.match(build, /security-image-inventory\.mjs active \| xargs -n1 docker pull/);
  assert.match(build, /security-tool-comparison\.mjs/);
  assert.match(build, /COMPARATOR_ROOT="\$BASE_ROOT"/);
  assert.match(build, /--base-contract "\$BASE_ROOT\/security\/run-contract\.json"/);
  assert.match(build, /--candidate-contract security\/run-contract\.json/);
  assert.match(build, /security-cleanup "\$BASE_RUN_ID"[\s\S]+\) \|\| BASE_CLEANUP=\$\?/);
  assert.match(build, /security-cleanup "\$CANDIDATE_RUN_ID" \|\| CANDIDATE_CLEANUP=\$\?/);
  assert.match(build, /needs: \[quality, tool-update-comparison\]/);
  assert.match(build, /candidate-ref "\$HEAD_REF"/);
});

// A finding difference is only attributable to the tools while the application is the constant, so
// both runs assess the base revision's image. The base environment can always start it, which is
// what a candidate image took away: a setting the pull request makes mandatory stopped it dead.
test("given a paired comparison, when both sides run, then they assess the base revision's target", () => {
  // given
  const comparison = build.slice(build.indexOf("  tool-update-comparison:"), build.indexOf("  quality:"));

  // when / then
  assert.match(comparison, /BASE_IMAGE=\$\(docker image inspect courtside:uat-local/);
  assert.match(comparison, /security "\$BASE_RUN_ID" "\$BASE_IMAGE"/);
  assert.match(comparison, /security "\$CANDIDATE_RUN_ID" "\$BASE_IMAGE"/);
  assert.equal(comparison.match(/--qualification "\$BASE_ROOT\/build\/uat-smoke/g)?.length, 2);
  assert.doesNotMatch(comparison, /cp deploy\/compose\.security\.yaml/,
    "the base run reads its own compose file. It declares the mounts that supply the assessment "
    + "code and the bounds the scanners keep, so a copy from the candidate hands a pull request "
    + "the run that exists to be independent of it.");
});

// The base worktree comes out of the workspace's own .git, so anything the candidate has already
// run could have left something behind for its checkout to pick up.
test("given a protected base, when it is prepared, then no candidate code has run yet", () => {
  // given
  const comparison = build.slice(build.indexOf("  tool-update-comparison:"), build.indexOf("  quality:"));

  // when
  const prepared = comparison.indexOf("Prepare the protected-base assessment runtime");
  const candidateRan = comparison.indexOf("Install candidate assessment dependencies");

  // then
  assert.ok(prepared > 0 && candidateRan > prepared,
    "npm ci runs the candidate's lifecycle scripts and mvnw runs its wrapper. Both come after the "
    + "base worktree exists and after the image both runs assess has been built from it.");
});

// The report already decides this from the digest of what a paired run varies. A second path list in
// the workflow is a second definition, and the one that stood here started two stacks for a compose
// line and for every dependency bump.
test("given one definition of the assessment runtime, when the job decides whether to run, then it asks for that decision", () => {
  // given
  const comparison = build.slice(build.indexOf("  tool-update-comparison:"), build.indexOf("  quality:"));

  // when / then
  assert.match(comparison, /--identity-output build\/security-update\/identity\.json/);
  assert.match(comparison, /comparisonRequired/);
  assert.match(comparison, /case "\$REQUIRED" in[\s\S]*?true\|false\)[\s\S]*?exit 1/,
    "a value that is neither skips every later step while the job still reports success");
  assert.doesNotMatch(comparison, /git diff --quiet/,
    "the decision belongs to runtimeComparisonRequired in security-update-report.mjs, which the "
    + "report already prints. Deriving it a second time here lets the two drift apart.");
});

// Ninety minutes of paired assessment used to end in an artifact nobody had to open: no step read
// newFindings, and the job blocked a merge on whether the comparison could be produced at all.
test("given a produced comparison, when the job ends, then its difference is read and has to be acknowledged", () => {
  // given
  const comparison = build.slice(build.indexOf("  tool-update-comparison:"), build.indexOf("  quality:"));

  // when / then
  assert.match(comparison, /security-tool-acknowledgement\.mjs/);
  assert.match(comparison, /--acknowledgement security\/tool-update-acknowledgement\.json/);
  assert.match(comparison, /GITHUB_STEP_SUMMARY/,
    "the difference belongs where a reviewer already looks, not in an artifact they have to fetch");
});

// The runner's own node is older than courtside.mjs requires, and the failure surfaces minutes
// into a job as a comparison that never ran rather than as a missing tool.
test("given a workflow step reaching the CLI, when it runs node, then it is the version the build pins", () => {
  // when
  const unpinned = build.split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => /(?:^|[|(\s])node\s+(?:"?\$\w+"?\/)?tools\/courtside(?:\.|-)/.test(line)
      && !/frontend\/node\/node/.test(line));

  // then
  assert.deepEqual(unpinned.map(({ number, line }) => `${number}: ${line}`), [],
    "courtside.mjs refuses a node older than 24 and the runner ships one. Every step that "
    + "reaches it — directly or through a script that spawns it — uses frontend/node/node, "
    + "which the maven build downloads at the version pom.xml pins.");
});

// Packaging is packaging. Whoever needs the artefact — the uat smoke, a security run, a release —
// gets it without the frontend suite running again, and the suite still runs where it belongs.
test("given a job that only needs the artefact, when it builds one, then the suite does not run again", () => {
  // given
  const pom = readFileSync(join(repository, "pom.xml"), "utf8");
  const comparison = build.slice(build.indexOf("  tool-update-comparison:"), build.indexOf("  quality:"));

  // when / then
  assert.match(pom, /<id>npm-test<\/id>[\s\S]*?<skip>\$\{skipTests}<\/skip>/,
    "mvn package -DskipTests skips surefire and nothing else unless npm-test is told to, so every "
    + "tool that packages the application drags the whole frontend suite along with it");
  assert.doesNotMatch(comparison, /mvnw -B verify/,
    "quality already runs the full suite on the same commit in the same workflow. A second run "
    + "buys nothing and gives every flake a second chance to fail a job about tool comparison.");
  assert.match(comparison, /mvnw -B frontend:install-node-and-npm frontend:npm@npm-ci/,
    "the CLI these steps launch requires ajv and js-yaml at module load, out of the frontend's "
    + "node_modules, so the job installs the pinned node and those modules before it runs one — "
    + "dropping either turns the step into an import error seconds in");
});

test("given a release candidate, when publishing it, then its exact digest passes the active gate first", () => {
  // when / then
  assert.match(release, /\n  active-security:\n    needs: \[image, qualify\]/);
  assert.match(release, /security-run "\$RUN_ID" active/);
  assert.match(release, /security-image-inventory\.mjs active \| xargs -n1 docker pull/);
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
