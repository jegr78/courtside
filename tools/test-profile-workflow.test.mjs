import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
const pom = readFileSync(new URL("../pom.xml", import.meta.url), "utf8");

test("given profile classification, when the pull request runs, then selected quality jobs control the gate", () => {
  // when / then
  assert.match(workflow, /test-profile-plan:/);
  assert.match(workflow, /test-profile-classifier\.mjs/);
  assert.match(workflow,
    /git worktree add --detach "\$PROFILE_ROOT" "\$BASE_REF"[\s\S]+node "\$PROFILE_ROOT\/tools\/test-profile-classifier\.mjs"/);
  assert.match(workflow, /outputs:[\s\S]+backend: \$\{\{ steps\.selection\.outputs\.backend \}\}/);
  assert.match(workflow,
    /needs: \[docs, backend, frontend, tooling, security, assessment-runtime, tool-update-comparison, test-profile-plan\]/);
  assert.match(workflow, /pull_request\)\s+test "\$PROFILE_PLAN_RESULT" = success/);
  assert.match(workflow, /push\|schedule\|workflow_dispatch\)\s+test "\$PROFILE_PLAN_RESULT" = skipped/);
  assert.match(workflow, /backend:[\s\S]+name: Verify backend[\s\S]+\.\/mvnw -B clean verify -Pjava-only/);
  assert.match(workflow, /docs:[\s\S]+name: Verify documentation[\s\S]+node tools\/docs-check\.mjs --check/);
  assert.match(workflow,
    /docs:\n\s+needs: test-profile-plan\n\s+if: always\(\) && \(github\.event_name != 'pull_request' \|\| needs\.test-profile-plan\.outputs\.docs == 'true'\)/);
  assert.match(workflow,
    /frontend:[\s\S]+name: Verify frontend[\s\S]+npm-cli\.js run lint[\s\S]+npm-cli\.js run test:frontend[\s\S]+npm-cli\.js run build/);
  assert.match(workflow,
    /frontend:[\s\S]+npm-cli\.js audit --audit-level=high[\s\S]+npm-cli\.js run test:e2e/);
  assert.match(workflow, /security:[\s\S]+github\/codeql-action\/init@[a-f0-9]{40}/);
  assert.match(workflow, /tooling:[\s\S]+name: Verify repository tooling[\s\S]+npm run test:tools/);
  assert.match(workflow,
    /tooling:[\s\S]+node tools\/node-toolchain\.mjs --github-output "\$GITHUB_OUTPUT"[\s\S]+node-version: \$\{\{ steps\.tooling-toolchain\.outputs\.node \}\}[\s\S]+NPM_VERSION: \$\{\{ steps\.tooling-toolchain\.outputs\.npm \}\}[\s\S]+npm install --global "npm@\$NPM_VERSION"[\s\S]+test "\$\(node --version\)" = "v\$NODE_VERSION"[\s\S]+test "\$\(npm --version\)" = "\$NPM_VERSION"/);
});

test("given a selected quality job, when it does not succeed, then the aggregate fails closed", () => {
  // when / then
  assert.match(workflow, /build:\n\s+if: always\(\)/);
  assert.match(workflow,
    /selected="\$\{!selected_variable\}"\s+if \[\[ "\$selected" = true \]\]; then\s+test "\$result" = success\s+else\s+test "\$result" = skipped/);
});

test("given reduced profiles, when jobs are scheduled, then only their conservative job set runs", () => {
  // when / then
  assert.match(workflow,
    /backend:\n\s+needs: test-profile-plan\n\s+if: always\(\) && \(github\.event_name != 'pull_request' \|\| needs\.test-profile-plan\.outputs\.backend == 'true'\)/);
  assert.match(workflow,
    /frontend:\n\s+needs: test-profile-plan\n\s+if: always\(\) && \(github\.event_name != 'pull_request' \|\| needs\.test-profile-plan\.outputs\.frontend == 'true'\)/);
  assert.match(workflow,
    /security:\n\s+needs: test-profile-plan\n\s+if: always\(\) && \(github\.event_name != 'pull_request' \|\| needs\.test-profile-plan\.outputs\.security == 'true'\)/);
  assert.match(workflow, /JOBS=\$\(jq -cer '\.ciJobs'/);
  assert.match(workflow,
    /SELECTED=\$\(jq -nr --argjson jobs "\$JOBS" --arg job "\$job" '\(\$jobs \| index\(\$job\)\) != null'\)/);
  assert.doesNotMatch(workflow, /\$job == "frontend" or \$job == "security"/);
});

test("given the classifier fails, when the plan runs, then full selection still reaches the gate", () => {
  // when / then
  assert.match(workflow, /git worktree add[\s\S]+\|\| CLASSIFIER_EXIT=\$\?/);
  assert.match(workflow,
    /if \.plannerOutcome == "failed" then \.isFull and \.profiles == \["full"\]\s+else \$classifierExit == 0 end/);
  assert.match(workflow,
    /else\s+PROFILES='\["full"\]'\s+JOBS='\["docs","backend","frontend","tooling","security"\]'[\s\S]+The classifier did not produce a trustworthy plan/);
});

test("given the emergency repository variable, when it demands full, then the classifier sees the full label", () => {
  // when / then
  assert.match(workflow, /FORCE_FULL: \$\{\{ vars\.COURTSIDE_TEST_PROFILES == 'full' \}\}/);
  assert.match(workflow, /if \[\[ "\$FORCE_FULL" = "true" \]\]; then LABELS='\["ci:full"\]'; fi/);
  assert.match(workflow, /--labels "\$LABELS"/);
  assert.doesNotMatch(workflow, /--mode|PROFILE_MODE|admissionOutcome/);
});

test("given a profile plan, when the aggregate runs, then every selected and skipped job is explained", () => {
  // when / then
  assert.match(workflow, /name: Summarize selected build results/);
  assert.match(workflow, /if: always\(\) && github\.event_name == 'pull_request'/);
  assert.match(workflow, /not selected by the conservative profile plan/);
  assert.match(workflow, /required by the conservative profile plan/);
});

test("given backend and security jobs, when they build java, then maven skips every frontend execution", () => {
  // when / then
  assert.match(pom, /<frontend\.skip>false<\/frontend\.skip>/);
  assert.match(pom, /<frontend\.test\.skip>\$\{skipTests}<\/frontend\.test\.skip>/);
  assert.match(pom,
    /<artifactId>frontend-maven-plugin<\/artifactId>[\s\S]+<skip>\$\{frontend\.skip}<\/skip>/);
  assert.match(pom,
    /<id>copy-web-client<\/id>[\s\S]+<skip>\$\{frontend\.skip}<\/skip>/);
  assert.match(pom,
    /<id>java-only<\/id>[\s\S]+<frontend\.skip>true<\/frontend\.skip>[\s\S]+<frontend\.test\.skip>true<\/frontend\.test\.skip>/);
});

test("given split coverage artifacts, when the aggregate downloads them, then it uses their archive roots", () => {
  // when / then
  assert.match(workflow, /--java build\/aggregate\/backend\/site\/jacoco\/jacoco\.xml/);
  assert.match(workflow, /--frontend build\/aggregate\/frontend\/coverage\/lcov\.info/);
  assert.doesNotMatch(workflow, /build\/aggregate\/backend\/target\/site/);
  assert.doesNotMatch(workflow, /build\/aggregate\/frontend\/frontend\/coverage/);
  assert.match(workflow, /arguments\+=\(--java build\/aggregate\/backend\/site\/jacoco\/jacoco\.xml\)/);
  assert.match(workflow, /arguments\+=\(--frontend build\/aggregate\/frontend\/coverage\/lcov\.info\)/);
});

test("given security finding tools need node modules, when the security job runs, then it installs locked dependencies", () => {
  // when / then
  assert.match(workflow,
    /security:[\s\S]+name: Install security toolchain[\s\S]+com\.github\.eirslett:frontend-maven-plugin:install-node-and-npm\s+com\.github\.eirslett:frontend-maven-plugin:npm@npm-ci[\s\S]+tools\/security-findings\.mjs/);
});

test("given maven downloads fail transiently, when any wrapper command runs, then resolver retries stay bounded", () => {
  // given
  const mavenConfig = readFileSync(new URL("../.mvn/maven.config", import.meta.url), "utf8");
  const expected = new Map([
    ["count", "3"],
    ["interval", "15000"],
    ["intervalMax", "120000"],
    ["serviceUnavailable", "429,503"]
  ]);

  // when / then
  for (const namespace of ["connector", "transport"]) {
    for (const [property, value] of expected) {
      assert.match(mavenConfig,
        new RegExp(`^-Daether\\.${namespace}\\.http\\.retryHandler\\.${property}=${value}$`, "m"));
    }
  }
});

test("given workflow jobs invoke the frontend plugin, when maven resolves it, then no prefix lookup is needed", () => {
  // when / then
  assert.doesNotMatch(workflow, /(?:^|\s)frontend:(?:install-node-and-npm|npm@npm-ci)/);
  assert.match(workflow, /com\.github\.eirslett:frontend-maven-plugin:install-node-and-npm/);
});

test("given the aggregate only evaluates coverage, when node is prepared, then it does not contact maven central", () => {
  // when / then
  assert.match(workflow,
    /name: Install coverage toolchain[\s\S]+uses: actions\/setup-node@[a-f0-9]{40}[\s\S]+node-version: '26'/);
  assert.doesNotMatch(workflow,
    /name: Install coverage toolchain[\s\S]{0,300}run: \.\/mvnw/);
  assert.match(workflow, /node tools\/coverage-diff\.mjs/);
});
