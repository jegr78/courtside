import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outcomes = new Set(["success", "failure", "cancelled", "timed_out", "action_required", "neutral",
  "skipped", "startup_failure", "stale"]);
const publicRunnerLabels = new Set(["self-hosted", "linux", "windows", "macos", "x64", "arm64", "ubuntu-latest",
  "ubuntu-24.04", "windows-latest", "macos-latest"]);

function timestamp(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error(`${name} is not an RFC 3339 UTC timestamp`);
  }
  const parsed = Date.parse(value);
  const canonical = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== canonical) {
    throw new Error(`${name} is not an RFC 3339 UTC timestamp`);
  }
  return parsed;
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
  const record = {
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
  validateTimingRecord(record);
  return record;
}

export function assertRunIdentity(run, expectedRunId, expectedAttempt) {
  if (run.id !== expectedRunId || run.run_attempt !== expectedAttempt) {
    throw new Error("Fetched run evidence does not match the triggering event");
  }
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} is not a non-negative integer`);
}

function closedObject(value, fields, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} is not an object`);
  const unknown = Object.keys(value).filter((field) => !fields.has(field));
  if (unknown.length > 0) throw new Error(`${name} has unknown fields: ${unknown.join(", ")}`);
}

export function validateTimingRecord(record) {
  closedObject(record, new Set(["schemaVersion", "repository", "runId", "attempt", "isFirstAttempt", "event",
    "commit", "outcome", "startedAt", "completedAt", "durationMilliseconds",
    "timeToFirstFailureMilliseconds", "url", "jobs"]), "Timing record");
  if (record.schemaVersion !== 1) throw new Error("Timing record version is invalid");
  if (!Number.isSafeInteger(record.runId) || record.runId < 1 || !Number.isSafeInteger(record.attempt)
    || record.attempt < 1) throw new Error("Timing record identity is invalid");
  if (record.isFirstAttempt !== (record.attempt === 1)) throw new Error("Timing record first-attempt identity is inconsistent");
  if (record.event !== "pull_request" && record.event !== "push") throw new Error("Timing record event is invalid");
  if (typeof record.commit !== "string" || !/^[a-f0-9]{40}$/.test(record.commit)) {
    throw new Error("Timing record commit is invalid");
  }
  if (typeof record.repository !== "string"
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(record.repository)) {
    throw new Error("Timing record repository is invalid");
  }
  if (typeof record.url !== "string" || record.url.length > 500
    || !/^https:\/\/github\.com\/[A-Za-z0-9_.\/-]+$/.test(record.url)) throw new Error("Timing record URL is invalid");
  outcome(record.outcome, "timing record");
  const runStarted = timestamp(record.startedAt, "timing record startedAt");
  const runCompleted = timestamp(record.completedAt, "timing record completedAt");
  nonNegativeInteger(record.durationMilliseconds, "timing record duration");
  if (record.durationMilliseconds !== runCompleted - runStarted) throw new Error("Timing record duration is inconsistent");
  if (record.timeToFirstFailureMilliseconds !== null) {
    nonNegativeInteger(record.timeToFirstFailureMilliseconds, "time to first failure");
    if (record.timeToFirstFailureMilliseconds > record.durationMilliseconds) {
      throw new Error("Time to first failure exceeds the run duration");
    }
  }
  if (!Array.isArray(record.jobs) || record.jobs.length < 1 || record.jobs.length > 100) {
    throw new Error("Timing record jobs are invalid");
  }
  const jobIds = record.jobs.map((job) => job.id);
  if (new Set(jobIds).size !== jobIds.length) throw new Error("Timing record contains a duplicate job id");
  for (const job of record.jobs) validateRecordedJob(job, runStarted, runCompleted);
  const failedAt = record.jobs.flatMap((job) => [
    ...(job.outcome === "failure" || job.outcome === "timed_out" ? [timestamp(job.completedAt, "job failure")] : []),
    ...job.steps.filter((step) => step.outcome === "failure" || step.outcome === "timed_out")
      .map((step) => timestamp(step.completedAt, "step failure"))
  ]).sort((left, right) => left - right)[0];
  const expectedFailure = failedAt === undefined ? null : failedAt - runStarted;
  if (record.timeToFirstFailureMilliseconds !== expectedFailure) {
    throw new Error("Timing record first failure is inconsistent");
  }
}

function validateRecordedJob(job, runStarted, runCompleted) {
  closedObject(job, new Set(["id", "name", "outcome", "startedAt", "completedAt", "durationMilliseconds",
    "runner", "steps"]), "Timing job");
  if (!Number.isSafeInteger(job.id) || job.id < 1 || typeof job.name !== "string"
    || job.name.length < 1 || job.name.length > 200) throw new Error("Timing job identity is invalid");
  outcome(job.outcome, `job ${job.name}`);
  const started = timestamp(job.startedAt, `job ${job.name} startedAt`);
  const completed = timestamp(job.completedAt, `job ${job.name} completedAt`);
  nonNegativeInteger(job.durationMilliseconds, `job ${job.name} duration`);
  const expectedDuration = job.outcome === "skipped" ? 0 : completed - started;
  if (job.durationMilliseconds !== expectedDuration || (job.outcome !== "skipped" && expectedDuration < 0)) {
    throw new Error(`Job ${job.name} duration is inconsistent`);
  }
  if (job.outcome !== "skipped" && (started < runStarted || completed > runCompleted)) {
    throw new Error(`Job ${job.name} is outside the run`);
  }
  closedObject(job.runner, new Set(["kind", "labels"]), `Job ${job.name} runner`);
  if (!new Set(["github-hosted", "self-hosted", "not-assigned"]).has(job.runner.kind)
    || !Array.isArray(job.runner.labels) || job.runner.labels.length > 10
    || new Set(job.runner.labels).size !== job.runner.labels.length
    || job.runner.labels.some((label) => !publicRunnerLabels.has(label))) throw new Error(`Job ${job.name} runner is invalid`);
  if (!Array.isArray(job.steps) || job.steps.length > 100) throw new Error(`Job ${job.name} steps are invalid`);
  for (const step of job.steps) {
    closedObject(step, new Set(["name", "outcome", "startedAt", "completedAt", "durationMilliseconds"]),
      `Job ${job.name} step`);
    if (typeof step.name !== "string" || step.name.length < 1 || step.name.length > 200) {
      throw new Error(`Job ${job.name} step identity is invalid`);
    }
    outcome(step.outcome, `job ${job.name} step`);
    const stepStarted = timestamp(step.startedAt, `job ${job.name} step startedAt`);
    const stepCompleted = timestamp(step.completedAt, `job ${job.name} step completedAt`);
    nonNegativeInteger(step.durationMilliseconds, `job ${job.name} step duration`);
    if (step.durationMilliseconds !== stepCompleted - stepStarted || stepCompleted < stepStarted) {
      throw new Error(`Job ${job.name} step duration is inconsistent`);
    }
    if (stepStarted < started || stepCompleted > completed) {
      throw new Error(`Job ${job.name} step is outside its job`);
    }
  }
}

function percentile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function aggregateTimingRecords(records) {
  if (!Array.isArray(records) || records.length > 10_000) throw new Error("Timing record collection is invalid");
  for (const record of records) validateTimingRecord(record);
  const identities = records.map((record) => `${record.runId}:${record.attempt}`);
  if (new Set(identities).size !== identities.length) throw new Error("Timing records contain a duplicate run attempt");
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
  assertRunIdentity(run, Number(argument("--expected-run-id")), Number(argument("--expected-attempt")));
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
