import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outcomes = new Set(["success", "failure", "cancelled", "timed_out", "action_required", "neutral",
  "skipped", "startup_failure", "stale"]);
const publicRunnerLabels = new Set(["self-hosted", "linux", "windows", "macos", "x64", "arm64", "ubuntu-latest",
  "ubuntu-24.04", "windows-latest", "macos-latest"]);

function timestamp(value, name) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${name} is not a timestamp`);
  return Date.parse(value);
}

function outcome(value, name) {
  if (!outcomes.has(value)) throw new Error(`${name} is not a supported conclusion`);
  return value;
}

function duration(startedAt, completedAt, name) {
  const value = timestamp(completedAt, `${name}.completed_at`) - timestamp(startedAt, `${name}.started_at`);
  if (value < 0) throw new Error(`${name} has a negative duration`);
  return value;
}

function runnerMetadata(job) {
  const labels = Array.isArray(job.labels)
    ? job.labels.filter((label) => publicRunnerLabels.has(label)).sort()
    : [];
  return {
    kind: job.runner_name === null ? "not-assigned"
      : typeof job.runner_name === "string" && job.runner_name.startsWith("GitHub Actions ")
        ? "github-hosted" : "self-hosted",
    labels
  };
}

export function createTimingRecord(run, jobs, repository) {
  if (!Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
    throw new Error("Run identity is invalid");
  }
  if (run.event !== "pull_request" && run.event !== "push") throw new Error("Run event is unsupported");
  if (typeof run.head_sha !== "string" || !/^[a-f0-9]{40}$/.test(run.head_sha)) throw new Error("Run commit is invalid");
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error("Repository identity is invalid");
  }
  if (typeof run.html_url !== "string" || !/^https:\/\/github\.com\/[A-Za-z0-9_.\/-]+$/.test(run.html_url)) {
    throw new Error("Run URL is invalid");
  }
  if (!Array.isArray(jobs) || jobs.length === 0 || jobs.length > 100) throw new Error("Run jobs are missing or excessive");
  const started = timestamp(run.run_started_at, "run.run_started_at");
  const completed = timestamp(run.updated_at, "run.updated_at");
  if (completed < started) throw new Error("Run has a negative duration");
  const recordedJobs = jobs.map((job) => {
    if (!Number.isSafeInteger(job.id) || typeof job.name !== "string" || job.name.length < 1 || job.name.length > 200
      || job.status !== "completed") {
      throw new Error("Job identity or status is invalid");
    }
    if (!Array.isArray(job.steps) || job.steps.length > 100) throw new Error(`Job ${job.name} steps are invalid`);
    const steps = job.steps.filter((step) => !(step.conclusion === "skipped"
      && step.started_at === null && step.completed_at === null)).map((step, index) => ({
      name: typeof step.name === "string" && step.name.length >= 1 && step.name.length <= 200
        ? step.name : (() => { throw new Error(`jobs[${index}].step name is invalid`); })(),
      outcome: outcome(step.conclusion, `jobs[${index}].step`),
      startedAt: step.started_at,
      completedAt: step.completed_at,
      durationMilliseconds: duration(step.started_at, step.completed_at, `jobs[${index}].step`)
    }));
    return {
      id: job.id,
      name: job.name,
      outcome: outcome(job.conclusion, `job ${job.name}`),
      startedAt: job.started_at,
      completedAt: job.completed_at,
      durationMilliseconds: job.conclusion === "skipped" ? 0
        : duration(job.started_at, job.completed_at, `job ${job.name}`),
      runner: runnerMetadata(job),
      steps
    };
  });
  const failedSteps = recordedJobs.flatMap((job) => job.steps)
    .filter((step) => step.outcome === "failure" || step.outcome === "timed_out")
    .map((step) => timestamp(step.completedAt, "failed step completedAt"))
    .sort((left, right) => left - right);
  const failedJobs = recordedJobs.filter((job) => job.outcome === "failure" || job.outcome === "timed_out")
    .map((job) => timestamp(job.completedAt, "failed job completedAt"));
  const failedAt = [...failedSteps, ...failedJobs].sort((left, right) => left - right)[0];
  return {
    schemaVersion: 1,
    repository,
    runId: run.id,
    attempt: run.run_attempt,
    isFirstAttempt: run.run_attempt === 1,
    event: run.event,
    commit: run.head_sha,
    outcome: outcome(run.conclusion, "run"),
    startedAt: run.run_started_at,
    completedAt: run.updated_at,
    durationMilliseconds: completed - started,
    timeToFirstFailureMilliseconds: failedAt === undefined ? null : failedAt - started,
    url: run.html_url,
    jobs: recordedJobs
  };
}

function percentile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function aggregateTimingRecords(records) {
  if (!Array.isArray(records) || records.length > 10_000) throw new Error("Timing record collection is invalid");
  const firstAttempts = records.filter((record) => record.isFirstAttempt === true);
  if (firstAttempts.length === 0) return { sampleSize: 0, status: "insufficient-sample" };
  const durations = firstAttempts.map((record) => record.durationMilliseconds).sort((left, right) => left - right);
  const middle = Math.floor(durations.length / 2);
  const median = durations.length % 2 === 0
    ? (durations[middle - 1] + durations[middle]) / 2 : durations[middle];
  const runnerMilliseconds = firstAttempts.flatMap((record) => record.jobs)
    .reduce((sum, job) => sum + job.durationMilliseconds, 0);
  return {
    sampleSize: firstAttempts.length,
    status: firstAttempts.length < 20 ? "insufficient-sample" : "measured",
    medianDurationMilliseconds: median,
    p95DurationMilliseconds: percentile(durations, 0.95),
    runnerMinutes: Math.round(runnerMilliseconds / 60_000 * 100) / 100
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index === process.argv.length - 1) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

function main() {
  const run = JSON.parse(readFileSync(resolve(argument("--run")), "utf8"));
  const jobs = JSON.parse(readFileSync(resolve(argument("--jobs")), "utf8")).jobs;
  const record = createTimingRecord(run, jobs, argument("--repository"));
  const output = resolve(argument("--output"));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  const summary = resolve(argument("--summary"));
  writeFileSync(summary,
    `## Pull-request timing\n\n- Attempt: ${record.attempt}${record.isFirstAttempt ? " (first)" : " (rerun)"}\n`
    + `- Outcome: ${record.outcome}\n- Duration: ${Math.round(record.durationMilliseconds / 1000)} seconds\n`
    + `- First failure: ${record.timeToFirstFailureMilliseconds === null ? "none" : `${Math.round(record.timeToFirstFailureMilliseconds / 1000)} seconds`}\n`,
    { mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
