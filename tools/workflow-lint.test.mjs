import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { actionlintArguments, checkWorkflows, validateActionlintConfiguration } from "./workflow-lint.mjs";

const configuration = JSON.parse(readFileSync(
  new URL("../ci/actionlint.json", import.meta.url), "utf8"));
const build = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");

test("given the workflow linter configuration, when it is loaded, then one pinned upstream release owns every exception", () => {
  // when / then
  assert.deepEqual(validateActionlintConfiguration(configuration), {
    schemaVersion: 1,
    version: "1.7.12",
    ignoredDiagnostics: ['unknown permission scope "vulnerability-alerts"'],
  });
  assert.deepEqual(actionlintArguments(configuration), [
    "-shellcheck=", "-pyflakes=", "-ignore", 'unknown permission scope "vulnerability-alerts"',
  ]);
});

test("given the pinned linter is installed, when workflows are checked, then its GitHub-aware result is required", () => {
  // given
  const calls = [];
  const execute = (command, arguments_) => {
    calls.push({ command, arguments_ });
    return arguments_[0] === "-version"
      ? { status: 0, stdout: "1.7.12\n", stderr: "" }
      : { status: 0, stdout: "", stderr: "" };
  };

  // when
  checkWorkflows(configuration, { execute, executable: "/tools/actionlint" });

  // then
  assert.deepEqual(calls, [
    { command: "/tools/actionlint", arguments_: ["-version"] },
    { command: "/tools/actionlint", arguments_: actionlintArguments(configuration) },
  ]);
});

test("given another linter version or an invalid workflow, when checked, then verification fails closed", () => {
  // given
  const versionMismatch = (_command, arguments_) => arguments_[0] === "-version"
    ? { status: 0, stdout: "1.7.11\n", stderr: "" }
    : { status: 0, stdout: "", stderr: "" };
  const invalidWorkflow = (_command, arguments_) => arguments_[0] === "-version"
    ? { status: 0, stdout: "1.7.12\n", stderr: "" }
    : { status: 1, stdout: "", stderr: "workflow.yml: invalid expression" };

  // when / then
  assert.throws(() => checkWorkflows(configuration, { execute: versionMismatch }), /requires actionlint 1\.7\.12/);
  assert.throws(() => checkWorkflows(configuration, { execute: invalidWorkflow }), /invalid expression/);
});

test("given hosted tooling runs, when it installs actionlint, then the pinned official archive is attested before execution", () => {
  // when / then
  assert.match(build, /node tools\/workflow-lint\.mjs --github-output "\$GITHUB_OUTPUT"/);
  assert.match(build, /gh release download "v\$ACTIONLINT_VERSION" --repo rhysd\/actionlint/);
  assert.match(build,
    /gh attestation verify "\$RUNNER_TEMP\/actionlint\/\$ACTIONLINT_ARCHIVE" --repo rhysd\/actionlint/);
  assert.ok(build.indexOf("gh attestation verify") < build.indexOf("tar -xzf"));
  assert.match(build, /node tools\/workflow-lint\.mjs --check/);
});
