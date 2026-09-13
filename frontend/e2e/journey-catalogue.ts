import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface WalkedJourney {
  file: string;
  title: string;
  workflows: string[];
}

// The listing is what Playwright itself resolves, so a journey the projects never match cannot be
// counted by reading the directory instead.
export function walkedJourneys(): WalkedJourney[] {
  const cli = createRequire(join(__dirname, "resolve-from-here.js")).resolve("@playwright/test/cli");
  // Inside a recorded run the gate project does not exist, and the listing would fail on a name
  // the configuration only offers when the recording is off.
  const gateEnv = { ...process.env, COURTSIDE_JOURNEY_RUN: "false" };
  const listed = execFileSync(process.execPath, [cli, "test", "--list", "--reporter=json", "--project=journey-gate"],
    { cwd: join(__dirname, ".."), encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: gateEnv });
  const report = JSON.parse(listed) as { suites: PlaywrightSuite[] };
  return report.suites.flatMap(everySpec).map((spec) => ({
    file: spec.file,
    title: spec.title,
    workflows: spec.tests.flatMap((walked) => walked.annotations)
      .filter((annotation) => annotation.type === "workflow")
      .map((annotation) => annotation.description)
  }));
}

interface PlaywrightSuite {
  specs: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightSpec {
  file: string;
  title: string;
  tests: { annotations: { type: string; description: string }[] }[];
}

function everySpec(suite: PlaywrightSuite): PlaywrightSpec[] {
  return [...suite.specs, ...(suite.suites ?? []).flatMap(everySpec)];
}

export function declaredWorkflows(): string[] {
  const inventory = JSON.parse(readFileSync(join(__dirname, "../../security/production-workflows.json"), "utf8")) as
    { workflows: { id: string }[] };
  return inventory.workflows.map((workflow) => workflow.id);
}
