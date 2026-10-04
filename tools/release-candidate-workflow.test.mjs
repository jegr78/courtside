import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { artifactNameOf, candidateJobs, verifyCandidateEvidence } from "./release-candidate-evidence.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const read = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
const source = read(".github/workflows/release-candidate.yml");
const candidate = yaml.load(source);
const jobs = candidate.jobs;
const gates = yaml.load(read(".github/workflows/release-gates.yml")).jobs;

function jobText(name) {
  return yaml.dump(jobs[name], { lineWidth: -1 });
}

function step(job, name) {
  const found = jobs[job].steps.find((entry) => entry.name === name || entry.id === name);
  assert.ok(found, `${job} has no step ${name}`);
  return found;
}

test("given a candidate, when it qualifies, then the archive names the release identity that will attest it", () => {
  // when / then
  assert.match(source, /--workflow release\.yml --ref "refs\/tags\/\$TAG"/);
  assert.match(source, /archive-workflow: release\.yml/);
  assert.match(source, /archive-ref: refs\/tags\/\$\{\{ needs\.select\.outputs\.tag \}\}/);
});

test("given a candidate, when evidence is recorded, then it waits for every gate and the preconditions", () => {
  // when / then
  assert.deepEqual(jobs.evidence.needs, ["select", ...candidateJobs]);
  assert.equal(jobs.evidence.if, "${{ always() && needs.select.outputs.release == 'true' }}",
    "a failed gate must reach the evidence job so that its refusal is recorded as a red run");
});

test("given a candidate, when it builds, then it neither stamps a version nor reruns the exact-sha build", () => {
  // when / then
  assert.doesNotMatch(source, /versions:set/);
  assert.doesNotMatch(source, /mvnw -B verify/);
  assert.doesNotMatch(source, /run test:e2e/);
  assert.match(step("release-build", "Package the selected commit").run, /^\.\/mvnw -B package -DskipTests$/);
});

test("given every job that checks out source, when the candidate runs, then it checks out the selected commit", () => {
  // when
  const checkouts = Object.entries(jobs).filter(([name]) => name !== "select" && name !== "gates")
    .flatMap(([name, job]) => job.steps.filter((entry) => String(entry.uses).startsWith("actions/checkout"))
      .map((entry) => [name, entry.with?.ref]));

  // then
  assert.ok(checkouts.length >= 6, "the candidate jobs check out source");
  for (const [name, ref] of checkouts) {
    assert.equal(ref, "${{ needs.select.outputs.commit }}", `${name} would build the dispatch ref`);
  }
});

test("given a dispatch on any ref, when the candidate runs, then nothing reads the dispatch commit or ref", () => {
  // when / then
  for (const forbidden of [/github\.sha/, /GITHUB_SHA/, /github\.ref\b/, /GITHUB_REF\b/, /GITHUB_REF_NAME/,
    /github\.ref_name/]) {
    assert.doesNotMatch(source, forbidden, `the selected commit, version and tag replace ${forbidden}`);
  }
});

test("given the rehearsal pipeline, when it runs, then it can be dispatched only and writes no tag or release", () => {
  // when / then
  assert.deepEqual(Object.keys(candidate.on), ["workflow_dispatch"]);
  assert.equal(candidate.on.workflow_dispatch.inputs.commit.required, true);
  assert.equal(candidate.on.workflow_dispatch.inputs.rehearsal.default, true,
    "until the promotion reads candidates, every dispatch is a rehearsal unless someone says otherwise");
  assert.equal(jobs.tag, undefined);
  assert.deepEqual(candidate.permissions, {});
  for (const forbidden of [/RELEASE_PLEASE_TOKEN/, /release-please-action/, /git\/refs/, /action-gh-release/,
    /gh release/, /contents: write/, /imagetools create/]) {
    assert.doesNotMatch(source, forbidden, `the candidate must not ${forbidden}`);
  }
  assert.equal(candidate.concurrency.group, "release-candidate");
  assert.equal(candidate.concurrency["cancel-in-progress"], false);
});

test("given a dispatch, when the candidate selects, then the selection tool decides for every later job", () => {
  // given
  const selection = step("select", "selection");

  // when / then
  assert.match(selection.run, /node tools\/release-candidate-selection\.mjs/);
  assert.match(selection.run, /--event "\$EVENT" --commit "\$REQUESTED_COMMIT" --rehearsal "\$REHEARSAL"/);
  assert.match(selection.run, /--github-output "\$GITHUB_OUTPUT"/);
  assert.deepEqual(selection.env, { GH_TOKEN: "${{ github.token }}", EVENT: "${{ github.event_name }}",
    REQUESTED_COMMIT: "${{ inputs.commit }}", REHEARSAL: "${{ inputs.rehearsal }}" });
  for (const output of ["release", "commit", "version", "tag", "rehearsal"]) {
    assert.equal(jobs.select.outputs[output], `\${{ steps.selection.outputs.${output} }}`);
  }
  assert.equal(jobs.select.steps[0].with["fetch-depth"], 0, "ancestry checks need the whole history");
  assert.deepEqual(jobs.select.permissions, { actions: "read", contents: "read", issues: "read", "pull-requests": "read" },
    "the selection lists labelled release pull requests through the issues endpoint");
  for (const job of ["preconditions", "release-build"]) {
    assert.equal(jobs[job].if, "needs.select.outputs.release == 'true'", `${job} runs without a selected candidate`);
  }
});

test("given a candidate, when its preconditions run, then a nightly verified an ancestor and no nightly failure is open", () => {
  // given
  const gate = jobText("preconditions");

  // when / then
  assert.match(gate, /actions\/workflows\/build\.yml\/runs\?branch=\$\{DEFAULT_BRANCH\}&status=success/);
  assert.match(gate, /select\(\.event == "schedule" or \.event == "workflow_dispatch"\)/);
  assert.match(gate, /select\(\.run_attempt == 1\)/);
  assert.match(gate, /git merge-base --is-ancestor "\$head" "\$COMMIT"/);
  assert.match(gate, /nightly-release-evidence-\$\{id\}-1/);
  assert.match(gate, /node tools\/nightly-release-evidence\.mjs/);
  assert.ok(gate.indexOf("gh run download") < gate.indexOf("node tools/nightly-release-evidence.mjs"));
  assert.match(gate, /no green first-attempt build with a completed nightly release rehearsal verified a commit this candidate builds on/);
  assert.match(gate, /issues\?state=open&labels=nightly&per_page=100/);
  assert.match(gate, /courtside-nightly-fingerprint/);
  assert.match(gate, /select\(\.body \| contains\("- Workflow: `npm audit`"\) \| not\)/);
  assert.deepEqual(jobs.preconditions.permissions, { actions: "read", contents: "read", issues: "read" });
  assert.equal(jobs.preconditions.steps[0].with["fetch-depth"], 0);
});

test("given a candidate build, when security and dependency policy run, then they bind the selected commit", () => {
  // given
  const build = jobText("release-build");

  // when / then
  assert.deepEqual(jobs["release-build"].permissions, { actions: "read", contents: "read",
    "security-events": "write", "vulnerability-alerts": "read" });
  assert.match(build, /npm-cli\.js run audit:security --[\s\\]+--output \.\.\/build\/security\/npm\.json/);
  assert.match(build, /github\/codeql-action\/init@[a-f0-9]{40}/);
  assert.match(build, /github\/codeql-action\/analyze@[a-f0-9]{40}/);
  assert.match(build, /--scope release-build/);
  assert.match(build, /--subject "\$COMMIT"[\s\S]+node tools\/dependency-remediation\.mjs/);
  assert.match(build, /--current-summary build\/security\/release-build\.json/);
  assert.match(build, /id: release-security[\s\S]+continue-on-error: true[\s\S]+Require completed release security gates/);
  assert.match(build, /actions\/artifacts\?per_page=100[\s\S]+gh run download[\s\S]+--previous-evidence/);
  assert.equal(step("release-build", "release-security")["continue-on-error"], true);
  assert.equal(step("release-build", "Require completed release security gates").if, "always()");
  assert.ok(jobs["release-build"]["timeout-minutes"] <= 45);
});

test("given a candidate build, when its notes and origins are collected, then they start at the selected tag and commit", () => {
  // given
  const build = jobText("release-build");
  const collect = step("release-build", "Collect the upgrade notes").run;

  // when / then
  assert.match(build, /node tools\/release-notes\.mjs[\s\S]+--tag "\$TAG"[\s\S]+--output build\/release-body\.md/);
  assert.match(collect, /--previous-release[\s\\]+"\$TAG"/);
  assert.match(collect, /"\$previous\.\.\$COMMIT"/);
  assert.match(collect, /if \[ -z "\$previous" \]; then[\s\S]+First public release; no prior supported version to upgrade from\./);
  assert.match(step("release-build", "upgrade-origins").run, /--origins "\$TAG"/);
  assert.equal(jobs["release-build"].outputs["upgrade-origins"], "${{ steps.upgrade-origins.outputs.origins }}");
  const notes = jobs["release-build"].steps.find((entry) => entry.with?.name === "release-notes");
  assert.equal(notes?.with.path, "build/release-body.md", "the promotion publishes the notes the candidate wrote");
  assert.match(build, /name: assessment-fixtures\n\s+path: target\/fixtures-classes/);
  assert.match(build, /cp -R target\/fixtures-classes build\/fixtures\/classes/);
  assert.equal(jobs["release-build"].env.VERSION, "${{ needs.select.outputs.version }}");
  assert.match(step("release-build", "Extract the layers").run, /target\/courtside-\$VERSION\.jar/);
});

test("given a candidate image, when it is built, then it carries the selected revision and shares the registry lock", () => {
  // given
  const image = jobText("image");

  // when / then
  assert.equal(jobs.image.concurrency.group, "container-registry-${{ github.repository }}");
  assert.equal(jobs.image.concurrency["cancel-in-progress"], false);
  assert.match(image, /tags: ghcr\.io\/\$\{\{ github\.repository \}\}:release-candidate-\$\{\{ needs\.select\.outputs\.commit \}\}/);
  assert.match(image, /tags: ghcr\.io\/\$\{\{ github\.repository \}\}:booking-seed-release-candidate-\$\{\{ needs\.select\.outputs\.commit \}\}/);
  assert.match(image, /org\.opencontainers\.image\.revision=\$\{\{ needs\.select\.outputs\.commit \}\}/);
  assert.doesNotMatch(image, /metadata-action/, "the metadata action labels the dispatch commit, not the selected one");
  assert.match(image, /file: Dockerfile\.fixtures/);
  assert.match(image, /build-args: BASE_IMAGE=ghcr\.io\/\$\{\{ github\.repository \}\}@\$\{\{ steps\.push\.outputs\.digest \}\}/);
  assert.equal(jobs.image.outputs["booking-seed-digest"], "${{ steps.booking-seed-push.outputs.digest }}");
});

test("given a candidate archive, when it is built, then deploy/ is the selected commit's own", () => {
  // when / then
  assert.match(step("archive", "Build the deployment archive").run, /git status --porcelain --ignored -- deploy\//);
  assert.match(source, /archive-artifact: deployment-archive\n/);
});

test("given a candidate image, when it is qualified, then the same digest passes on every architecture", () => {
  // given
  const qualify = jobText("qualify");

  // when / then
  assert.deepEqual(jobs.qualify.needs, ["select", "archive", "image"]);
  assert.deepEqual(jobs.qualify.strategy.matrix.include, [
    { architecture: "amd64", "runs-on": "ubuntu-latest" },
    { architecture: "arm64", "runs-on": "ubuntu-24.04-arm" }
  ]);
  assert.equal(jobs.qualify.env.COURTSIDE_UAT_VERSION,
    "release-candidate-${{ needs.select.outputs.commit }}@${{ needs.image.outputs.digest }}");
  assert.match(qualify, /node tools\/courtside\.uat-smoke\.mjs --confirm courtside-uat/);
  assert.match(qualify, /deployment-qualification\.mjs --inspect-archive/);
  assert.match(qualify, /--recipes standard,full-self-hosted,existing-infrastructure,funnel/);
  assert.match(qualify, /name: Upgrade an installed PostgreSQL 17 nightly through the shipped launcher/);
  assert.match(qualify, /node tools\/installed-upgrade-smoke\.mjs[\s\S]+--confirm installed-postgresql-upgrade/);
  assert.equal(step("qualify", "Upgrade an installed PostgreSQL 17 nightly through the shipped launcher").if,
    "matrix.architecture == 'amd64'");
  assert.match(qualify, /docker compose[\s\S]+config --quiet/);
  assert.match(qualify, /aquasecurity\/trivy-action@[a-f0-9]{40}/);
  assert.match(qualify, /security\/exceptions\.json/);
  assert.match(qualify, /security-summary-\$\{\{ matrix\.architecture \}\}\.json/);
  assert.match(qualify, /trivy-booking-seed-\$\{\{ matrix\.architecture \}\}\.json/);
  assert.match(qualify, /--subject \$\{\{ needs\.image\.outputs\.booking-seed-digest \}\}/);
  assert.match(qualify, /COURTSIDE_UAT_BOOKING_SEED_IMAGE: ghcr\.io\/\$\{\{ github\.repository \}\}@\$\{\{ needs\.image\.outputs\.booking-seed-digest \}\}/);
  assert.match(qualify, /if \[\[ ! -s build\/uat-smoke\/container-logs\.txt \]\]/);
  assert.equal(jobs.qualify.steps[0].with["fetch-depth"], 0);
});

test("given a qualified candidate, when the gates run, then they bind its exact digests, archive and origins", () => {
  // given
  const call = jobs.gates;

  // when / then
  assert.equal(call.uses, "./.github/workflows/release-gates.yml");
  assert.deepEqual(call.needs, ["select", "release-build", "image", "archive", "qualify"]);
  assert.deepEqual(call.with, {
    "image-digest": "${{ needs.image.outputs.digest }}",
    "booking-seed-digest": "${{ needs.image.outputs.booking-seed-digest }}",
    "source-commit": "${{ needs.select.outputs.commit }}",
    "run-label": "release",
    "archive-artifact": "deployment-archive",
    "archive-version": "${{ needs.select.outputs.version }}",
    "archive-ref": "refs/tags/${{ needs.select.outputs.tag }}",
    "archive-workflow": "release.yml",
    "qualification-artifact-prefix": "image-qualification-",
    "fixtures-artifact": "assessment-fixtures",
    "security-base-artifact": "release-security-base",
    "upgrade-origins": "${{ needs.release-build.outputs.upgrade-origins }}"
  });
  assert.deepEqual(call.permissions, { actions: "read", contents: "read", packages: "read" });
  const download = gates["active-security"].steps.find((entry) =>
    entry.with?.name === "${{ inputs.qualification-artifact-prefix }}amd64");
  assert.equal(download.with.path, "build/uat-smoke");
  assert.equal(jobs.qualify.steps.find((entry) => entry.with?.name === "image-qualification-${{ matrix.architecture }}")
    .with.path.trim(), "build/uat-smoke", "the qualification artifact is rooted where the active assessment reads it");
});

test("given a candidate archive, when any candidate job inspects it, then the booking-seed digest is bound as well", () => {
  // given
  const inspections = Object.entries(jobs).flatMap(([job, { steps = [] }]) => steps
    .filter((entry) => entry.run?.includes("--inspect-archive")).map((entry) => ({ job, entry })));

  // when / then
  assert.ok(inspections.length > 0);
  for (const { job, entry } of inspections) {
    assert.match(entry.run, /--booking-seed-image "\$BOOKING_SEED_IMAGE"/, `${job} passes the booking-seed image`);
    assert.equal(entry.env?.BOOKING_SEED_IMAGE,
      "ghcr.io/${{ github.repository }}@${{ needs.image.outputs.booking-seed-digest }}", `${job} binds the digest`);
  }
});

function matcher(glob) {
  const literal = glob.split("*").map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${literal.join(".*")}$`);
}

test("given an artifact another candidate job downloads, when it is uploaded, then it has one root directory", () => {
  // given
  const stepsOf = (job) => jobs[job].steps ?? [];
  const uploads = new Map(Object.keys(jobs).flatMap((job) => stepsOf(job)
    .filter((entry) => entry.uses?.startsWith("actions/upload-artifact@"))
    .map((entry) => [entry.with.name, entry.with.path])));
  const downloaded = Object.keys(jobs).flatMap((job) => stepsOf(job)
    .filter((entry) => entry.uses?.startsWith("actions/download-artifact@"))
    .map((entry) => entry.with.name ?? entry.with.pattern));

  // then
  for (const [name, path] of uploads) {
    const uploaded = matcher(name.replaceAll(/\$\{\{[^}]+\}\}/g, "*"));
    if (!downloaded.some((pattern) => uploaded.test(pattern) || matcher(pattern).test(name))) continue;
    const roots = new Set(String(path).split("\n").map((line) => line.trim())
      .filter((line) => line && !line.startsWith("!"))
      .map((line) => (/\.[a-z]+$/.test(line) ? dirname(line) : line)));
    assert.equal(roots.size, 1, `${name} keeps the layout its consumers read`);
  }
});

test("given a green candidate, when its evidence job runs, then the record it writes is one the promotion accepts", () => {
  // given
  const record = step("evidence", "Record the candidate");
  const upload = jobs.evidence.steps.find((entry) => String(entry.uses).startsWith("actions/upload-artifact"));
  const commit = "d".repeat(40);
  const directory = mkdtempSync(join(tmpdir(), "courtside-candidate-workflow-"));
  mkdirSync(join(directory, "tools"));
  copyFileSync(fileURLToPath(new URL("./release-candidate-evidence.mjs", import.meta.url)),
    join(directory, "tools/release-candidate-evidence.mjs"));
  mkdirSync(join(directory, "build/archive"), { recursive: true });
  writeFileSync(join(directory, "build/archive/courtside-deployment-0.1.0.zip"), "archive");
  const needs = Object.fromEntries(jobs.evidence.needs.map((job) => [job, { result: "success", outputs: {} }]));

  // when
  execFileSync("bash", ["-c", record.run], {
    cwd: directory,
    env: { ...process.env, COMMIT: commit, VERSION: "0.1.0", REHEARSAL: "true",
      IMAGE_DIGEST: `sha256:${"e".repeat(64)}`, BOOKING_SEED_DIGEST: `sha256:${"f".repeat(64)}`,
      RESULTS: JSON.stringify(needs), GITHUB_REPOSITORY: "jegr78/courtside", GITHUB_RUN_ID: "7",
      GITHUB_RUN_ATTEMPT: "1", GITHUB_REF: "refs/heads/ci/release-candidate-rehearsal",
      GITHUB_WORKFLOW_REF: "jegr78/courtside/.github/workflows/release-candidate.yml@refs/heads/ci/release-candidate-rehearsal" },
    stdio: "pipe"
  });

  // then
  const written = JSON.parse(readFileSync(join(directory, upload.with.path), "utf8"));
  assert.equal(verifyCandidateEvidence(written, { commit, version: "", runId: 7, mode: "rehearsal" }).version, "0.1.0");
  assert.equal(upload.with.name.replace("${{ needs.select.outputs.commit }}", commit), artifactNameOf(commit),
    "the promotion looks the record up by this name");
  assert.deepEqual(Object.keys(record.env).sort(), ["BOOKING_SEED_DIGEST", "COMMIT", "IMAGE_DIGEST", "REHEARSAL",
    "RESULTS", "VERSION"]);
  assert.equal(record.env.RESULTS, "${{ toJSON(needs) }}");
  assert.throws(() => execFileSync("bash", ["-c", record.run], {
    cwd: directory,
    env: { ...process.env, COMMIT: commit, VERSION: "0.1.0", REHEARSAL: "true",
      IMAGE_DIGEST: `sha256:${"e".repeat(64)}`, BOOKING_SEED_DIGEST: `sha256:${"f".repeat(64)}`,
      RESULTS: JSON.stringify({ ...needs, gates: { result: "failure" } }), GITHUB_REPOSITORY: "jegr78/courtside",
      GITHUB_RUN_ID: "7", GITHUB_RUN_ATTEMPT: "1", GITHUB_REF: "refs/heads/main",
      GITHUB_WORKFLOW_REF: "jegr78/courtside/.github/workflows/release-candidate.yml@refs/heads/main" },
    stdio: "pipe"
  }), /gates is failure/, "a red gate leaves no passed record");
});
