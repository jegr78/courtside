import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

test("given npm audit is unavailable, when building a release, then explicit skipped evidence does not block publication", () => {
  // when / then
  assert.match(workflow, /npm-cli\.js run audit:security --[\s\\]+--output \.\.\/build\/security\/npm\.json/);
  assert.doesNotMatch(workflow, /npm-cli\.js --prefix frontend audit --json/);
  assert.match(workflow,
    /Refuse unresolved nightly failures[\s\S]+select\(\.body \| contains\("- Workflow: `npm audit`"\) \| not\)/);
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
