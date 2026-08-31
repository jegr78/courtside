import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTimingRecord } from "./ci-timing.mjs";
import { bindPlanToRun, classifyChanges, parseNameStatus } from "./test-profile-classifier.mjs";
import { createProfileObservation, profileObservationReport,
  summarizeProfileObservations } from "./test-profile-observation.mjs";

const contract = JSON.parse(readFileSync(
  new URL("../ci/test-profile-observation.json", import.meta.url), "utf8"));
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const shaPattern = /^[a-f0-9]{40}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function runsInEvidenceWindow(runs, windowStartedAt, assessedAt) {
  if (!Array.isArray(runs) || !validTimestamp(windowStartedAt) || !validTimestamp(assessedAt)) {
    throw new Error("Replay evidence window is invalid");
  }
  return runs.filter((run) => validTimestamp(run?.created_at)
    && Date.parse(run.created_at) >= Date.parse(windowStartedAt)
    && Date.parse(run.created_at) <= Date.parse(assessedAt));
}

export function runBaseIdentity(run, repository) {
  if (run === null || typeof run !== "object" || run.event !== "pull_request"
      || run.status !== "completed" || run.run_attempt !== 1
      || !Number.isSafeInteger(run.id) || run.id < 1
      || run.repository?.full_name !== repository || !Number.isSafeInteger(run.repository?.id)
      || run.head_repository?.id !== run.repository.id
      || run.head_repository?.full_name !== repository
      || !shaPattern.test(run.head_sha ?? "")
      || typeof run.head_branch !== "string" || run.head_branch.length < 1 || run.head_branch.length > 255) {
    throw new Error("Run is not a valid first attempt");
  }
  const matches = Array.isArray(run.pull_requests) ? run.pull_requests.filter((reference) =>
    reference?.base?.repo?.id === run.repository.id
      && typeof reference?.base?.ref === "string" && reference.base.ref.length > 0
      && shaPattern.test(reference?.base?.sha ?? "")
      && reference?.head?.repo?.id === run.head_repository.id
      && reference?.head?.ref === run.head_branch
      && reference?.head?.sha === run.head_sha) : [];
  if (matches.length !== 1) throw new Error("Expected exactly one run-bound pull request");
  return {
    runId: run.id,
    attempt: 1,
    baseCommit: matches[0].base.sha,
    headCommit: run.head_sha
  };
}

function validateRunSummary(summary, attempt, repository) {
  if (summary === null || typeof summary !== "object" || summary.id !== attempt.id
      || summary.head_sha !== attempt.head_sha || summary.event !== "pull_request"
      || summary.status !== "completed" || summary.repository?.full_name !== repository) {
    throw new Error("Run inventory does not match first-attempt evidence");
  }
}

export async function replayProfileEvidence({ repository, assessedAt, runSummaries, loadAttempt,
  loadJobs, classify, resolveIdentity = (run) => runBaseIdentity(run, repository),
  windowStartedAt = contract.evidenceWindowStartedAt }) {
  if (!repositoryPattern.test(repository ?? "") || !validTimestamp(assessedAt)
      || !validTimestamp(windowStartedAt) || Date.parse(windowStartedAt) >= Date.parse(assessedAt)
      || !Array.isArray(runSummaries) || runSummaries.length < 1 || runSummaries.length > 10_000
      || typeof loadAttempt !== "function" || typeof loadJobs !== "function" || typeof classify !== "function") {
    throw new Error("Replay input is invalid");
  }
  const runIds = runSummaries.map((run) => run?.id);
  if (new Set(runIds).size !== runIds.length) throw new Error("Run inventory contains duplicates");
  const observations = [];
  for (const summary of [...runSummaries].sort((left, right) => left.id - right.id)) {
    try {
      const attempt = await loadAttempt(summary.id);
      validateRunSummary(summary, attempt, repository);
      const identity = await resolveIdentity(attempt);
      const jobs = await loadJobs(summary.id);
      const timing = createTimingRecord(attempt, jobs, repository);
      const plan = await classify(identity);
      if (plan.runId !== identity.runId || plan.attempt !== 1
          || plan.baseCommit !== identity.baseCommit || plan.headCommit !== identity.headCommit) {
        throw new Error("Recomputed profile plan identity is inconsistent");
      }
      observations.push(createProfileObservation(plan, timing));
    } catch (error) {
      throw new Error(`Replay failed for run ${summary.id}: ${error.message}`, { cause: error });
    }
  }
  const inventory = {
    schemaVersion: 1,
    repository,
    windowStartedAt,
    windowEndedAt: assessedAt,
    firstAttempts: observations.map(({ runId, commit }) => ({ runId, commit }))
  };
  const summary = summarizeProfileObservations(observations, inventory);
  return { observations, inventory, summary };
}

export function pullRequestIdentity(run, pullRequests, repository) {
  if (!Array.isArray(pullRequests)) throw new Error("Pull request evidence is invalid");
  const matches = pullRequests.filter((pullRequest) =>
    Number.isSafeInteger(pullRequest?.number) && pullRequest.number > 0
      && pullRequest?.base?.repo?.full_name === repository
      && shaPattern.test(pullRequest?.base?.sha ?? "")
      && pullRequest?.head?.repo?.full_name === repository
      && pullRequest?.head?.sha === run.head_sha);
  if (matches.length !== 1) throw new Error("Expected exactly one head-bound pull request");
  return {
    pullRequestNumber: matches[0].number,
    runId: run.id,
    attempt: 1,
    baseCommit: matches[0].base.sha,
    headCommit: run.head_sha
  };
}

export function historicalPullRequest(run, candidates, repository) {
  if (!Array.isArray(candidates)) {
    throw new Error("Historical pull request evidence is invalid");
  }
  const matches = candidates.filter((pullRequest) => {
    const runStarted = Date.parse(run.run_started_at);
    const pullRequestCreated = Date.parse(pullRequest?.created_at);
    const pullRequestClosed = pullRequest?.closed_at === null ? Number.POSITIVE_INFINITY
      : Date.parse(pullRequest?.closed_at);
    return Number.isSafeInteger(pullRequest?.number) && pullRequest.number > 0
      && pullRequest?.base?.repo?.full_name === repository
      && pullRequest?.head?.repo?.full_name === repository
      && pullRequest?.head?.ref === run.head_branch
      && Number.isFinite(runStarted) && Number.isFinite(pullRequestCreated)
      && runStarted >= pullRequestCreated && runStarted <= pullRequestClosed;
  });
  if (matches.length !== 1) throw new Error("Expected exactly one historical head-bound pull request");
  return matches[0];
}

function gitChangeIdentity(run, pullRequest) {
  execFileSync("git", ["fetch", "--no-tags", "origin", run.head_sha], {
    cwd: repositoryRoot, stdio: "ignore"
  });
  const baseCommit = execFileSync("git", ["merge-base", "origin/main", run.head_sha], {
    cwd: repositoryRoot, encoding: "utf8"
  }).trim();
  if (!shaPattern.test(baseCommit)) throw new Error("Historical pull request merge base is invalid");
  return {
    pullRequestNumber: pullRequest.number,
    runId: run.id,
    attempt: 1,
    baseCommit,
    headCommit: run.head_sha
  };
}

function classifyGitChanges(identity) {
  const evidence = execFileSync("git", ["diff", "--name-status", "-z", "--find-renames",
    identity.baseCommit, identity.headCommit, "--"], {
    cwd: repositoryRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024
  });
  return bindPlanToRun(classifyChanges(parseNameStatus(evidence), []), identity);
}

function githubClient(token) {
  if (typeof token !== "string" || token.length < 1) throw new Error("GH_TOKEN is required");
  const request = async (path) => {
    const response = await fetch(new URL(path, "https://api.github.com"), { headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "courtside-profile-evidence",
      "x-github-api-version": "2022-11-28"
    } });
    if (!response.ok) throw new Error(`GitHub API request failed with status ${response.status}`);
    return response.json();
  };
  const pages = async (path) => {
    const values = [];
    for (let page = 1; page <= 100; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const value = await request(`${path}${separator}per_page=100&page=${page}`);
      const entries = Array.isArray(value) ? value : value.workflow_runs ?? value.jobs;
      if (!Array.isArray(entries)) throw new Error("GitHub API page is invalid");
      values.push(...entries);
      if (entries.length < 100) return values;
    }
    throw new Error("GitHub API pagination exceeds the limit");
  };
  return { request, pages };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

async function main() {
  const repository = argument("--repository");
  const assessedAt = argument("--assessed-at");
  const output = resolve(argument("--output"));
  const summaryOutput = resolve(argument("--summary"));
  const observationsOutput = resolve(argument("--observations-output"));
  const inventoryOutput = resolve(argument("--inventory-output"));
  const github = githubClient(process.env.GH_TOKEN);
  const runs = await github.pages(`/repos/${repository}/actions/workflows/build.yml/runs?event=pull_request&status=completed`);
  const inWindow = runsInEvidenceWindow(runs, contract.evidenceWindowStartedAt, assessedAt);
  const result = await replayProfileEvidence({
    repository,
    assessedAt,
    runSummaries: inWindow,
    loadAttempt: (runId) => github.request(`/repos/${repository}/actions/runs/${runId}/attempts/1`),
    loadJobs: (runId) => github.pages(`/repos/${repository}/actions/runs/${runId}/attempts/1/jobs`),
    resolveIdentity: async (run) => {
      const pullRequests = await github.pages(`/repos/${repository}/commits/${run.head_sha}/pulls`);
      if (pullRequests.some((pullRequest) => pullRequest?.head?.sha === run.head_sha)) {
        const current = pullRequestIdentity(run, pullRequests, repository);
        return gitChangeIdentity(run, pullRequests.find((pullRequest) => pullRequest.number === current.pullRequestNumber));
      }
      const owner = repository.slice(0, repository.indexOf("/"));
      const candidates = pullRequests.length > 0 ? pullRequests
        : await github.pages(`/repos/${repository}/pulls?state=all&head=${encodeURIComponent(`${owner}:${run.head_branch}`)}`);
      return gitChangeIdentity(run, historicalPullRequest(run, candidates, repository));
    },
    classify: async (identity) => {
      if (identity.baseCommit === undefined) throw new Error("Profile identity has no base commit");
      return classifyGitChanges(identity);
    }
  });
  for (const path of [output, summaryOutput, observationsOutput, inventoryOutput]) {
    mkdirSync(dirname(path), { recursive: true });
  }
  writeFileSync(output, `${JSON.stringify(result.summary, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(summaryOutput, profileObservationReport(result.summary), { mode: 0o600 });
  writeFileSync(observationsOutput, `${JSON.stringify(result.observations, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(inventoryOutput, `${JSON.stringify(result.inventory, null, 2)}\n`, { mode: 0o600 });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
