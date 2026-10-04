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

test("given an image from a pull request, when the gates run, then the volatile and release-only jobs stay out", () => {
  // when / then
  for (const job of ["npm-audit", "security-record"]) {
    assert.equal(gates.jobs[job].if, "inputs.image-source == 'registry'", `${job} must not run on a PR image`);
  }
  for (const job of ["mail", "active-security", "restore", "upgrade-origins", "upgrade", "archive-reproducibility"]) {
    assert.doesNotMatch(String(gates.jobs[job].if ?? ""), /image-source/, `${job} must run on a PR image`);
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
