import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function source(path) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

test("given a deployment pull request, when CI plans tooling, then archive, handbook and recipe drift block it", () => {
  // given
  const build = source("../.github/workflows/build.yml");

  // when / then
  assert.match(build, /name: Qualify deployment archive and recipe drift/);
  assert.match(build, /node tools\/deployment-handbook\.mjs[\s\S]+--check/);
  assert.match(build, /--site-english site\/en\/generated-operator-recipes\.md/);
  assert.match(build, /node --test[\s\S]+deployment-archive\.test\.mjs[\s\S]+deployment-recipes\.test\.mjs/);
});

test("given a release candidate archive, when release qualification starts, then every recipe reads that exact archive", () => {
  // given
  const release = source("../.github/workflows/release.yml");
  const qualification = release.slice(release.indexOf("\n  qualify:"), release.indexOf("\n  security-record:"));

  // when / then
  assert.match(qualification, /needs: \[archive, image\]/);
  assert.match(qualification, /name: deployment-archive/);
  assert.match(qualification, /deployment-qualification\.mjs --inspect-archive/);
  assert.match(qualification, /--recipes standard,full-self-hosted,existing-infrastructure,funnel/);
  assert.match(qualification,
    /IMAGE: ghcr\.io\/\$\{\{ github\.repository \}\}@\$\{\{ needs\.image\.outputs\.digest \}\}/);
  assert.match(qualification, /--image "\$IMAGE"/);
  assert.match(qualification, /courtside\.uat-smoke\.mjs --confirm courtside-uat/);
});

test("given the self-hosted mail recipe, when a release is cut, then its controlled Stalwart journey blocks publication", () => {
  // given
  const release = source("../.github/workflows/release.yml");

  // when / then
  assert.match(release, /\n  mail:\n    needs: \[archive, image\]/);
  assert.match(release, /node tools\/courtside\.mail-smoke\.mjs/);
  assert.match(release,
    /needs: \[archive, build, browser, image, qualify, mail, security-record, upgrade, restore\]/);
});

test("given main or nightly qualification, when the image is exercised, then a candidate archive is inspected on both architectures", () => {
  // given
  const build = source("../.github/workflows/build.yml");
  const nightly = source("../.github/workflows/nightly-image.yml");

  // when / then
  assert.match(build, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(nightly, /node tools\/deployment-archive\.mjs[\s\S]+nightly/);
  assert.match(nightly, /deployment-qualification\.mjs --inspect-archive/);
  assert.match(nightly, /--recipes standard,full-self-hosted,existing-infrastructure,funnel/);
  assert.match(nightly, /architecture: amd64[\s\S]+architecture: arm64/);
});
