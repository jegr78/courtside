import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const configurationUrl = new URL("../ci/actionlint.json", import.meta.url);

export function validateActionlintConfiguration(candidate) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)
      || Object.keys(candidate).sort().join(",") !== "ignoredDiagnostics,schemaVersion,version"
      || candidate.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(candidate.version)
      || !Array.isArray(candidate.ignoredDiagnostics)
      || candidate.ignoredDiagnostics.some((entry) => typeof entry !== "string" || entry.length === 0)
      || new Set(candidate.ignoredDiagnostics).size !== candidate.ignoredDiagnostics.length) {
    throw new Error("actionlint configuration is invalid");
  }
  return structuredClone(candidate);
}

export function actionlintArguments(configuration) {
  return ["-shellcheck=", "-pyflakes=",
    ...configuration.ignoredDiagnostics.flatMap((diagnostic) => ["-ignore", diagnostic])];
}

function run(executable, arguments_) {
  const result = spawnSync(executable, arguments_, { encoding: "utf8", shell: false });
  if (result.error) throw result.error;
  return result;
}

export function checkWorkflows(configuration, runtime = {}) {
  const checked = validateActionlintConfiguration(configuration);
  const executable = runtime.executable ?? process.env.ACTIONLINT ?? "actionlint";
  const execute = runtime.execute ?? run;
  const version = execute(executable, ["-version"]);
  if (version.status !== 0) {
    throw new Error(version.stderr || version.stdout || "actionlint version check failed");
  }
  const reported = `${version.stdout ?? ""}\n${version.stderr ?? ""}`.match(/\b\d+\.\d+\.\d+\b/)?.[0];
  if (reported !== checked.version) {
    throw new Error(`Workflow verification requires actionlint ${checked.version}; found ${reported ?? "unknown"}`);
  }
  const lint = execute(executable, actionlintArguments(checked));
  if (lint.status !== 0) throw new Error(lint.stderr || lint.stdout || "actionlint failed");
}

function writeGitHubOutput(configuration, path) {
  const checked = validateActionlintConfiguration(configuration);
  appendFileSync(path,
    `version=${checked.version}\narchive=actionlint_${checked.version}_linux_amd64.tar.gz\n`,
    { encoding: "utf8", mode: 0o600 });
}

function main(arguments_) {
  const configuration = JSON.parse(readFileSync(configurationUrl, "utf8"));
  if (arguments_.length === 1 && arguments_[0] === "--check") {
    checkWorkflows(configuration);
    return;
  }
  if (arguments_.length === 2 && arguments_[0] === "--github-output") {
    writeGitHubOutput(configuration, arguments_[1]);
    return;
  }
  throw new Error("Use --check or --github-output FILE");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
