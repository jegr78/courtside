import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
const pom = readFileSync(new URL("../pom.xml", import.meta.url), "utf8");

test("givenProfileClassificationIsObservational_whenThePullRequestRuns_thenSplitQualityJobsControlTheGate", () => {
  // when / then
  assert.match(workflow, /test-profile-plan:/);
  assert.match(workflow, /test-profile-classifier\.mjs/);
  assert.match(workflow, /cat build\/test-profile\/summary\.md >> "\$GITHUB_STEP_SUMMARY"/);
  assert.match(workflow,
    /needs: \[backend, frontend, security, assessment-runtime, tool-update-comparison, test-profile-plan\]/);
  assert.match(workflow, /pull_request\) test "\$PROFILE_PLAN_RESULT" = success ;;/);
  assert.match(workflow, /push\) test "\$PROFILE_PLAN_RESULT" = skipped ;;/);
  assert.match(workflow, /backend:[\s\S]+name: Verify backend[\s\S]+\.\/mvnw -B clean verify -Pjava-only/);
  assert.match(workflow,
    /frontend:[\s\S]+name: Verify frontend[\s\S]+npm-cli\.js run lint[\s\S]+npm-cli\.js run test[\s\S]+npm-cli\.js run build/);
  assert.match(workflow,
    /frontend:[\s\S]+npm-cli\.js audit --audit-level=high[\s\S]+npm-cli\.js run test:e2e/);
  assert.match(workflow, /security:[\s\S]+github\/codeql-action\/init@[a-f0-9]{40}/);
});

test("givenSplitQualityJobs_whenOneDoesNotSucceed_thenTheAggregateFailsClosed", () => {
  // when / then
  assert.match(workflow, /build:\n\s+if: always\(\)/);
  for (const job of ["backend", "frontend", "security"]) {
    assert.match(workflow, new RegExp(`${job.toUpperCase()}_RESULT: \\$\\{\\{ needs\\.${job}\\.result \\}\\}`));
    assert.match(workflow, new RegExp(`test "\\$${job.toUpperCase()}_RESULT" = success`));
  }
});

test("givenBackendAndSecurityJobs_whenTheyBuildJava_thenMavenSkipsEveryFrontendExecution", () => {
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
