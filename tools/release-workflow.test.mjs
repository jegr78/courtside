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
  assert.match(workflow, /\n  security-record:\n    needs: \[build, image, qualify, active-security\]/);
  assert.match(workflow, /\n  publish:\n    needs: \[build, image, qualify, security-record, upgrade, restore\]/);
});

test("given a release build, when browser tests run, then WebKit axe qualification is required", () => {
  // when / then
  assert.match(workflow, /- name: Build and test\n        env:\n          COURTSIDE_WEBKIT_AXE: 'true'\n        run: \.\/mvnw -B verify/);
});

test("given a candidate image, when qualifying it, then deployment and vulnerability failures block publication", () => {
  // when / then
  assert.match(workflow, /docker compose[\s\S]+config --quiet/);
  assert.match(workflow, /aquasecurity\/trivy-action@[a-f0-9]{40}/);
  assert.match(workflow, /node tools\/security-findings\.mjs/);
  assert.match(workflow, /security\/exceptions\.json/);
  assert.match(workflow, /security-summary-\$\{\{ matrix\.architecture \}\}\.json/);
  assert.match(workflow, /release-security-record/);
});

test("given a qualified manifest, when publishing it, then tags and signatures address that manifest without rebuilding", () => {
  // when / then
  const publish = workflow.slice(workflow.indexOf("\n  publish:"));
  assert.doesNotMatch(publish, /docker\/build-push-action/);
  assert.match(publish, /docker buildx imagetools create/);
  assert.match(publish, /ghcr\.io\/\$\{\{ github\.repository \}\}@\$\{\{ needs\.image\.outputs\.digest \}\}/);
  assert.match(publish, /cosign sign --yes "\$IMAGE"/);
  assert.match(publish, /cosign verify/);
  assert.match(publish, /gh attestation verify/);
  assert.match(publish, /node tools\/security-supply-chain\.mjs/);
  assert.ok(publish.indexOf("cosign sign") < publish.indexOf("docker buildx imagetools create"));
  assert.ok(publish.indexOf("security-supply-chain.mjs") < publish.indexOf("docker buildx imagetools create"));
  assert.ok(publish.indexOf("docker buildx imagetools create") < publish.indexOf("softprops/action-gh-release"));
});

test("given a tag, when the release runs, then it demands a nightly that verified the commit", () => {
  // when / then
  assert.match(workflow, /actions\/workflows\/build\.yml\/runs\?event=schedule&status=success/);
  assert.match(workflow, /select\(\.run_attempt == 1\)/);
  assert.match(workflow, /git merge-base --is-ancestor "\$head" "\$GITHUB_SHA"/);
  assert.match(workflow, /releaseReadiness == "complete"/);
  assert.match(workflow, /no green first-attempt nightly verified a commit this tag builds on/);
  assert.match(workflow, /actions: read/);
});

const SELF_SUFFICIENT = [
  "courtside.mjs",
  "courtside.uat-smoke.mjs",
  "courtside.upgrade-smoke.mjs",
  "courtside.restore-smoke.mjs"
];

function sourceOf(name) {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
}

function relativeImportsOf(source) {
  return [...source.matchAll(/from\s+["'](\.\/[^"']+)["']/g)].map((match) => match[1].slice(2));
}

// A require bound at module level runs on import; the same call inside a function does not.
function moduleLevelBareRequires(source) {
  return source.split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /^(?:const|let|var)\s+[^=]+=\s*(?:frontendRequire|require)\(\s*["'][^.]/.test(line))
    .map(({ line, number }) => `${number}: ${line.trim()}`);
}

function moduleLevelBareImports(source) {
  return source.split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /^import\s/.test(line))
    .filter(({ line }) => !/["'](?:node:|\.\/|\.\.\/)/.test(line))
    .filter(({ line }) => /["'][^"']+["']/.test(line))
    .map(({ line, number }) => `${number}: ${line.trim()}`);
}

function graphOf(entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const name = pending.pop();
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    relativeImportsOf(sourceOf(name)).forEach((next) => pending.push(next));
  }
  return [...seen];
}

test("given a tool a workflow runs on a bare checkout, when it is imported, then nothing outside this repository has to be installed first", () => {
  // given
  const offenders = [];

  // when
  for (const entry of SELF_SUFFICIENT) {
    for (const module of graphOf(entry)) {
      const source = sourceOf(module);
      [...moduleLevelBareRequires(source), ...moduleLevelBareImports(source)]
        .forEach((offence) => offenders.push(`${entry} -> tools/${module}:${offence}`));
    }
  }

  // then
  assert.deepEqual(offenders, [],
    `These modules are loaded before a workflow installs anything, so they may not bind an external\n`
    + `dependency at module level. Move the require or the import into the function that needs it:\n`
    + `${offenders.join("\n")}`);
});

test("given the jobs that run a tool needing a validator, when the release starts them, then each installs the locked dependencies first", () => {
  // given
  const jobs = ["qualify:", "security-record:", "active-security:", "publish:"];

  // when / then
  jobs.forEach((job) => {
    const section = workflow.slice(workflow.indexOf(`\n  ${job}`));
    const install = section.indexOf("Install locked tool dependencies");
    const runsATool = section.search(/node tools\/(security-|courtside\.)/);
    assert.ok(install >= 0, `${job} runs a tool that binds a validator but installs nothing`);
    assert.ok(install < runsATool,
      `${job} runs a tool before installing what that tool loads`);
  });
});
