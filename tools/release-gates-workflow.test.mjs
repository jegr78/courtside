import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const gatesSource = read(".github/workflows/release-gates.yml");
const gates = yaml.load(gatesSource);
const action = yaml.load(read(".github/actions/gate-image/action.yml"));
const build = yaml.load(read(".github/workflows/build.yml"));
const digest = `sha256:${"a".repeat(64)}`;

for (const source of ["registry", "artifact"]) {
  for (const matching of [true, false]) {
    test(`given ${source} transition evidence with matching=${matching}, when the mail gate runs, then only its own candidate can pass`, () => {
      // given
      const root = mkdtempSync(join(tmpdir(), "mail-gate-binding-"));
      const image = source === "artifact" ? digest : `ghcr.io/example/courtside@${digest}`;
      const servedImage = `ghcr.io/example/courtside@sha256:${"b".repeat(64)}`;
      const expected = source === "artifact" ? servedImage : image;
      const bin = join(root, "bin");
      mkdirSync(bin);
      mkdirSync(join(root, "runner"));
      mkdirSync(join(root, "build", "deployment-mail"), { recursive: true });
      writeFileSync(join(root, "build", "deployment-mail", "archive.json"), JSON.stringify({ archive: { version: "0.4.0-nightly.7" } }));
      symlinkSync(fileURLToPath(new URL(".", import.meta.url)), join(root, "tools"), "dir");
      const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
      writeFileSync(join(bin, "node"), `#!/bin/sh
case "$1" in
  tools/stalwart-store-transition-smoke.mjs|tools/installed-upgrade-gate.mjs)
    printf '%s\\n' "$*" > calls.log
    exec ${quote(process.execPath)} --input-type=module - <<'JS'
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('build/stalwart-store-transition', {recursive:true});
writeFileSync('build/stalwart-store-transition/result.json', JSON.stringify({status:'passed',runtimeImage:process.env.REPORTED_IMAGE,candidateRevision:process.env.SOURCE_COMMIT}));
mkdirSync('build/installed-upgrade-gate', {recursive:true});
writeFileSync('build/installed-upgrade-gate/image-binding.json', JSON.stringify({sourceImage:process.env.IMAGE,servedImage:process.env.SERVED_IMAGE,revision:process.env.SOURCE_COMMIT}));
JS
    ;;
  *) exec ${quote(process.execPath)} "$@" ;;
esac
`, { mode: 0o755 });
      const step = gates.jobs.mail.steps.find((entry) => entry.id === "transition");
      try {
        // when
        const result = spawnSync("bash", ["-e", "-c", step.run], { cwd: root, encoding: "utf8", env: {
          ...process.env, PATH: `${bin}:${process.env.PATH}`, IMAGE_SOURCE: source, IMAGE: image,
          SERVED_IMAGE: servedImage, REPORTED_IMAGE: matching ? expected : `ghcr.io/example/courtside@sha256:${"c".repeat(64)}`,
          BOOKING_SEED_IMAGE: `sha256:${"d".repeat(64)}`, VERSION: "0.4.0-nightly.7", SOURCE_COMMIT: "f".repeat(40),
          ARCHIVE_REF: "refs/heads/feat/mail", ARCHIVE_WORKFLOW: "nightly-image.yml", GITHUB_REPOSITORY: "example/courtside",
          RUNNER_TEMP: join(root, "runner")
        } });
        // then
        assert.equal(result.status === 0, matching, result.stderr);
        const calls = readFileSync(join(root, "calls.log"), "utf8");
        if (source === "registry") assert.match(calls, /stalwart-store-transition-smoke\.mjs --candidate .*courtside-deployment-0\.4\.0-nightly\.7/);
        else assert.match(calls, /installed-upgrade-gate\.mjs .*--journey stalwart-store-transition/);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
}

test("given a failed store transition, when the mail gate records its result, then the redacted failure evidence is retained", () => {
  // given
  const step = gates.jobs.mail.steps.find((entry) => entry.name === "Record the Stalwart result");
  const upload = gates.jobs.mail.steps.find((entry) => entry.with?.name === "deployment-mail-qualification");
  // when / then
  assert.equal(step.if, "always()");
  assert.match(step.run, /cp build\/stalwart-store-transition\/failure\.json build\/deployment-mail\//,
    "the retained mail artifact must carry the transition's failure.json");
  assert.equal(upload.if, "always()");
  assert.match(upload.with.path, /^\s*build\/deployment-mail\s*$/m);
});

function stepsUsing(job, uses) {
  return (gates.jobs[job].steps ?? []).filter((step) => String(step.uses ?? "").startsWith(uses));
}

test("given a failed active assessment, when CI retains its first attempt, then normalized tool evidence survives without private runtime data", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "active-assessment-evidence-"));
  const runId = "run-0001";
  const evidence = join(directory, "build/security", runId, "assessment/attempt-1/evidence");
  mkdirSync(evidence, { recursive: true });
  for (const name of ["openapi-fuzz.json", "authenticated-zap.json", "authorization-matrix.json"])
    writeFileSync(join(evidence, name), JSON.stringify({ source: name }));
  writeFileSync(join(evidence, "state-native.json"), "private-data");
  const step = gates.jobs["active-security"].steps.find((entry) =>
    entry.name === "Retain normalized first-attempt tool evidence");

  // when
  assert.ok(step, "CI must retain normalized first-attempt tool evidence");
  const result = spawnSync("bash", ["-e", "-c", step.run], {
    cwd: directory, encoding: "utf8", env: { PATH: process.env.PATH, RUN_ID: runId }
  });

  // then
  assert.equal(step.if, "always()");
  assert.equal(result.status, 0, result.stderr);
  for (const name of ["openapi-fuzz.json", "authenticated-zap.json", "authorization-matrix.json"])
    assert.deepEqual(JSON.parse(readFileSync(join(directory, "build/security-gate", name), "utf8")), { source: name });
  assert.equal(existsSync(join(directory, "build/security-gate/state-native.json")), false);
  const upload = stepsUsing("active-security", "actions/upload-artifact")[0];
  assert.deepEqual(upload.with.path.trim().split("\n").sort(), [
    "build/security-gate/active-security-summary.json", "build/security-gate/authenticated-zap.json",
    "build/security-gate/authorization-matrix.json", "build/security-gate/manifest.json",
    "build/security-gate/openapi-fuzz.json"
  ]);
});

test("given an active assessment that stopped before one tool wrote evidence, when CI retains its first attempt, then the run names the missing record", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "active-assessment-missing-evidence-"));
  const runId = "run-0002";
  const evidence = join(directory, "build/security", runId, "assessment/attempt-1/evidence");
  mkdirSync(evidence, { recursive: true });
  for (const name of ["openapi-fuzz.json", "authenticated-zap.json"]) writeFileSync(join(evidence, name), "{}");
  const step = gates.jobs["active-security"].steps.find((entry) =>
    entry.name === "Retain normalized first-attempt tool evidence");

  // when
  const result = spawnSync("bash", ["-e", "-c", step.run], {
    cwd: directory, encoding: "utf8", env: { PATH: process.env.PATH, RUN_ID: runId }
  });

  // then
  assert.equal(result.status, 0, "a missing record must not hide the assessment's own outcome");
  assert.match(result.stdout, /^::warning::.*authorization-matrix\.json/m, "the absent record is named in the run");
  assert.doesNotMatch(result.stdout, /openapi-fuzz\.json|authenticated-zap\.json/, "only absent records are reported");
});

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
  assert.doesNotMatch(gatesSource, /push: true|docker push/,
    "no gate step writes to a registry; the installed upgrade pushes only to its own loopback stand-in");
});

test("given an image from a pull request, when the gates run, then the shipped launcher installs and updates it by digest", () => {
  // given
  const job = gates.jobs["installed-upgrade"];
  const steps = job?.steps ?? [];
  const checkout = steps.find((step) => String(step.uses ?? "").startsWith("actions/checkout"));
  const image = steps.find((step) => step.id === "image");
  const smoke = steps.find((step) => /node tools\/installed-upgrade-gate\.mjs/.test(step.run ?? ""));
  const upload = steps.find((step) => String(step.uses ?? "").startsWith("actions/upload-artifact"));

  // when / then
  assert.ok(job, "a pull request must prove the installed update the nightly proves in its qualification");
  assert.equal(job.if, "inputs.image-source == 'artifact'", "the nightly and the candidate qualify a pushed image themselves");
  assert.deepEqual(Object.keys(job.permissions).sort(), ["actions", "contents"], "the job needs no registry scope");
  assert.equal(checkout.with["fetch-depth"], 0, "the smoke archives the published origin's deployment from history");
  assert.equal(checkout.with.ref, "${{ inputs.source-commit }}");
  assert.equal(image.uses, "./.github/actions/gate-image");
  assert.equal(image.with.load ?? action.inputs.load.default, "true", "the stand-in registry serves the loaded image");
  assert.equal(image.with.artifact, "${{ inputs.image-artifact }}");
  assert.match(smoke.run, /--confirm installed-upgrade-gate/);
  for (const input of ["image-digest", "booking-seed-digest", "archive-version", "archive-ref", "archive-workflow",
    "source-commit"]) {
    assert.ok(Object.values(smoke.env).includes(`\${{ inputs.${input} }}`), `the smoke archives the candidate with ${input}`);
  }
  assert.equal(upload.if, "always()", "a failed update keeps its evidence and the registry log");
  assert.deepEqual(upload.with.path.trim().split("\n").sort(),
    ["build/installed-database-upgrade", "build/installed-upgrade-gate"]);
});

test("given an image from a pull request, when the gates run, then only the npm audit and the release record stay out", () => {
  // given
  const registryOnly = ["npm-audit", "security-record"];
  const artifactOnly = ["installed-upgrade"];

  // when / then
  for (const job of registryOnly) {
    assert.equal(gates.jobs[job].if, "inputs.image-source == 'registry'", `${job} must not run on a PR image`);
  }
  for (const job of artifactOnly) {
    assert.equal(gates.jobs[job]?.if, "inputs.image-source == 'artifact'", `${job} repeats the nightly qualification`);
  }
  for (const [name, job] of Object.entries(gates.jobs)
    .filter(([name]) => !registryOnly.includes(name) && !artifactOnly.includes(name))) {
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
  for (const job of ["archive-reproducibility"]) {
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

test("given the mail transition needs artifact image bytes, when the job resolves them, then it loads the shared image bundle", () => {
  // given
  const app = stepsUsing("mail", "./.github/actions/gate-image").find((step) => step.id === "image");
  const seed = stepsUsing("mail", "./.github/actions/gate-image").find((step) => step.id === "booking-seed");
  const transition = gates.jobs.mail.steps.find((step) => step.id === "transition");
  // then
  assert.equal(app.with.load ?? action.inputs.load.default, "true");
  assert.equal(app.with.artifact, "${{ inputs.image-artifact }}");
  assert.equal(app.with["run-id"], "${{ inputs.artifacts-run-id || github.run_id }}");
  assert.equal(seed.with.load, "false", "the first load already carries both images");
  assert.equal(transition.env.IMAGE, "${{ steps.image.outputs.reference }}");
  assert.equal(transition.env.BOOKING_SEED_IMAGE, "${{ steps.booking-seed.outputs.reference }}");
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
  assert.deepEqual([...new Set(browser.strategy.matrix.include.map(({ group }) => group))],
    ["functional", "phone-iphone", "phone-android", "chromium-accessibility", "webkit-accessibility"]);
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
  environment.BACKEND_COVERAGE_RESULT = environment.BACKEND_RESULT;
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

test("given split backend tests, when the aggregate decides, then only shards and a merged coverage check together pass", () => {
  // when / then
  assert.equal(aggregate("pull_request", {}), 0, "shards and coverage succeeded");
  assert.notEqual(aggregate("pull_request", { BACKEND_COVERAGE_RESULT: "failure" }), 0, "coverage below its floor");
  assert.notEqual(aggregate("pull_request", { BACKEND_COVERAGE_RESULT: "skipped" }), 0, "shards without the coverage check");
  assert.notEqual(aggregate("pull_request", { BACKEND_COVERAGE_RESULT: "success" }, { backend: false }), 0,
    "a coverage check for an unselected backend");
  assert.equal(aggregate("pull_request", {}, { backend: false }), 0, "an unselected backend and no coverage check");
  assert.notEqual(aggregate("push", { GATES_RESULT: "skipped", GATES_IMAGE_RESULT: "skipped", CLOCK_SHIFT_RESULT: "skipped",
    BACKEND_COVERAGE_RESULT: "skipped" }), 0, "a push always checks the merged coverage");
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
