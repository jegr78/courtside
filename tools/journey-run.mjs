import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { journeyIndex } from "./journey-index.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const frontend = resolve(root, "frontend");
const startedAt = new Date().toISOString();
// The directory carries the moment, so the run a release cites cannot be overwritten by the next.
const directory = resolve(root, "build", "journeys", startedAt.replace(/[:.]/g, "-"));
const report = resolve(directory, "results.json");
mkdirSync(directory, { recursive: true });

const cli = createRequire(resolve(frontend, "package.json")).resolve("@playwright/test/cli");
// The catalogue is what this run records; without the path every other project in the
// configuration runs too, and the index refuses a run it cannot name a device and a language for.
const run = spawnSync(process.execPath, [cli, "test", "--reporter=list,json",
  `--output=${resolve(directory, "artefacts")}`, "e2e/journeys", ...process.argv.slice(2)], {
  cwd: frontend,
  stdio: "inherit",
  env: {
    ...process.env,
    COURTSIDE_JOURNEY_RUN: "true",
    PLAYWRIGHT_JSON_OUTPUT_NAME: report
  }
});

let written = false;
try {
  writeFileSync(resolve(directory, "index.md"),
    journeyIndex(JSON.parse(readFileSync(report, "utf8")), startedAt));
  written = true;
} catch (unreadable) {
  console.error(`The run left no report to index: ${unreadable.message}`);
}

console.log(`Journey run: ${directory}`);
if (written) console.log(`Index: ${resolve(directory, "index.md")}`);
process.exit(run.status ?? 1);
