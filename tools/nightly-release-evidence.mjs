import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { targetBranch } from "./release-line.mjs";

const commitPattern = /^[a-f0-9]{40}$/;
const evidenceFields = ["attempt", "commit", "contract", "firstAttempt", "jobs", "releaseReadiness", "runId",
  "schemaVersion"];
const jobFields = ["build", "nightlyImage", "releaseGates"];

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
    && evidence.contract === "coupled-nightly-rehearsal-v2"
    && evidence.attempt === 1
    && evidence.firstAttempt === true
    && evidence.releaseReadiness === "complete"
    && evidence.jobs.build === "success"
    && evidence.jobs.nightlyImage === "success"
    && evidence.jobs.releaseGates === "success";
}

export function validateNightlyReleaseEvidence(evidence, expected) {
  selectedRun(expected);
  if (!completeEvidence(evidence)) throw new Error("coupled nightly evidence is incomplete or invalid");
  if (evidence.commit !== expected.commit || evidence.runId !== expected.runId) {
    throw new Error("nightly evidence does not match the selected run");
  }
  return { commit: expected.commit, runId: expected.runId };
}

export function nightlyRunsOf(pages, branch, repository) {
  targetBranch(branch);
  return pages.flatMap((page) => page.workflow_runs ?? [])
    .filter((run) => run.head_branch === branch && run.head_repository?.full_name === repository
      && run.path === ".github/workflows/build.yml"
      && (run.event === "schedule" || run.event === "workflow_dispatch")
      && run.run_attempt === 1 && commitPattern.test(run.head_sha ?? ""))
    .map((run) => ({ id: run.id, head: run.head_sha }));
}

export function findNightlyRelease({ runs, isAncestor, evidenceOf, branch }) {
  for (const { id, head } of runs) {
    if (!isAncestor(head)) continue;
    const evidence = evidenceOf(id);
    if (evidence === null) continue;
    try {
      return validateNightlyReleaseEvidence(evidence, { commit: head, runId: id });
    } catch {
      continue;
    }
  }
  throw new Error(`no green first-attempt build on ${branch} with a completed nightly release rehearsal verified `
    + "a commit this candidate builds on");
}

function capture(executable, arguments_) {
  return execFileSync(executable, arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024 });
}

function succeeds(executable, arguments_) {
  try {
    capture(executable, arguments_);
    return true;
  } catch {
    return false;
  }
}

function findOnBranch({ branch, commit }) {
  targetBranch(branch);
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("GITHUB_REPOSITORY names no repository");
  if (!commitPattern.test(commit ?? "")) throw new Error("--commit must be a full 40-character sha");
  const pages = JSON.parse(capture("gh", ["api", "--paginate", "--slurp",
    `repos/${repository}/actions/workflows/build.yml/runs?branch=${encodeURIComponent(branch)}&status=success&per_page=100`]));
  const directory = mkdtempSync(join(tmpdir(), "courtside-nightly-evidence-"));
  try {
    return findNightlyRelease({
      runs: nightlyRunsOf(pages, branch, repository),
      branch,
      isAncestor: (head) => succeeds("git", ["cat-file", "-e", `${head}^{commit}`])
        && succeeds("git", ["merge-base", "--is-ancestor", head, commit]),
      evidenceOf: (id) => {
        const target = join(directory, String(id));
        if (!succeeds("gh", ["run", "download", String(id), "--repo", repository, "--dir", target,
          "--name", `nightly-release-evidence-${id}-1`])) return null;
        try {
          return JSON.parse(readFileSync(join(target, "evidence.json"), "utf8"));
        } catch {
          return null;
        }
      }
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function findArgumentsOf(args) {
  const options = {};
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index]?.slice(2);
    if (!["branch", "commit"].includes(key) || args[index + 1] === undefined || options[key] !== undefined) {
      throw new Error("usage: nightly-release-evidence --find --branch <branch> --commit <sha>");
    }
    options[key] = args[index + 1];
  }
  if (Object.keys(options).length !== 2) throw new Error("usage: nightly-release-evidence --find --branch <branch> --commit <sha>");
  return options;
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
    const args = process.argv.slice(2);
    const result = args[0] === "--find" ? findOnBranch(findArgumentsOf(args)) : (() => {
      const options = argumentsOf(args);
      return validateNightlyReleaseEvidence(readJson(options.evidence, "nightly"),
        { commit: options.commit, runId: Number(options["run-id"]) });
    })();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
