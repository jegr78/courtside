import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PINNED_BROWSER_IMAGE } from "../frontend/e2e/container-images.ts";
import { summaryMarkdown } from "../lighthouse/pages.mjs";
import {
  assertPerformanceSource, containerUserArguments, localRequest, performanceIdentityRequest, perfComposePlan
} from "./courtside.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUN_LIMIT_MILLISECONDS = 55 * 60 * 1000;

export function lighthouseContainerPlan({ root, output, stateFile, administratorFile, certificatePin,
  user = containerUserArguments() }) {
  return {
    command: "docker",
    args: ["run", "--rm", ...user, "--network", "courtside-perf_load", "--shm-size", "1g",
      "-e", "HOME=/tmp", "-e", "LIGHTHOUSE_ORIGIN=https://proxy", "-e", `LIGHTHOUSE_CERTIFICATE_PIN=${certificatePin}`,
      "-e", "LIGHTHOUSE_STATE=/run/courtside/perf.json", "-e", "LIGHTHOUSE_OUTPUT=/results",
      "-e", "LIGHTHOUSE_ADMINISTRATOR=/run/courtside/administrator.json",
      "-v", `${join(root, "lighthouse")}:/lighthouse:ro`, "-v", `${stateFile}:/run/courtside/perf.json:ro`,
      "-v", `${administratorFile}:/run/courtside/administrator.json`,
      "-v", `${output}:/results`, PINNED_BROWSER_IMAGE, "node", "/lighthouse/run.mjs"]
  };
}

export function lighthouseOutcome(results, exitStatus) {
  const failures = results.filter((result) => result.failure).map((result) => `${result.formFactor} ${result.path}: ${result.failure}`);
  if (exitStatus !== 0) failures.push(`the Lighthouse container exited with ${exitStatus}`);
  return failures;
}

export async function runLighthouse({ args = process.argv.slice(2), environment = process.env, root = repositoryRoot,
  execute = spawnSync, request = localRequest } = {}) {
  const image = args[0] === "--image" && args[1] ? args[1] : undefined;
  if (!image || args.length !== 2) throw new Error("Usage: node tools/courtside.lighthouse.mjs --image <reference>");
  const stateFile = join(root, "build", "perf-environment.json");
  if (!existsSync(stateFile)) throw new Error("The performance environment is not running; start it with 'perf' first");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  const output = join(root, "build", "lighthouse");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  const certificateFile = join(output, "root.crt");
  const copy = perfComposePlan(["cp", "proxy:/data/caddy/pki/authorities/local/root.crt", certificateFile], { state });
  const copied = execute(copy.command, copy.args, { cwd: root, env: copy.environment, stdio: "inherit" });
  if (copied.status !== 0) throw new Error("The performance proxy's local authority could not be copied");
  const identity = await request(performanceIdentityRequest(readFileSync(certificateFile)));
  rmSync(certificateFile);
  if (identity.statusCode !== 200 || !identity.certificatePin) {
    throw new Error(`The performance environment did not identify itself: HTTP ${identity.statusCode}`);
  }
  const source = JSON.parse(identity.body);
  assertPerformanceSource(source, state);

  const administratorFile = join(root, "build", "lighthouse-administrator.json");
  if (!existsSync(administratorFile)) writeFileSync(administratorFile, "{}\n", { mode: 0o600 });
  const plan = lighthouseContainerPlan({ root, output, stateFile, administratorFile, certificatePin: identity.certificatePin });
  const run = execute(plan.command, plan.args, { cwd: root, stdio: "inherit", timeout: RUN_LIMIT_MILLISECONDS });
  const resultsFile = join(output, "results.json");
  const results = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")) : [];
  const markdown = summaryMarkdown(results, { image, revision: source.commit });
  writeFileSync(join(output, "summary.md"), markdown);
  if (environment.GITHUB_STEP_SUMMARY) appendFileSync(environment.GITHUB_STEP_SUMMARY, markdown);
  const failures = lighthouseOutcome(results, run.status ?? run.signal ?? run.error?.code);
  if (results.length === 0) failures.push("Lighthouse wrote no results");
  if (failures.length > 0) throw new Error(`Lighthouse could not measure every page:\n${failures.join("\n")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runLighthouse();
}
