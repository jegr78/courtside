import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const gatesSource = read(".github/workflows/release-gates.yml");
const gates = yaml.load(gatesSource);
const action = yaml.load(read(".github/actions/gate-image/action.yml"));
const build = yaml.load(read(".github/workflows/build.yml"));
const digest = `sha256:${"a".repeat(64)}`;

function stepsUsing(job, uses) {
  return (gates.jobs[job].steps ?? []).filter((step) => String(step.uses ?? "").startsWith(uses));
}

function resolveImage(environment) {
  const directory = mkdtempSync(join(tmpdir(), "gate-image-"));
  const output = join(directory, "output");
  const script = action.runs.steps.find((step) => step.id === "resolve").run;
  const result = spawnSync("bash", ["-e", "-c", script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, RUNNER_TEMP: directory, LOAD: "false",
      REPOSITORY: "example/courtside", ...environment }
  });
  let outputs = {};
  try {
    outputs = Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").filter(Boolean)
      .map((line) => line.split(/=(.*)/s).slice(0, 2)));
  } catch {
    outputs = {};
  }
  return { status: result.status, outputs };
}

test("given an image from a pull request, when the gates run, then nothing logs into or pushes to the registry", () => {
  // given
  const logins = Object.entries(gates.jobs).flatMap(([name, job]) => (job.steps ?? [])
    .filter((step) => String(step.uses ?? "").startsWith("docker/login-action"))
    .map((step) => ({ name, condition: step.if })));

  // when / then
  assert.ok(logins.length > 0, "the registry-mode gates still log in to pull the nightly image");
  for (const login of logins) {
    assert.equal(login.condition, "inputs.image-source == 'registry'", `${login.name} logs in for a PR image`);
  }
  assert.doesNotMatch(gatesSource, /push: true|docker push/, "no gate writes to a registry");
});

test("given an image from a pull request, when the gates run, then only the npm audit and the release record stay out", () => {
  // given
  const registryOnly = ["npm-audit", "security-record"];

  // when / then
  for (const job of registryOnly) {
    assert.equal(gates.jobs[job].if, "inputs.image-source == 'registry'", `${job} must not run on a PR image`);
  }
  for (const [name, job] of Object.entries(gates.jobs).filter(([name]) => !registryOnly.includes(name))) {
    assert.doesNotMatch(String(job.if ?? ""), /image-source|registry/,
      `${name} is a release gate a pull request must run; a registry-only gate needs a reason here first`);
  }
});

test("given both triggers, when no image source is named, then the gates read the registry", () => {
  // when / then
  for (const trigger of ["workflow_call", "workflow_dispatch"]) {
    const inputs = (gates.on ?? gates[true])[trigger].inputs;
    assert.equal(inputs["image-source"].default, "registry", `${trigger} defaults to the registry`);
    assert.equal(inputs["image-artifact"].default, "", `${trigger} needs no artifact for a registry image`);
  }
});

test("given an image source, when a job needs the image at runtime, then it uses the resolved reference", () => {
  // given
  const imageStep = (job) => gates.jobs[job].steps.find((step) => step.id === "image");

  // when / then
  for (const job of ["active-security", "restore", "upgrade"]) {
    assert.equal(imageStep(job).uses, "./.github/actions/gate-image", `${job} resolves its image`);
    assert.notEqual(imageStep(job).with.load, "false", `${job} runs the image and has to load it`);
    assert.equal(gates.jobs[job].env?.IMAGE, undefined, `${job} names no image before it is resolved`);
  }
  assert.ok(gates.jobs.restore.steps.some((step) =>
    step.env?.COURTSIDE_RESTORE_IMAGE === "${{ steps.image.outputs.reference }}"), "restore runs the resolved image");
  assert.ok(gates.jobs.upgrade.steps.some((step) =>
    step.env?.COURTSIDE_UPGRADE_CANDIDATE_IMAGE === "${{ steps.image.outputs.reference }}"),
  "upgrade migrates into the resolved image");
  const pulls = gates.jobs["active-security"].steps.filter((step) => /docker pull "\$IMAGE"/.test(step.run ?? ""));
  assert.equal(pulls.length, 1, "the assessment pulls its target in exactly one step");
  assert.equal(pulls[0].if, "inputs.image-source == 'registry'", "a loaded image is never pulled");
  for (const step of gates.jobs["active-security"].steps.filter((candidate) => /\$IMAGE/.test(candidate.run ?? ""))) {
    assert.equal(step.env?.IMAGE, "${{ steps.image.outputs.reference }}", `${step.name} assesses the resolved image`);
  }
});

test("given jobs that only bind the archive, when they resolve the image, then they read its pinned name without loading", () => {
  // when / then
  for (const job of ["mail", "archive-reproducibility"]) {
    const resolved = stepsUsing(job, "./.github/actions/gate-image");
    assert.deepEqual(resolved.map((step) => step.id).sort(), ["booking-seed", "image"], `${job} resolves both images`);
    for (const step of resolved) assert.equal(step.with.load, "false", `${job} never needs the image bytes`);
    const named = gates.jobs[job].steps.filter((step) => step.env?.IMAGE !== undefined);
    assert.ok(named.length > 0, `${job} names the image it binds`);
    for (const step of named) {
      assert.equal(step.env.IMAGE, "${{ steps.image.outputs.pinned }}", `${step.name} binds the pinned name`);
    }
    assert.ok(gates.jobs[job].steps.some((step) =>
      step.env?.BOOKING_SEED_IMAGE === "${{ steps.booking-seed.outputs.pinned }}"), `${job} binds the booking seed`);
  }
});

test("given a registry image, when the gate image is resolved, then every use names the registry digest", () => {
  // when
  const resolved = resolveImage({ SOURCE: "registry", DIGEST: digest });

  // then
  assert.equal(resolved.status, 0);
  assert.equal(resolved.outputs.reference, `ghcr.io/example/courtside@${digest}`);
  assert.equal(resolved.outputs.pinned, `ghcr.io/example/courtside@${digest}`);
});

test("given an image built in the run, when the gate image is resolved, then runtime uses the image ID itself", () => {
  // when
  const resolved = resolveImage({ SOURCE: "artifact", DIGEST: digest });

  // then
  assert.equal(resolved.status, 0);
  assert.equal(resolved.outputs.reference, digest, "a loaded image has no registry name to run under");
  assert.equal(resolved.outputs.pinned, `ghcr.io/example/courtside@${digest}`, "the archive still records a pinned name");
});

test("given an unknown source or a floating reference, when the gate image is resolved, then the job fails", () => {
  // when / then
  assert.notEqual(resolveImage({ SOURCE: "cache", DIGEST: digest }).status, 0, "an unknown source is refused");
  assert.notEqual(resolveImage({ SOURCE: "registry", DIGEST: "latest" }).status, 0, "a tag is not a digest");
  assert.notEqual(resolveImage({ SOURCE: "artifact", DIGEST: "" }).status, 0, "an empty digest is refused");
});

test("given a pull request selecting the gates, when the build runs, then the gates use a locally built image", () => {
  // given
  const gatesJob = build.jobs.gates;
  const image = build.jobs["gates-image"];

  // when / then
  assert.equal(gatesJob.uses, "./.github/workflows/release-gates.yml");
  assert.equal(gatesJob.with["image-source"], "artifact");
  assert.equal(gatesJob.with["image-artifact"], "gate-image-${{ github.run_id }}");
  assert.equal(gatesJob.with["image-digest"], "${{ needs.gates-image.outputs.image-id }}");
  assert.equal(gatesJob.with["booking-seed-digest"], "${{ needs.gates-image.outputs.booking-seed-id }}");
  assert.equal(gatesJob.with["source-commit"], "${{ github.sha }}", "the gates test the commit every other job tests");
  assert.equal(gatesJob.with["upgrade-base"], "${{ github.event.pull_request.base.sha }}",
    "an empty upgrade origin set is judged against the pull request's own diff");
  assert.deepEqual(gatesJob.needs, ["test-profile-plan", "gates-image"]);
  assert.match(gatesJob.if, /needs\.gates-image\.result == 'success'/);
  assert.match(image.if, /github\.event_name == 'pull_request' && needs\.test-profile-plan\.outputs\.gates == 'true'/);
  assert.ok(build.jobs.build.needs.includes("gates"), "the required check must wait for the gates");
  assert.ok(build.jobs.build.needs.includes("gates-image"), "the required check must wait for the gate image");
  assert.ok(build.jobs.build.needs.includes("clock-shift"), "the required check must wait for the shifted clock");
});

test("given the gate image job, when it builds, then the head branch reaches the shell only through the environment", () => {
  // given
  const steps = build.jobs["gates-image"].steps;

  // when
  const record = steps.find((step) => step.id === "images");

  // then
  for (const step of steps) assert.doesNotMatch(step.run ?? "", /\$\{\{/, `${step.name ?? step.uses} interpolates into a shell`);
  assert.equal(record.env.HEAD_REF, "${{ github.head_ref }}");
  assert.match(record.run, /--workflow nightly-image\.yml/);
  assert.match(record.run, /test -z "\$\(git status --porcelain --ignored -- deploy\/\)"/,
    "the archive is built from a deploy directory the qualification left untouched");
  assert.ok(steps.some((step) => step.run === "frontend/node/node tools/courtside.uat-smoke.mjs --confirm courtside-uat"),
    "the image is qualified before the gates use it");
  assert.equal(build.jobs["gates-image"].permissions.contents, "read");
  assert.equal(Object.keys(build.jobs["gates-image"].permissions).length, 1, "the gate image needs no write scope");
});

test("given the browser matrix, when WebKit accessibility runs, then only its shard sets the axe flag", () => {
  // given
  const browser = build.jobs.browser;

  // when
  const shard = browser.steps.find((step) => step.name === "Run the functional browser shard");

  // then
  assert.deepEqual(browser.strategy.matrix.group, ["functional-a", "functional-b", "webkit-accessibility"]);
  assert.equal(shard.env.COURTSIDE_WEBKIT_AXE, "${{ matrix.group == 'webkit-accessibility' && 'true' || 'false' }}");
});

const enforce = build.jobs.build.steps.find((step) => step.name === "Enforce required build results").run;
const qualityJobs = ["docs", "backend", "frontend", "browser_visual", "browser", "deployment", "tooling", "security"];

function aggregate(event, results, selected = {}) {
  const environment = { PATH: process.env.PATH, EVENT_NAME: event, IDENTITY_RESULT: "skipped",
    COMPARISON_RESULT: "skipped", PROFILE_PLAN_RESULT: event === "pull_request" ? "success" : "skipped" };
  for (const job of [...qualityJobs, "gates", "clock_shift"]) {
    const isSelected = selected[job] ?? true;
    environment[`${job.toUpperCase()}_SELECTED`] = String(isSelected);
    environment[`${job.toUpperCase()}_RESULT`] = isSelected || event !== "pull_request" ? "success" : "skipped";
  }
  environment.GATES_IMAGE_RESULT = environment.GATES_RESULT;
  Object.assign(environment, results);
  return spawnSync("bash", ["-e", "-c", enforce], { env: environment, encoding: "utf8" }).status;
}

test("given a pull request that selects the gates, when the aggregate decides, then only a run of both gate jobs passes", () => {
  // when / then
  assert.equal(aggregate("pull_request", {}), 0, "selected and succeeded");
  assert.notEqual(aggregate("pull_request", { GATES_RESULT: "skipped" }), 0, "selected but skipped");
  assert.notEqual(aggregate("pull_request", { GATES_RESULT: "failure" }), 0, "selected and failed");
  assert.notEqual(aggregate("pull_request", { GATES_IMAGE_RESULT: "skipped" }), 0, "gates without the image they test");
  assert.notEqual(aggregate("pull_request", { GATES_IMAGE_RESULT: "failure" }), 0, "an image that failed to build");
  assert.notEqual(aggregate("pull_request", { CLOCK_SHIFT_RESULT: "skipped" }), 0, "a selected shifted clock that never ran");
});

test("given a pull request that does not select the gates, when the aggregate decides, then a gate that ran anyway fails it", () => {
  // given
  const unselected = { gates: false, clock_shift: false };

  // when / then
  assert.equal(aggregate("pull_request", {}, unselected), 0, "unselected and skipped");
  assert.notEqual(aggregate("pull_request", { GATES_RESULT: "success" }, unselected), 0, "unselected but ran");
  assert.notEqual(aggregate("pull_request", { GATES_IMAGE_RESULT: "success" }, unselected), 0, "an unselected image build");
  assert.notEqual(aggregate("pull_request", { CLOCK_SHIFT_RESULT: "success" }, unselected), 0, "an unselected clock shift");
});

test("given the push and nightly paths, when the aggregate decides, then the gates stay skipped and the clock shift follows the event", () => {
  // given
  const skippedGates = { GATES_RESULT: "skipped", GATES_IMAGE_RESULT: "skipped" };

  // when / then
  assert.equal(aggregate("push", { ...skippedGates, CLOCK_SHIFT_RESULT: "skipped" }), 0);
  assert.notEqual(aggregate("push", { ...skippedGates, CLOCK_SHIFT_RESULT: "success" }), 0, "a push runs no clock shift");
  assert.equal(aggregate("schedule", skippedGates), 0);
  assert.notEqual(aggregate("schedule", { ...skippedGates, CLOCK_SHIFT_RESULT: "failure" }), 0,
    "a failed shifted clock blocks the nightly image");
  assert.notEqual(aggregate("workflow_dispatch", { ...skippedGates, CLOCK_SHIFT_RESULT: "skipped" }), 0);
  assert.notEqual(aggregate("schedule", { GATES_RESULT: "success", GATES_IMAGE_RESULT: "skipped" }), 0,
    "the nightly runs its gates in registry mode, never the pull-request ones");
});
