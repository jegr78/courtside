import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const commitPattern = /^[a-f0-9]{40}$/;
const evidenceFields = ["attempt", "commit", "contract", "firstAttempt", "jobs", "releaseReadiness", "runId",
  "schemaVersion"];
const jobFields = ["build", "nightlyImage"];

function hasExactly(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).toSorted().join() === fields.toSorted().join();
}

function selectedRun({ commit, runId }) {
  if (!commitPattern.test(commit ?? "") || !Number.isSafeInteger(runId) || runId < 1) {
    throw new Error("selected nightly run is invalid");
  }
}

function completeEvidence(evidence) {
  return hasExactly(evidence, evidenceFields)
    && hasExactly(evidence.jobs, jobFields)
    && evidence.schemaVersion === 1
    && evidence.contract === "coupled-nightly-image-v1"
    && evidence.attempt === 1
    && evidence.firstAttempt === true
    && evidence.releaseReadiness === "complete"
    && evidence.jobs.build === "success"
    && evidence.jobs.nightlyImage === "success";
}

export function validateNightlyReleaseEvidence(evidence, expected) {
  selectedRun(expected);
  if (!completeEvidence(evidence)) throw new Error("coupled nightly evidence is incomplete or invalid");
  if (evidence.commit !== expected.commit || evidence.runId !== expected.runId) {
    throw new Error("nightly evidence does not match the selected run");
  }
  return { commit: expected.commit, runId: expected.runId };
}

function argumentsOf(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!["--evidence", "--commit", "--run-id"].includes(name) || value === undefined) {
      throw new Error("usage: nightly-release-evidence --evidence <path> --commit <sha> --run-id <id>");
    }
    const key = name.slice(2);
    if (options[key] !== undefined) throw new Error(`nightly release evidence argument ${name} is duplicated`);
    options[key] = value;
  }
  if (Object.keys(options).length !== 3) throw new Error("nightly release evidence arguments are incomplete");
  return options;
}

function readJson(path, name) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${name} evidence cannot be read: ${error.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = argumentsOf(process.argv.slice(2));
    const result = validateNightlyReleaseEvidence(readJson(options.evidence, "nightly"),
      { commit: options.commit, runId: Number(options["run-id"]) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
