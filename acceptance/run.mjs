import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg as systemLoad } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/schema.mjs";
import { PROFILE_NAMES } from "./config/lanes.mjs";
import { claimRunDirectory, harnessCommit } from "./lib/run-directory.mjs";
import { analyse } from "./report/analysis.mjs";
import { contactSheets } from "./report/sheets.mjs";
import { renderReport } from "./report/html.mjs";

const PHASES = ["all", "matrix", "postflight", "report"];
const here = fileURLToPath(new URL(".", import.meta.url));

export function parseArguments(argv) {
  const parsed = { phase: "all", run: null, projects: [] };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index + 1];
    if (argv[index] === "--phase") { parsed.phase = value; index++; }
    else if (argv[index] === "--run") { parsed.run = value; index++; }
    else if (argv[index] === "--project") { parsed.projects.push(value); index++; }
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  if (!PHASES.includes(parsed.phase)) throw new Error(`phase must be one of ${PHASES.join(", ")}`);
  if ((parsed.phase === "postflight" || parsed.phase === "report") && !parsed.run) throw new Error(`--phase ${parsed.phase} needs --run <directory>`);
  return parsed;
}

export async function waitForLoad({ limit, loadavg = systemLoad, sleep = (ms) => new Promise((done) => setTimeout(done, ms)), deadlineMs = 30 * 60_000, now = Date.now }) {
  const started = now();
  while (loadavg()[0] >= limit) {
    if (now() - started >= deadlineMs) throw new Error(`load stayed above ${limit} for ${Math.round(deadlineMs / 60_000)} min`);
    await sleep(15_000);
  }
}

export const resultsFileFor = (projects) => projects.length === 1 && projects[0] === "postflight" ? "postflight-results.json" : "results.json";

function playwright(run, projects) {
  const cli = createRequire(join(here, "package.json")).resolve("@playwright/test/cli");
  const result = spawnSync(process.execPath, [cli, "test", "--config", join(here, "playwright.config.ts"), ...projects.flatMap((project) => ["--project", project])],
    { cwd: here, stdio: "inherit", env: { ...process.env, ACCEPTANCE_CONFIG: resolve(process.env.ACCEPTANCE_CONFIG ?? ""), ACCEPTANCE_RUN_DIR: run, ACCEPTANCE_RESULTS: resultsFileFor(projects) } });
  return result.status ?? 1;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const config = loadConfig();
  const run = resolve(args.run ?? join(here, "..", "build", "acceptance", new Date().toISOString().replace(/[:.]/g, "-")));
  let exit = 0;
  if (args.phase === "all" || args.phase === "matrix") {
    claimRunDirectory(run);
    writeFileSync(join(run, "run-started"), new Date().toISOString());
    writeFileSync(join(run, "source.json"), JSON.stringify({ commit: harnessCommit(new URL(".", import.meta.url)) }));
    await waitForLoad({ limit: config.loadLimit });
    const projects = args.projects.length ? args.projects : PROFILE_NAMES;
    exit = playwright(run, projects);
  }
  if (args.phase === "all" || args.phase === "postflight") exit = playwright(run, ["postflight"]) || exit;
  if (args.phase === "all" || args.phase === "report") {
    await analyse(run, config);
    const sheets = contactSheets(run);
    const commit = existsSync(join(run, "source.json")) ? JSON.parse(readFileSync(join(run, "source.json"), "utf8")).commit : harnessCommit(new URL(".", import.meta.url));
    const report = renderReport(run, config, { harnessCommit: commit });
    console.log(JSON.stringify({ run, sheets, ...report }));
  }
  process.exitCode = exit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
