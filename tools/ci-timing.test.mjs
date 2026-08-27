import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { aggregateTimingRecords, createTimingRecord } from "./ci-timing.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const schema = JSON.parse(readFileSync(new URL("../ci/ci-timing.schema.json", import.meta.url), "utf8"));
const validate = new Ajv({ strict: true, formats: { "date-time": true } }).compile(schema);

const run = {
  id: 101,
  run_attempt: 1,
  event: "pull_request",
  head_sha: "a".repeat(40),
  created_at: "2026-08-27T10:00:00Z",
  run_started_at: "2026-08-27T10:00:00Z",
  updated_at: "2026-08-27T10:12:00Z",
  conclusion: "failure",
  html_url: "https://github.com/example/courtside/actions/runs/101"
};

const jobs = [{
  id: 201,
  name: "quality",
  status: "completed",
  conclusion: "failure",
  started_at: "2026-08-27T10:00:10Z",
  completed_at: "2026-08-27T10:11:50Z",
  runner_name: "GitHub Actions 1",
  labels: ["ubuntu-latest"],
  steps: [
    { name: "Set up job", conclusion: "success", started_at: "2026-08-27T10:00:10Z", completed_at: "2026-08-27T10:00:20Z" },
    { name: "Build and test", conclusion: "failure", started_at: "2026-08-27T10:00:20Z", completed_at: "2026-08-27T10:08:20Z" }
  ]
}];

test("givenACompletedFirstAttempt_whenRecordingTiming_thenTheFirstFailureAndDurationsRemainAttributable", () => {
  // given / when
  const record = createTimingRecord(run, jobs, "jegr78/courtside");

  // then
  assert.equal(record.attempt, 1);
  assert.equal(record.isFirstAttempt, true);
  assert.equal(record.durationMilliseconds, 720_000);
  assert.equal(record.timeToFirstFailureMilliseconds, 500_000);
  assert.equal(record.jobs[0].durationMilliseconds, 700_000);
  assert.equal(record.jobs[0].runner.kind, "github-hosted");
  assert.deepEqual(record.jobs[0].runner.labels, ["ubuntu-latest"]);
});

test("givenARerun_whenRecordingTiming_thenItCannotMasqueradeAsFirstAttemptEvidence", () => {
  // given
  const rerun = {
    ...run,
    run_attempt: 2,
    conclusion: "success",
    created_at: "2026-08-26T10:00:00Z",
    run_started_at: "2026-08-27T10:00:00Z"
  };

  // when
  const record = createTimingRecord(rerun, jobs, "jegr78/courtside");

  // then
  assert.equal(record.attempt, 2);
  assert.equal(record.isFirstAttempt, false);
  assert.equal(record.durationMilliseconds, 720_000);
});

test("givenCancelledAndMalformedJobs_whenRecordingTiming_thenTheRecordFailsClosed", () => {
  // given
  const cancelled = { ...run, conclusion: "cancelled" };
  const malformedJobs = [{ ...jobs[0], completed_at: null }];

  // when / then
  assert.throws(() => createTimingRecord(cancelled, malformedJobs, "jegr78/courtside"), /completed_at/);
});

test("givenGitHubReportsASkippedJobBeforeItsStart_whenRecordingTiming_thenNoRunnerTimeIsInvented", () => {
  // given
  const skipped = {
    ...jobs[0],
    name: "tool-update-comparison",
    conclusion: "skipped",
    runner_name: null,
    started_at: "2026-08-27T10:00:34Z",
    completed_at: "2026-08-27T10:00:33Z",
    steps: []
  };

  // when
  const record = createTimingRecord({ ...run, conclusion: "success" }, [skipped], "jegr78/courtside");

  // then
  assert.equal(record.jobs[0].durationMilliseconds, 0);
  assert.equal(record.jobs[0].runner.kind, "not-assigned");
});

test("givenAJobFailsOutsideANamedStep_whenRecordingTiming_thenItsCompletionMarksTheFirstFailure", () => {
  // given
  const failed = { ...jobs[0], steps: [] };

  // when
  const record = createTimingRecord(run, [failed], "jegr78/courtside");

  // then
  assert.equal(record.timeToFirstFailureMilliseconds, 710_000);
});

test("givenFirstAttemptRecords_whenAggregating_thenMedianP95AndRunnerMinutesAreReported", () => {
  // given
  const records = [600_000, 900_000, 1_200_000, 1_500_000].map((duration, index) => ({
    ...createTimingRecord({
      ...run,
      id: 101 + index,
      conclusion: "success",
      updated_at: new Date(Date.parse(run.created_at) + duration).toISOString()
    }, [{ ...jobs[0], conclusion: "success", steps: jobs[0].steps.map((step) => ({ ...step, conclusion: "success" })) }],
    "jegr78/courtside"),
    durationMilliseconds: duration,
    jobs: [{ ...createTimingRecord(run, jobs, "jegr78/courtside").jobs[0], durationMilliseconds: duration }]
  }));

  // when
  const aggregate = aggregateTimingRecords(records);

  // then
  assert.equal(aggregate.sampleSize, 4);
  assert.equal(aggregate.medianDurationMilliseconds, 1_050_000);
  assert.equal(aggregate.p95DurationMilliseconds, 1_500_000);
  assert.equal(aggregate.runnerMinutes, 70);
});

test("givenOnlyReruns_whenAggregating_thenTheSampleIsExplicitlyInsufficient", () => {
  // given
  const records = [{ ...createTimingRecord({ ...run, run_attempt: 2 }, jobs, "jegr78/courtside"), isFirstAttempt: false }];

  // when
  const aggregate = aggregateTimingRecords(records);

  // then
  assert.deepEqual(aggregate, { sampleSize: 0, status: "insufficient-sample" });
});

test("givenARecordedRun_whenValidatingTheRetainedArtifact_thenItsShapeIsClosed", () => {
  // given
  const record = createTimingRecord(run, jobs, "jegr78/courtside");

  // when / then
  assert.equal(validate(record), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...record, environment: { token: "secret" } }), false);
});
