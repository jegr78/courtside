import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)),
  "utf8"
);

test("given a release image, when publishing it, then the same digest is qualified on every architecture first", () => {
  // when / then
  assert.match(workflow, /jobs:\n  build:[\s\S]+\n  image:/);
  assert.match(workflow, /\n  qualify:\n    needs: image/);
  assert.match(workflow, /architecture: amd64[\s\S]+runs-on: ubuntu-latest/);
  assert.match(workflow, /architecture: arm64[\s\S]+runs-on: ubuntu-24\.04-arm/);
  assert.match(workflow, /COURTSIDE_UAT_VERSION: release-candidate-\$\{\{ github\.sha \}\}@\$\{\{ needs\.image\.outputs\.digest \}\}/);
  assert.match(workflow, /node tools\/courtside\.uat-smoke\.mjs --confirm courtside-uat/);
  assert.match(workflow, /\n  publish:\n    needs: \[build, image, qualify\]/);
});

test("given a candidate image, when qualifying it, then deployment and vulnerability failures block publication", () => {
  // when / then
  assert.match(workflow, /docker compose[\s\S]+config --quiet/);
  assert.match(workflow, /aquasecurity\/trivy-action@[a-f0-9]{40}/);
  assert.match(workflow, /severity: CRITICAL,HIGH/);
  assert.match(workflow, /exit-code: '1'/);
});

test("given a qualified manifest, when publishing it, then tags and signatures address that manifest without rebuilding", () => {
  // when / then
  const publish = workflow.slice(workflow.indexOf("\n  publish:"));
  assert.doesNotMatch(publish, /docker\/build-push-action/);
  assert.match(publish, /docker buildx imagetools create/);
  assert.match(publish, /ghcr\.io\/\$\{\{ github\.repository \}\}@\$\{\{ needs\.image\.outputs\.digest \}\}/);
  assert.match(publish, /cosign sign --yes "\$IMAGE"/);
  assert.ok(publish.indexOf("cosign sign") < publish.indexOf("docker buildx imagetools create"));
  assert.ok(publish.indexOf("docker buildx imagetools create") < publish.indexOf("softprops/action-gh-release"));
});
