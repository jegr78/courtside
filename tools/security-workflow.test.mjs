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
const runContract = JSON.parse(readFileSync(join(repository, "security/run-contract.json"), "utf8"));

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
  assert.match(scheduled, /timeout-minutes:[^\n]+45/);
  assert.match(scheduled, /security-run "\$RUN_ID" safe/);
  assert.match(scheduled, /github\.event_name == 'schedule' && 'safe' \|\| inputs\.profile/);
  assert.match(scheduled,
    /set -o pipefail\n\s+frontend\/node\/node tools\/security-image-inventory\.mjs "\$PROFILE" \| xargs -n1 docker pull/);
  assert.match(scheduled, /security-assessment-gate\.mjs/);
  assert.match(scheduled, /--subject "\$IMAGE_DIGEST"/);
  assert.match(scheduled, /security-cleanup "\$RUN_ID"/);
  assert.match(scheduled, /retention-days: 14/);
  assert.match(build, /security-update-report\.mjs[\s\S]+github\.event\.pull_request\.base\.sha/);
});

test("given a manual baseline run, when selecting active, then the isolated workflow executes the complete active profile", () => {
  // when / then
  assert.match(scheduled, /workflow_dispatch:[\s\S]+profile:[\s\S]+options:[\s\S]+- safe[\s\S]+- active/);
  assert.match(scheduled, /github\.event_name == 'schedule' && 'safe' \|\| inputs\.profile/);
  assert.match(scheduled,
    /set -o pipefail\n\s+frontend\/node\/node tools\/security-image-inventory\.mjs "\$PROFILE" \| xargs -n1 docker pull/);
  assert.match(scheduled, /if \[\[ "\$PROFILE" = active \]\]; then[\s\S]+security-run "\$RUN_ID" active[\s\S]+--authorize "authorize-active-\$RUN_ID"/);
  assert.match(scheduled, /--profile "\$PROFILE"/);
});

test("given protected active evidence, when the hosted run finishes, then only its encrypted envelope is uploaded", () => {
  // given
  const workflowPermissions = scheduled.match(/^permissions:\n(?<block>(?:  [^\n]+\n)+)/m)?.groups.block ?? "";

  // when / then
  assert.equal(existsSync(join(repository, ".github/security-evidence-recipient.pem")), true);
  assert.equal(existsSync(join(repository, ".github/security-evidence-key.json")), true);
  assert.match(scheduled, /EXPECTED_FINGERPRINT=.*security-evidence-key\.json/);
  assert.match(scheduled, /canaryVerifiedOn <= \$today and \$today <= \.canaryValidThrough/);
  assert.match(scheduled, /set -o pipefail[\s\S]+tar -czf - -C[\s\S]+assessment\/attempt-1" evidence[\s\S]+\| openssl cms -encrypt -binary -aes-256-gcm/);
  assert.match(scheduled, /openssl cms -encrypt -binary -aes-256-gcm[\s\S]+\.github\/security-evidence-recipient\.pem/);
  assert.match(scheduled, /build\/security-gate\/protected-evidence\.cms/);
  assert.doesNotMatch(scheduled, /build\/security-gate\/protected-evidence\.tar\.gz/);
  assert.doesNotMatch(scheduled, /path:[\s\S]+assessment\/attempt-1\/evidence/);
  assert.match(assessment, /security evidence private key/);
  assert.match(assessment, /openssl cms -decrypt/);
  assert.match(assessment, /gh attestation verify protected-evidence\.cms/);
  assert.match(scheduled, /actions\/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8/);
  assert.match(scheduled, /subject-path: build\/security-gate\/protected-evidence\.cms/);
  assert.match(scheduled, /outputs:\s+evidence-sealed: \$\{\{ steps\.seal\.outputs\.sealed \}\}/);
  assert.match(scheduled, /echo "sealed=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(scheduled, /attest-evidence:[\s\S]+needs: assessment[\s\S]+if: always\(\) && needs\.assessment\.outputs\.evidence-sealed == 'true'/);
  assert.match(scheduled, /attest-evidence:[\s\S]+permissions:[\s\S]+attestations: write[\s\S]+id-token: write/);
  assert.doesNotMatch(workflowPermissions, /attestations: write|id-token: write/);
});

test("given the active duration contract, when the workflow chooses its job budget, then active retains the safe cleanup reserve", () => {
  // given
  const safeMinutes = runContract.profiles.safe.durationSeconds / 60;
  const activeMinutes = runContract.profiles.active.durationSeconds / 60;
  const safeJobMinutes = 45;
  const activeJobMinutes = safeJobMinutes + activeMinutes - safeMinutes;

  // when / then
  assert.match(scheduled, new RegExp(`timeout-minutes:.*${activeJobMinutes}.*${safeJobMinutes}`));
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
  assert.match(build, /security-tool-comparison\.mjs/);
  assert.match(build, /COMPARATOR_ROOT="\$BASE_ROOT"/);
  assert.match(build, /cmp -s "\$COMPARATOR_ROOT\/tools\/security-tool-comparison\.mjs" tools\/security-tool-comparison\.mjs/);
  assert.match(build, /COMPARATOR_ROOT="\$GITHUB_WORKSPACE"/);
  assert.match(build, /--base-contract "\$BASE_ROOT\/security\/run-contract\.json"/);
  assert.match(build, /--candidate-contract security\/run-contract\.json/);
  assert.match(build, /security-cleanup "\$BASE_RUN_ID"[\s\S]+\) \|\| BASE_CLEANUP=\$\?/);
  assert.match(build, /security-cleanup "\$CANDIDATE_RUN_ID" \|\| CANDIDATE_CLEANUP=\$\?/);
  assert.match(build,
    /needs: \[backend, frontend, security, assessment-runtime, tool-update-comparison, test-profile-plan\]/);
  assert.match(build, /candidate-ref "\$HEAD_REF"/);
});

// The base leg keeps its own compose on purpose, so an image needing a setting only the candidate's
// compose grants stops it. That stop is deliberate: nothing is compared without both toolchains.
test("given a paired comparison, when both sides run, then they assess the candidate revision's target", () => {
  // given
  const comparison = jobIn(build, "tool-update-comparison");

  // when / then
  assert.match(comparison, /TARGET_IMAGE=\$\(docker image inspect courtside:uat-local/);
  assert.match(comparison, /security "\$BASE_RUN_ID" "\$TARGET_IMAGE"/);
  assert.match(comparison, /security "\$CANDIDATE_RUN_ID" "\$TARGET_IMAGE"/);
  const target = comparison.slice(comparison.indexOf("Build and qualify the target both runs assess"),
    comparison.indexOf("Pull pinned assessment images"));
  assert.doesNotMatch(target, /courtside-security-base/,
    "a tool that detects what a branch repairs cannot pass against the application it repairs, so "
    + "the one target both toolchains share is built from the candidate, not from the base.");
  assert.equal(comparison.match(/--qualification "\$QUALIFICATION"/g)?.length, 2);
  assert.match(comparison, /QUALIFICATION="\$GITHUB_WORKSPACE\/build\/uat-smoke/);
  assert.doesNotMatch(comparison, /cp deploy\/compose\.security\.yaml/,
    "the base run reads its own compose file. It declares the mounts that supply the assessment "
    + "code and the bounds the scanners keep, so a copy from the candidate hands a pull request "
    + "the run that exists to be independent of it.");
});

// The base worktree comes out of the workspace's own .git, so anything the candidate has already
// run could have left something behind for its checkout to pick up.
test("given a protected base, when it is prepared, then no candidate code has run yet", () => {
  // given
  const comparison = jobIn(build, "tool-update-comparison");

  // when
  const prepared = comparison.indexOf("Install protected-base assessment dependencies");
  const candidateRan = comparison.indexOf("Install candidate assessment dependencies");

  // then
  assert.ok(prepared > 0 && candidateRan > prepared,
    "npm ci runs the candidate's lifecycle scripts and mvnw runs its wrapper. Both come after the "
    + "base worktree exists, so the checkout that supplies the previous toolchain predates them.");
});

function stepIn(job, name) {
  const start = job.indexOf(`- name: ${name}\n`);
  assert.ok(start > 0, `the job has no step named ${name}`);
  const rest = job.slice(start);
  const next = rest.indexOf("\n      - ");
  return next < 0 ? rest : rest.slice(0, next);
}

function jobIn(workflow, name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `the workflow has no job named ${name}`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

// The update under comparison can be one of these pins itself, and then the base names an image
// the candidate no longer does. Pulling one inventory leaves the base leg with no image to start.
test("given a pinned image is what changed, when the pull step runs, then both inventories are pulled", () => {
  // given
  const comparison = jobIn(build, "tool-update-comparison");
  const pull = stepIn(comparison, "Pull pinned assessment images");

  // when / then
  assert.match(pull, /\{ node tools\/security-image-inventory\.mjs active\n/);
  assert.match(pull,
    /\n\s+node "\$RUNNER_TEMP\/courtside-security-base\/tools\/security-image-inventory\.mjs" active\n/,
    "the base leg's own pins have to be pulled, or a bumped image leaves it nothing to run");
  assert.match(pull, /set -o pipefail/,
    "an inventory that fails at the head of the pipeline is otherwise reported by xargs alone");
});

// A job that runs and skips every step reports success, which reads in a pull request exactly like
// a comparison that ran. Only a job GitHub never starts is shown as skipped.
test("given nothing the assessment runtime varies, when the required build runs, then the comparison is not started at all", () => {
  // given
  const identity = jobIn(build, "assessment-runtime");
  const comparison = jobIn(build, "tool-update-comparison");

  // when / then
  assert.match(identity, /outputs:\n\s+changed: \$\{\{ steps\.runtime\.outputs\.changed \}\}/);
  assert.match(comparison, /needs: assessment-runtime/);
  assert.match(comparison, /\n {4}if: needs\.assessment-runtime\.outputs\.changed == 'true'\n/,
    "four spaces, so this is the job's own condition. A step carrying the same expression would "
    + "satisfy a looser check while the job still starts and still reports success.");
  assert.equal((comparison.match(/assessment-runtime\.outputs\.changed/g) ?? []).length, 1,
    "once, on the job. Every step carrying the decision itself is what made a skipped comparison "
    + "indistinguishable from one that ran.");
  assert.doesNotMatch(comparison, /steps\.runtime\.outputs\.changed/);
  assert.match(jobIn(build, "build"),
    /needs: \[backend, frontend, security, assessment-runtime, tool-update-comparison, test-profile-plan\]/,
    "a runtime identification that fails must not leave the comparison silently unstarted");
  assert.match(identity, /- uses: actions\/upload-artifact@[a-f0-9]{40}\n\s+if: always\(\)/,
    "the report naming what changed is the only account of why no comparison was needed, and a"
    + " decision that came out invalid is exactly when somebody reads it");
});

// Naming the result of a job and requiring something of it are different things. A check that only
// reads the assignment stays green while the line that judges it is deleted.
test("given the results the required build depends on, when it enforces them, then each one is judged", () => {
  // given
  const gate = jobIn(build, "build");

  // when / then
  for (const result of ["IDENTITY_RESULT", "COMPARISON_RESULT"]) {
    assert.match(gate, new RegExp(`${result}: \\$\\{\\{ needs\\.[a-z-]+\\.result \\}\\}`));
    assert.match(gate, new RegExp(`\\[\\[ "\\$${result}" = success \\|\\| "\\$${result}" = skipped \\]\\]`),
      `${result} is assigned and never judged, which is a gate that reports whatever it is given`);
  }
  for (const result of ["BACKEND_RESULT", "FRONTEND_RESULT", "SECURITY_RESULT"]) {
    assert.match(gate, new RegExp(`test "\\$${result}" = success`),
      `${result} has no state in which it may be absent, so it is required to have passed`);
  }
});

// The report already decides this from the digest of what a paired run varies. A second path list in
// the workflow is a second definition, and the one that stood here started two stacks for a compose
// line and for every dependency bump.
test("given one definition of the assessment runtime, when the job decides whether to run, then it asks for that decision", () => {
  // given
  const identity = jobIn(build, "assessment-runtime");

  // when / then
  assert.match(identity, /--identity-output build\/security-update\/identity\.json/);
  assert.match(identity, /comparisonRequired/);
  assert.match(identity, /case "\$REQUIRED" in[\s\S]*?true\|false\)[\s\S]*?exit 1/,
    "a value that is neither would otherwise become an output nothing starts the comparison on");
  assert.doesNotMatch(identity, /git diff --quiet/,
    "the decision belongs to runtimeComparisonRequired in security-update-report.mjs, which the "
    + "report already prints. Deriving it a second time here lets the two drift apart.");
});

// Ninety minutes of paired assessment used to end in an artifact nobody had to open: no step read
// newFindings, and the job blocked a merge on whether the comparison could be produced at all.
test("given a produced comparison, when the job ends, then its difference is read and has to be acknowledged", () => {
  // given
  const comparison = jobIn(build, "tool-update-comparison");

  // when / then
  assert.match(comparison, /security-tool-acknowledgement\.mjs/);
  assert.match(comparison, /--acknowledgement security\/tool-update-acknowledgement\.json/);
  assert.match(comparison, /GITHUB_STEP_SUMMARY/,
    "the difference belongs where a reviewer already looks, not in an artifact they have to fetch");
});

// Building an environment and judging what it answers are different failures. The first means the
// pair cannot be compared at all, so only the second is allowed to end without stopping the job.
test("given a base environment that cannot start, when the pair runs, then the job stops before judging", () => {
  // given
  const comparison = jobIn(build, "tool-update-comparison");
  const paired = comparison.slice(comparison.indexOf("Run paired active assessments"),
    comparison.indexOf("Compare immutable run evidence"));

  // when
  const environments = paired.match(/courtside\.mjs security "\$(?:BASE|CANDIDATE)_RUN_ID"[^\n]*/g) ?? [];

  // then
  assert.equal(environments.length, 2, "both legs create their environment in this step");
  for (const environment of environments) {
    assert.doesNotMatch(environment, /\|\| true/,
      "an environment that refuses the target leaves nothing to compare, so it must not be swallowed."
      + " Tolerating it would let a branch suppress the difference it is being measured by.");
  }
  assert.equal((paired.match(/--authorize "authorize-active-\$[A-Z_]+_RUN_ID" \|\| true/g) ?? []).length, 2,
    "a run that finishes and does not pass is judged by the comparator, so only that is tolerated");
  assert.equal((paired.match(/\|\| true/g) ?? []).length, 2, "and nothing else in the step is");
});

// Both runs assess one application, so both read that application's document; a second spelling
// turns an API change into a finding blamed on whichever toolchain read the older one.
test("given a paired assessment, when both runs start, then they are driven by the assessed revision's document", () => {
  // given
  const comparison = jobIn(build, "tool-update-comparison");
  const paired = comparison.slice(comparison.indexOf("Run paired active assessments"),
    comparison.indexOf("Compare immutable run evidence"));

  // when / then
  assert.match(paired,
    /COURTSIDE_SECURITY_API_DOCUMENT: \$\{\{ github\.workspace \}\}\/src\/main\/resources\/api\/openapi\.yaml/);
  assert.equal((paired.match(/COURTSIDE_SECURITY_API_DOCUMENT/g) ?? []).length, 1,
    "one setting on the step, not one per command — a second spelling is how the legs drift apart");
  assert.equal((paired.match(/courtside\.mjs security /g) ?? []).length, 2,
    "both legs create their environment inside the step that setting covers");
});

// A fingerprint is a hash of the finding, not a description of it. Asking somebody to record one
// they cannot read is the rubber stamp the acknowledgement exists to prevent.
test("given a difference to acknowledge, when the job reports it, then both runs' findings are there to name it", () => {
  // given
  const comparison = jobIn(build, "tool-update-comparison");

  // when / then
  assert.match(comparison, /--candidate-evidence "build\/security\/\$CANDIDATE_RUN_ID\/assessment\/attempt-1\/evidence"/);
  assert.match(comparison, /--base-evidence "\$BASE_ROOT\/build\/security\/\$BASE_RUN_ID\/assessment\/attempt-1\/evidence"/);
  assert.ok(comparison.indexOf("security-tool-acknowledgement.mjs") < comparison.indexOf("Remove comparison environments"),
    "the evidence is read while it still exists, not after the cleanup step has removed it");
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
  const comparison = jobIn(build, "tool-update-comparison");

  // when / then
  assert.match(pom, /<id>npm-test<\/id>[\s\S]*?<skip>\$\{frontend\.test\.skip}<\/skip>/,
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
  assert.match(release,
    /set -o pipefail[\s\S]{0,120}?node tools\/security-image-inventory\.mjs active \| xargs -n1 docker pull/);
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
