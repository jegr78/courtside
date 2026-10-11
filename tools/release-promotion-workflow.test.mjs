import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const releaseText = read(".github/workflows/release.yml");
const release = yaml.load(releaseText);
const candidate = yaml.load(read(".github/workflows/release-candidate.yml"));
const releasePlease = yaml.load(read(".github/workflows/release-please.yml"));

const stepsText = (job) => yaml.dump(job.steps ?? [], { lineWidth: -1 });

test("given a release tag, when the release runs, then it promotes the candidate and builds nothing again", () => {
  // when / then
  assert.deepEqual(Object.keys(release.jobs), ["candidate", "publish", "plan-sync"],
    "a build, browser, image, qualify or gates job in release.yml repeats what the candidate already proved");
  assert.doesNotMatch(releaseText, /docker\/build-push-action|\.\/mvnw|release-gates\.yml|test:e2e|github\/codeql-action/,
    "the tag run neither builds an image nor runs a test suite or gate");
});

test("given a release tag, when the candidate is looked up, then only verified release evidence for the tagged commit is promoted", () => {
  // given
  const lookup = stepsText(release.jobs.candidate);

  // when / then
  assert.match(lookup, /node tools\/release-candidate-evidence\.mjs --find --commit "\$GITHUB_SHA" --mode release/);
  assert.match(lookup, /node tools\/release-candidate-evidence\.mjs --verify[\s\S]+--commit "\$GITHUB_SHA"[\s\S]+--version "\$\{GITHUB_REF_NAME#v\}"[\s\S]+--mode release[\s\S]+--archive /,
    "the version comes from the tag, and the downloaded archive must carry the qualified checksum");
  assert.match(lookup, /Refuse a tag that does not sit on main/);
  assert.match(lookup, /Refuse a tag the repository does not record as its release/);
});

test("given the promoted candidate, when publish addresses an image, then every digest comes from the verified evidence", () => {
  // given
  const publish = stepsText(release.jobs.publish);
  const imageReferences = [...publish.matchAll(/@\$\{\{ ([^}]+) \}\}/g)].map((match) => match[1].trim());
  const subjectDigests = [...publish.matchAll(/subject-digest: \$\{\{ ([^}]+) \}\}/g)].map((match) => match[1].trim());

  // when / then
  assert.ok(imageReferences.length >= 4 && subjectDigests.length === 4, "publish signs, attests and tags both images");
  assert.deepEqual([...new Set([...imageReferences, ...subjectDigests])].toSorted(),
    ["needs.candidate.outputs.booking-seed-digest", "needs.candidate.outputs.image-digest"],
    "a digest from anywhere but the verified record would publish something the candidate never qualified");
  assert.deepEqual(release.jobs.publish.needs, ["candidate"]);
});

test("given the promoted candidate, when publish downloads its inputs, then they come from the qualifying run and the archive is checked again", () => {
  // given
  const downloads = release.jobs.publish.steps.filter((step) => /actions\/download-artifact@/.test(step.uses ?? ""));

  // when / then
  assert.deepEqual(downloads.map((step) => step.with.name).toSorted(),
    ["deployment-archive", "image-input", "release-security-record-input"]);
  for (const step of downloads) {
    assert.equal(step.with["run-id"], "${{ needs.candidate.outputs.run-id }}", `${step.with.name} comes from the candidate run`);
    assert.equal(step.with["github-token"], "${{ github.token }}");
  }
  const steps = release.jobs.publish.steps;
  const recheck = steps.find((step) => step.name === "Require the archive the candidate qualified");
  assert.equal(recheck?.env.ARCHIVE_SHA256, "${{ needs.candidate.outputs.archive-sha256 }}");
  assert.match(recheck.run, /echo "\$ARCHIVE_SHA256  build\/courtside-deployment-\$\{GITHUB_REF_NAME#v\}\.zip" \| sha256sum -c -/,
    "an archive whose bytes differ from the evidence would be attested and attached");
  assert.ok(steps.indexOf(recheck) < steps.findIndex((step) => step.id === "archive-provenance"));
  assert.equal(release.jobs.publish.permissions.actions, "read", "another run's artifacts need actions: read");
});

test("given a transparency-log outage, when publish fails, then the failure names the step and the recovery", () => {
  // given
  const steps = release.jobs.publish.steps;
  const explain = steps.at(-1);

  // when / then
  assert.equal(explain.if, "failure()");
  assert.match(explain.run, /Re-run failed jobs on[\s\S]+\/actions\/runs\/\$GITHUB_RUN_ID/);
  assert.match(explain.run, /rekor\.sigstore\.dev/);
  assert.equal(explain.env.STEPS, "${{ toJSON(steps) }}", "the failure lists the steps whose outcome was failure");
  for (const step of steps.filter((each) => /attest-|sbom-action|cosign sign/.test(`${each.uses ?? ""} ${each.run ?? ""}`))) {
    assert.ok(step.id, `${step.name ?? step.uses} has an id, so the failure can name it`);
  }
});

test("given a green push build of a release commit, when it completes, then the candidate qualifies that commit", () => {
  // given
  const triggers = candidate.on;
  const selection = candidate.jobs.select.steps.find((step) => step.id === "selection");

  // when / then
  assert.deepEqual(triggers.workflow_run, { workflows: ["build"], types: ["completed"], branches: ["main"] });
  assert.ok(triggers.workflow_dispatch, "a maintainer can still rehearse or re-run a candidate");
  assert.equal(selection.env.REQUESTED_COMMIT,
    "${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || inputs.commit }}");
});

test("given qualified release evidence, when the candidate finishes, then it alone writes the tag through the release token", () => {
  // given
  const tag = candidate.jobs.tag;
  const write = tag.steps.find((step) => step.name === "Write the tag at the qualified commit");
  const relabel = tag.steps.find((step) => step.name === "Mark the release pull request as tagged");

  // when / then
  assert.deepEqual(tag.needs, ["select", "evidence"]);
  assert.match(tag.if, /needs\.evidence\.result == 'success'/);
  assert.match(tag.if, /needs\.select\.outputs\.rehearsal != 'true'/);
  assert.deepEqual(tag.permissions, {}, "the tag job writes through the release token alone");
  assert.equal(tag.env.COMMIT, "${{ needs.select.outputs.commit }}");
  assert.equal(candidate.jobs.select.outputs["pending-pull-request"], "${{ steps.selection.outputs.pending-pull-request }}");
  for (const step of [write, relabel]) {
    assert.equal(step.env.GH_TOKEN, "${{ secrets.RELEASE_PLEASE_TOKEN }}", "a tag pushed with GITHUB_TOKEN starts no release run");
  }
  assert.match(write.run, /git\/refs" -f ref="refs\/tags\/\$TAG" -f sha="\$COMMIT"/,
    "the tag names the commit the candidate qualified, created once and never moved");
  assert.match(write.run, /\[ "\$tagged" = "\$COMMIT" \]/);
  assert.match(relabel.run, /--remove-label "autorelease: pending" --add-label "autorelease: tagged"/,
    "release-please opens no further release pull request while a merged one is still pending");
  assert.ok(tag.steps.indexOf(write) < tag.steps.indexOf(relabel), "a pull request is never marked tagged without its tag");
});

test("given a merged release pull request, when release-please runs on main, then it leaves the tag to the qualified candidate", () => {
  // given
  const action = releasePlease.jobs["release-please"].steps.find((step) => step.id === "release");

  // when / then
  assert.equal(action.with["skip-github-release"], true,
    "a tag written at merge time would start the release before any candidate qualified the commit");
});
