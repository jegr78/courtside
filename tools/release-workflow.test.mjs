import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const workflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)),
  "utf8"
);
const pom = readFileSync(fileURLToPath(new URL("../pom.xml", import.meta.url)), "utf8");

test("given a release image, when publishing it, then the same digest is qualified on every architecture first", () => {
  // when / then
  assert.match(workflow, /jobs:\n  nightly-evidence:[\s\S]+\n  build:[\s\S]+\n  image:/);
  assert.match(workflow, /\n  build:\n    needs: nightly-evidence/);
  assert.match(workflow, /\n  qualify:\n    needs: image/);
  assert.match(workflow, /architecture: amd64[\s\S]+runs-on: ubuntu-latest/);
  assert.match(workflow, /architecture: arm64[\s\S]+runs-on: ubuntu-24\.04-arm/);
  assert.match(workflow, /COURTSIDE_UAT_VERSION: release-candidate-\$\{\{ github\.sha \}\}@\$\{\{ needs\.image\.outputs\.digest \}\}/);
  assert.match(workflow, /node tools\/courtside\.uat-smoke\.mjs --confirm courtside-uat/);
  assert.match(workflow, /\n  security-record:\n    needs: \[build, image, qualify, active-security\]/);
  assert.match(workflow,
    /\n  publish:\n    needs: \[archive, build, browser, image, qualify, security-record, upgrade, restore\]/);
});

test("given a release build, when browser tests run, then WebKit axe qualification is required", () => {
  // when / then
  assert.match(workflow,
    /- name: Build and test\n        run: \.\/mvnw -B verify -Dfrontend\.e2e\.skip=true/);
  assert.match(workflow, /\n  browser:\n    needs: nightly-evidence/);
  assert.match(workflow,
    /\n      - name: Run the release browser journeys\n        working-directory: frontend\n        env:\n          COURTSIDE_WEBKIT_AXE: 'true'\n        run: \.\/node\/node \.\/node\/node_modules\/npm\/bin\/npm-cli\.js run test:e2e/);
  assert.match(pom, /<id>npm-e2e<\/id>[\s\S]+?<skip>\$\{frontend\.e2e\.skip\}<\/skip>/);
});

test("given a candidate image, when qualifying it, then deployment and vulnerability failures block publication", () => {
  // when / then
  assert.match(workflow, /docker compose[\s\S]+config --quiet/);
  assert.match(workflow, /aquasecurity\/trivy-action@[a-f0-9]{40}/);
  assert.match(workflow, /node tools\/security-findings\.mjs/);
  assert.match(workflow, /security\/exceptions\.json/);
  assert.match(workflow, /security-summary-\$\{\{ matrix\.architecture \}\}\.json/);
  assert.match(workflow, /if \[\[ ! -s build\/uat-smoke\/container-logs\.txt \]\]/);
  assert.match(workflow, /release-security-record/);
});

test("given npm audit is unavailable, when building a release, then explicit skipped evidence does not block publication", () => {
  // when / then
  assert.match(workflow, /npm-cli\.js run audit:security --[\s\\]+--output \.\.\/build\/security\/npm\.json/);
  assert.doesNotMatch(workflow, /npm-cli\.js --prefix frontend audit --json/);
  assert.match(workflow,
    /Refuse unresolved nightly failures[\s\S]+select\(\.body \| contains\("- Workflow: `npm audit`"\) \| not\)/);
});

test("given a candidate or stable tag, when its GitHub release is published, then it uses the cumulative release-line notes", () => {
  // when / then
  assert.match(workflow, /node tools\/release-notes\.mjs[\s\S]+--tag "\$GITHUB_REF_NAME"[\s\S]+--output build\/release-body\.md/);
  assert.match(workflow, /body_path: build\/release-body\.md/);
  assert.doesNotMatch(workflow, /generate_release_notes: true/,
    "GitHub-generated notes start at the preceding candidate and split the release-line history");
});

test("given no release was published before, when upgrade notes are collected, then development markers are not presented as upgrades", () => {
  // given
  const collectStart = workflow.indexOf("      - name: Collect the upgrade notes");
  const collectEnd = workflow.indexOf("\n      - name:", collectStart + 1);
  const collect = workflow.slice(collectStart, collectEnd);

  // when / then
  assert.match(collect, /if \[ -n "\$previous" \]; then[\s\S]+git log/);
  assert.match(collect,
    /if \[ -z "\$previous" \]; then[\s\S]+First public release; no prior supported version to upgrade from\./);
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
  assert.deepEqual(
    [...publish.matchAll(/--signer-workflow "([^"]+)"/g)].map((match) => match[1]),
    Array(3).fill("$GITHUB_REPOSITORY/.github/workflows/release.yml"),
  );
  assert.doesNotMatch(publish, /--signer-workflow "\$GITHUB_SERVER_URL/);
  assert.match(publish, /node tools\/security-supply-chain\.mjs/);
  assert.ok(publish.indexOf("cosign sign") < publish.indexOf("docker buildx imagetools create"));
  assert.ok(publish.indexOf("security-supply-chain.mjs") < publish.indexOf("docker buildx imagetools create"));
  assert.ok(publish.indexOf("docker buildx imagetools create") < publish.indexOf("softprops/action-gh-release"));
});

test("given a tag, when the release runs, then it demands a nightly that verified the commit", () => {
  // given
  const gate = workflow.slice(workflow.indexOf("  nightly-evidence:"), workflow.indexOf("\n  build:"));

  // when / then
  assert.match(gate, /actions\/workflows\/build\.yml\/runs\?branch=\$\{DEFAULT_BRANCH\}&status=success/);
  assert.match(gate, /select\(\.event == "schedule" or \.event == "workflow_dispatch"\)/);
  assert.match(gate, /select\(\.run_attempt == 1\)/);
  assert.match(gate, /git merge-base --is-ancestor "\$head" "\$GITHUB_SHA"/);
  assert.match(gate, /nightly-release-evidence-\$\{id\}-1/);
  assert.match(gate, /node tools\/nightly-release-evidence\.mjs/);
  assert.match(gate, /--commit "\$head" --run-id "\$id"/);
  assert.ok(gate.indexOf("gh run download") < gate.indexOf("node tools/nightly-release-evidence.mjs"));
  assert.ok(gate.indexOf("node tools/nightly-release-evidence.mjs") < gate.indexOf('verified="$id"'));
  assert.match(gate, /no green first-attempt build with a completed coupled nightly-image run verified a commit this tag builds on/);
  assert.match(gate, /actions: read/);
});

const WORKFLOWS = "../.github/workflows";

function sourceOf(path) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

// Only static imports: a module reached by await import() loads when a command asks for it, not
// when the file does, so it is the calling job's business rather than the entry point's.
function staticImportsOf(source) {
  return [...source.matchAll(/from\s+["'](\.\/[^"']+)["']/g)].map((match) => match[1].slice(2));
}

function isExternal(specifier) {
  return !specifier.startsWith(".") && !specifier.startsWith("node:");
}

// Column zero is module level: an indented require sits inside a function and runs when called.
// The require pattern deliberately allows anything between the assignment and the call, because
// `new (require("ajv").default)()` binds just as eagerly as a bare `require("ajv")` does.
function moduleLevelBindings(source) {
  const bindings = [];
  const imports = /^import\s(?:[\s\S]*?\sfrom\s)?\s*["']([^"']+)["'][^\n]*/gm;
  const requires = /^(?:const|let|var)\s[^=\n]*=[^\n]*?(?:frontendRequire|require)\(\s*["']([^"']+)["'][^\n]*/gm;
  for (const pattern of [imports, requires]) {
    for (const match of source.matchAll(pattern)) {
      if (isExternal(match[1])) {
        bindings.push(`${lineOf(source, match.index)}: ${match[0].split("\n")[0].trim()}`);
      }
    }
  }
  return bindings;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function staticGraphOf(entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const name = pending.pop();
    if (seen.has(name) || !existsSync(fileURLToPath(new URL(name, import.meta.url)))) {
      continue;
    }
    seen.add(name);
    staticImportsOf(sourceOf(name)).forEach((next) => pending.push(next));
  }
  return [...seen];
}

// Derived rather than listed: a workflow that starts a tool without installing first is exactly the
// case this guards, and a hand-kept list would not know about the next one.
function jobsRunningATool() {
  return readdirSync(fileURLToPath(new URL(WORKFLOWS, import.meta.url)))
    .filter((file) => file.endsWith(".yml"))
    .flatMap((file) => {
      const lines = sourceOf(`${WORKFLOWS}/${file}`).split("\n");
      const jobs = [];
      let current = null;
      for (const line of lines) {
        const header = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
        if (header) {
          current = { workflow: file, job: header[1], body: [] };
          jobs.push(current);
        }
        if (current) {
          current.body.push(line);
        }
      }
      return jobs
        .map((job) => ({ ...job, text: job.body.join("\n") }))
        .filter((job) => /node tools\/[\w.-]+\.mjs/.test(job.text))
        .map((job) => ({
          workflow: job.workflow,
          job: job.job,
          tools: [...new Set([...job.text.matchAll(/node (tools\/[\w.-]+\.mjs)/g)]
            .map((match) => match[1].slice("tools/".length)))],
          installsAt: job.text.search(/npm ci|npm install|\.\/mvnw/),
          runsADependentToolAt: job.text.search(
            /node tools\/(?!node-toolchain\.mjs)[\w.-]+\.mjs/)
        }));
    });
}

test("given a job that starts a tool without installing, when the tool is imported, then nothing outside this repository has to be there", () => {
  // given
  const offenders = [];

  // when
  for (const { workflow, job, tools } of jobsRunningATool().filter(({ installsAt }) => installsAt < 0)) {
    for (const tool of tools) {
      for (const module of staticGraphOf(tool)) {
        moduleLevelBindings(sourceOf(module))
          .forEach((offence) => offenders.push(`${workflow}:${job} -> ${tool} -> tools/${module}:${offence}`));
      }
    }
  }

  // then
  assert.deepEqual(offenders, [],
    `A workflow starts these tools, so they load before anything is installed and may not bind an\n`
    + `external dependency while loading. Move the require or the import into the function that\n`
    + `needs it:\n${offenders.join("\n")}`);
});

test("given a job that installs, when it starts a tool, then it installs first", () => {
  // when / then
  jobsRunningATool()
    .filter(({ installsAt }) => installsAt >= 0)
    .forEach(({ workflow, job, installsAt, runsADependentToolAt }) =>
      assert.ok(runsADependentToolAt < 0 || installsAt < runsADependentToolAt,
        `${workflow}:${job} runs a tool before installing what that tool loads`));
});

// Matching the step's text would only show that somebody wrote a comparison, so this runs the
// script the runner runs, against a manifest it can see, and reads what it does with each tag.
function refusesTag(tag, recorded) {
  const step = yaml.load(workflow).jobs["nightly-evidence"].steps
    .find((entry) => entry.name === "Refuse a tag the repository does not record as its release");
  assert.ok(step, "the release pipeline opens with a step that reads the tag against the manifest");
  const directory = mkdtempSync(join(tmpdir(), "courtside-release-tag-"));
  writeFileSync(join(directory, ".release-please-manifest.json"), JSON.stringify({ ".": recorded }));
  try {
    execFileSync("bash", ["-c", step.run], {
      cwd: directory,
      env: { ...process.env, GITHUB_REF_NAME: tag },
      encoding: "utf8",
      stdio: "pipe"
    });
    return null;
  } catch (refusal) {
    return `${refusal.stdout ?? ""}${refusal.stderr ?? ""}`;
  }
}

test("given a release tag, when the pipeline opens, then only the version this commit records is built",
  () => {
    // when / then — the tag release-please cut from this manifest is the one that builds
    assert.equal(refusesTag("v0.1.0-rc.2", "0.1.0-rc.2"), null);

    // and a candidate nobody released is refused, although its release line exists
    const unreleasedCandidate = refusesTag("v0.1.0-rc.7", "0.1.0-rc.2");
    assert.match(unreleasedCandidate, /v0\.1\.0-rc\.7 names 0\.1\.0-rc\.7/);
    assert.match(unreleasedCandidate, /this commit records 0\.1\.0-rc\.2/);
    assert.match(refusesTag("v0.9.9", "0.1.0-rc.2"), /::error::/);
  });

test("given the version the build stamps, when the tag is read, then nothing is built before it is refused",
  () => {
    // when / then — `versions:set` takes the tag verbatim, so the refusal precedes every job
    assert.ok(workflow.indexOf("Refuse a tag the repository does not record as its release")
      < workflow.indexOf("versions:set"));
    assert.match(workflow, /\n  build:\n    needs: nightly-evidence/);
    assert.match(workflow, /\n  browser:\n    needs: nightly-evidence/);
  });
