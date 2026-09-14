import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const path = new URL("../.github/workflows/nightly-image.yml", import.meta.url);
const source = readFileSync(path, "utf8");
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const workflow = yaml.load(source);
const triggers = workflow.on ?? workflow[true];

test("given the nightly image workflow, when its authority is read, then a verified build and a dispatch can start it", () => {
  // when / then
  assert.deepEqual(Object.keys(triggers).sort(), ["workflow_call", "workflow_dispatch"]);
  assert.equal(triggers.workflow_call.inputs.commit.required, true);
  assert.equal(triggers.workflow_call.inputs.verification_run.required, true);
  assert.equal(triggers.workflow_call.inputs.publish.required, true);
  assert.deepEqual(workflow.permissions, {});
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.ok(job.permissions && Object.keys(job.permissions).length > 0,
      `${name} inherits no authority because it must declare its own`);
  }
});

test("given a verified build call, when its source revision is selected, then only its exact evidence counts", () => {
  // when / then
  const select = source.slice(source.indexOf("  select:"), source.indexOf("\n  package:"));
  assert.doesNotMatch(select, /actions\/workflows\/build\.yml\/runs/);
  assert.match(select, /REQUESTED_COMMIT: \$\{\{ inputs\.commit \}\}/);
  assert.match(select, /REQUESTED_VERIFICATION_RUN: \$\{\{ inputs\.verification_run \}\}/);
  assert.match(select, /nightly-verification-\$\{\{ inputs\.verification_run \}\}-1/);
  assert.doesNotMatch(select, /path:.*inputs\.verification_run/);
  assert.match(select, /evidence="\$RUNNER_TEMP\/nightly-verification"/);
  assert.match(select, /set -euo pipefail/);
  assert.match(select, /"\$verification_run" = "\$GITHUB_RUN_ID"/);
  assert.match(select, /\.releaseReadiness == "complete"/);
  assert.match(select, /\.commit == \$commit and \.runId == \$runId and \.attempt == 1/);
  assert.match(select, /if \[\[ -z "\$verification_run" \]\]/);
  assert.match(select, /commit="\$GITHUB_SHA"/);
  assert.match(select, /REQUESTED_PUBLISH: \$\{\{ inputs\.publish \}\}/);
});

test("given a complete build, when it finishes, then it calls the image workflow with the same revision and evidence", () => {
  // given
  const buildSource = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
  const buildWorkflow = yaml.load(buildSource);
  const image = buildWorkflow.jobs["nightly-image"];

  // when / then
  assert.equal(image.needs, "build");
  assert.match(String(image.if), /github\.event_name == 'schedule'/);
  assert.match(String(image.if), /github\.event_name == 'workflow_dispatch'/);
  assert.match(String(image.if), /github\.ref == 'refs\/heads\/main'/);
  assert.equal(image.uses, "./.github/workflows/nightly-image.yml");
  assert.equal(image.with.commit, "${{ github.sha }}");
  assert.equal(image.with.verification_run, "${{ github.run_id }}");
  assert.equal(image.with.publish, "${{ github.ref == 'refs/heads/main' }}");
  const evidence = buildWorkflow.jobs["nightly-release-evidence"];
  assert.deepEqual(evidence.needs, ["build", "nightly-image"]);
  assert.match(String(evidence.if), /github\.event_name == 'schedule'/);
  assert.match(String(evidence.if), /github\.event_name == 'workflow_dispatch'/);
  assert.match(String(evidence.if), /github\.ref == 'refs\/heads\/main'/);
  assert.equal(workflow.concurrency.group, "nightly-image-${{ github.repository }}");
});

test("given the current nightly already carries a revision, when selection finishes, then image work is skipped", () => {
  // when / then
  assert.match(source, /docker image inspect[\s\S]+org\.opencontainers\.image\.revision/);
  assert.match(source, /if \[\[ "\$published_revision" = "\$commit" \]\]/);
  for (const job of ["package", "image", "qualify"]) {
    assert.match(String(workflow.jobs[job].if), /needs\.select\.outputs\.build == 'true'/,
      `${job} does not obey the no-change selection`);
  }
});

test("given a new verified revision, when its image is built, then one candidate carries both architectures and the revision", () => {
  // given
  const image = source.slice(source.indexOf("  image:"), source.indexOf("\n  qualify:"));

  // when / then
  assert.match(source, /\.\/mvnw -B package -DskipTests/);
  assert.match(source, /retention-days: 1/);
  assert.match(image, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(image, /ghcr\.io\/\$\{\{ github\.repository \}\}:nightly-candidate/);
  assert.match(image, /org\.opencontainers\.image\.revision=\$\{\{ needs\.select\.outputs\.commit \}\}/);
  assert.match(image, /org\.opencontainers\.image\.source=https:\/\/github\.com\/\$\{\{ github\.repository \}\}/);
  const tags = workflow.jobs.image.steps.find((step) => step.uses?.startsWith("docker/build-push-action")).with.tags;
  assert.equal(tags, "ghcr.io/${{ github.repository }}:nightly-candidate");
});

test("given a pull-request branch dispatch, when the candidate runs, then it uses the real image and qualification jobs without publishing", () => {
  // when / then
  assert.deepEqual(workflow.jobs.package.needs, "select");
  assert.deepEqual(workflow.jobs.image.needs, ["select", "package"]);
  assert.deepEqual(workflow.jobs.qualify.needs, ["select", "image"]);
  assert.match(source, /publish=false/);
  assert.match(String(workflow.jobs.publish.if), /needs\.select\.outputs\.publish == 'true'/);
  assert.match(String(workflow.jobs.retention.if), /needs\.select\.outputs\.publish == 'true'/);
});

test("given a candidate digest, when it is qualified, then both architectures run deployment and image security gates", () => {
  // given
  const qualify = workflow.jobs.qualify;

  // when / then
  assert.deepEqual(qualify.strategy.matrix.include, [
    { architecture: "amd64", "runs-on": "ubuntu-latest" },
    { architecture: "arm64", "runs-on": "ubuntu-24.04-arm" },
  ]);
  const text = source.slice(source.indexOf("  qualify:"), source.indexOf("\n  publish:"));
  assert.match(text, /node tools\/courtside\.uat-smoke\.mjs --confirm courtside-uat/);
  assert.match(text, /aquasecurity\/trivy-action@[0-9a-f]{40}/);
  assert.match(text, /--scope release-image-\$\{\{ matrix\.architecture \}\}/);
  assert.match(text, /ghcr\.io\/\$\{\{ github\.repository \}\}@\$\{\{ needs\.image\.outputs\.digest \}\}/);
  assert.match(text, /if \[\[ ! -s build\/uat-smoke\/container-logs\.txt \]\]/);
});

test("given the runtime base image, when the Courtside image is assembled, then its unused ACME test server is removed", () => {
  // when / then
  assert.match(dockerfile, /rm -f \/usr\/bin\/pebble/);
});

test("given a qualified main image, when it is published, then verified evidence precedes the two nightly tags", () => {
  // given
  const publish = source.slice(source.indexOf("\n  publish:\n"), source.indexOf("\n  retention:\n"));

  // when / then
  assert.match(source, /if \[\[ "\$publish" = true && "\$GITHUB_REF" != 'refs\/heads\/main' \]\]/);
  assert.match(String(workflow.jobs.publish.if), /needs\.select\.outputs\.publish == 'true'/);
  assert.match(publish, /name: Prepare publication evidence directory\s+run: mkdir -p build/);
  assert.ok(publish.indexOf("mkdir -p build") < publish.indexOf("anchore/sbom-action@"));
  assert.match(publish, /actions\/attest-build-provenance@[0-9a-f]{40}/);
  assert.match(publish, /actions\/attest-sbom@[0-9a-f]{40}/);
  assert.match(publish, /actions\/attest@[0-9a-f]{40}/);
  assert.match(publish, /verificationRunId/);
  assert.match(publish, /\.commit == \$commit and \.verificationRunId == \$runId/);
  assert.match(publish, /cosign sign --yes "\$IMAGE"/);
  assert.match(publish,
    /\.github\/workflows\/nightly-image\.yml@refs\/heads\/main/);
  assert.match(publish, /gh attestation verify/);
  assert.deepEqual(
    [...publish.matchAll(/--signer-workflow "([^"]+)"/g)].map((match) => match[1]),
    Array(3).fill("$GITHUB_REPOSITORY/.github/workflows/nightly-image.yml"),
  );
  assert.doesNotMatch(publish, /--signer-workflow "\$GITHUB_SERVER_URL/);
  assert.ok(publish.indexOf("cosign verify") < publish.indexOf("docker buildx imagetools create"));
  assert.ok(publish.indexOf("gh attestation verify") < publish.indexOf("docker buildx imagetools create"));
  assert.match(publish, /--tag "ghcr\.io\/\$\{\{ github\.repository \}\}:nightly"/);
  assert.match(publish,
    /--tag "ghcr\.io\/\$\{\{ github\.repository \}\}:nightly-\$\{\{ needs\.select\.outputs\.date \}\}-\$\{\{ needs\.select\.outputs\.short_sha \}\}"/);
  assert.deepEqual([...publish.matchAll(/--tag "([^"]+)"/g)].map((match) => match[1]), [
    "ghcr.io/${{ github.repository }}:nightly",
    "ghcr.io/${{ github.repository }}:nightly-${{ needs.select.outputs.date }}-${{ needs.select.outputs.short_sha }}",
  ]);
});

test("given any non-main dispatch, when jobs are evaluated, then publication and retention stay closed", () => {
  // when / then
  assert.match(String(workflow.jobs.publish.if), /needs\.select\.outputs\.publish == 'true'/);
  assert.match(String(workflow.jobs.retention.if), /needs\.select\.outputs\.publish == 'true'/);
  assert.match(String(workflow.jobs.retention.if),
    /needs\.publish\.result == 'success' (?:or|\|\|) needs\.publish\.result == 'skipped'/);
  assert.match(source, /node tools\/nightly-image-retention\.mjs[\s\S]+--apply/);
});

test("given acceptance image documentation, when users read it, then it cannot be mistaken for a release", () => {
  // given
  const deployment = readFileSync(new URL("../deploy/README.md", import.meta.url), "utf8");
  const design = readFileSync(new URL("../docs/design.md", import.meta.url), "utf8");
  const releasing = readFileSync(new URL("../docs/releasing.md", import.meta.url), "utf8");
  const inventory = JSON.parse(readFileSync(
    new URL("../security/cryptographic-inventory.json", import.meta.url), "utf8"));

  // when / then
  assert.match(deployment, /^## Nightly images$/m);
  assert.match(deployment, /acceptance and testing/i);
  assert.match(deployment, /nightly-<yyyymmdd>-<sha7>/);
  assert.match(deployment, /cosign verify/);
  assert.match(deployment, /nightly-image\.yml/);
  assert.match(deployment, /digest/i);
  assert.match(releasing, /nightly image/);
  assert.match(releasing, /predicts a release failure/i);
  assert.match(design, /newest fully verified\s+nightly revision/);
  assert.match(design, /nightly-only identity/);
  assert.ok(inventory.entries.some(({ id }) => id === "nightly-image-signature"));
});
