import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const workflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)),
  "utf8"
);
const pom = readFileSync(fileURLToPath(new URL("../pom.xml", import.meta.url)), "utf8");
const gatesWorkflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release-gates.yml", import.meta.url)),
  "utf8"
);

test("given a release commit, when its push build qualifies it for a candidate, then WebKit axe qualification ran", () => {
  // given
  const build = yaml.load(readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8")).jobs;

  // when / then
  assert.deepEqual(build.browser.strategy.matrix.group, ["functional-a", "functional-b", "chromium-accessibility", "webkit-accessibility"]);
  assert.match(build.browser.if, /github\.event_name != 'pull_request' \|\|/,
    "a push build runs every browser group, so the green build a candidate requires ran the WebKit axe shard");
  assert.match(pom, /<id>npm-e2e<\/id>[\s\S]+?<skip>\$\{frontend\.e2e\.skip\}<\/skip>/);
});

test("given a candidate or stable tag, when its GitHub release is published, then it uses the cumulative release-line notes", () => {
  // when / then
  assert.match(workflow, /body_path: build\/release-body\.md/);
  assert.doesNotMatch(workflow, /generate_release_notes: true/,
    "GitHub-generated notes start at the preceding candidate and split the release-line history");
});

test("given a qualified manifest, when publishing it, then tags and signatures address that manifest without rebuilding", () => {
  // when / then
  const publish = workflow.slice(workflow.indexOf("\n  publish:"));
  assert.doesNotMatch(publish, /docker\/build-push-action/);
  assert.match(publish, /docker buildx imagetools create/);
  assert.match(publish, /ghcr\.io\/\$\{\{ github\.repository \}\}@\$\{\{ needs\.candidate\.outputs\.image-digest \}\}/);
  assert.match(publish, /booking-seed-\$\{GITHUB_REF_NAME#v\}/);
  assert.match(publish, /release-security-record/);
  assert.match(publish, /cosign sign --yes "\$IMAGE"/);
  assert.match(publish, /cosign sign --yes "\$BOOKING_SEED_IMAGE"/);
  assert.match(publish, /courtside-booking-seed-\$\{\{ github\.ref_name \}\}\.spdx\.json/);
  assert.match(publish, /courtside-booking-seed\.spdx\.json/);
  assert.match(publish,
    /subject-digest: \$\{\{ needs\.candidate\.outputs\.booking-seed-digest \}\}/);
  assert.match(publish, /cosign verify/);
  assert.match(publish, /gh attestation verify/);
  assert.deepEqual(
    [...publish.matchAll(/--signer-workflow "([^"]+)"/g)].map((match) => match[1]),
    Array(5).fill("$GITHUB_REPOSITORY/.github/workflows/release.yml"),
  );
  assert.doesNotMatch(publish, /--signer-workflow "\$GITHUB_SERVER_URL/);
  assert.match(publish, /node tools\/security-supply-chain\.mjs/);
  assert.ok(publish.indexOf("cosign sign") < publish.indexOf("docker buildx imagetools create"));
  assert.ok(publish.indexOf("security-supply-chain.mjs") < publish.indexOf("docker buildx imagetools create"));
  assert.ok(publish.indexOf("softprops/action-gh-release") < publish.indexOf("docker buildx imagetools create"),
    "a release whose assets fail to upload must not leave version tags behind");
  assert.match(publish, /softprops\/action-gh-release[^\n]*\n\s+with:\n\s+body_path: build\/release-body\.md\n\s+draft: true/);
  assert.ok(publish.indexOf("docker buildx imagetools create") < publish.indexOf("--draft=false"),
    "the release becomes visible only after its image tags exist");
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

test("given the version a tag names, when the release opens, then nothing is promoted before it is refused",
  () => {
    // when / then
    assert.ok(workflow.indexOf("Refuse a tag outside the branch its version belongs to")
      < workflow.indexOf("release-candidate-evidence.mjs --find"),
    "release-line.mjs admit-tag reads the tag against the manifest before any evidence is looked up");
    assert.match(workflow, /\n  publish:\n    needs: \[candidate\]/);
  });

const releaseJobs = yaml.load(workflow).jobs;
const gateJobs = yaml.load(gatesWorkflow).jobs;

function stepsOf(job) {
  return releaseJobs[job].steps ?? [];
}

test("given a candidate archive, when any release gate inspects it, then the booking-seed digest is bound as well", () => {
  // given
  const inspections = Object.entries(gateJobs).flatMap(([job, { steps = [] }]) => steps
    .filter((step) => step.run?.includes("--inspect-archive"))
    .map((step) => ({ job, step })));
  const seedOf = (job) => gateJobs[job].steps.find((step) => step.id === "booking-seed");

  // then
  assert.ok(inspections.some(({ job }) => job === "mail"), "the mail gate inspects the archive");
  for (const { job, step } of inspections) {
    assert.match(step.run, /--booking-seed-image "\$BOOKING_SEED_IMAGE"/, `${job} passes the booking-seed image`);
    assert.equal(step.env?.BOOKING_SEED_IMAGE, "${{ steps.booking-seed.outputs.pinned }}", `${job} binds the booking-seed digest`);
    assert.equal(seedOf(job).with.digest, "${{ inputs.booking-seed-digest }}",
      `${job} resolves the booking seed from its digest input`);
  }
});

function matcher(glob) {
  const literal = glob.split("*").map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${literal.join(".*")}$`);
}

test("given an artifact another release job downloads, when it is uploaded, then it has one root directory", () => {
  // given
  const uploads = new Map(Object.keys(releaseJobs).flatMap((job) => stepsOf(job)
    .filter((step) => step.uses?.startsWith("actions/upload-artifact@"))
    .map((step) => [step.with.name, step.with.path])));
  const downloaded = Object.keys(releaseJobs).flatMap((job) => stepsOf(job)
    .filter((step) => step.uses?.startsWith("actions/download-artifact@"))
    .map((step) => step.with.name ?? step.with.pattern));

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

test("given a job that runs the Maven-pinned node, when it starts, then an earlier step installed it", () => {
  // given
  const installs = /mvnw[^\n]*(?:\binstall-node-and-npm\b|\b(?:package|verify|install)\b)/;
  const offenders = readdirSync(fileURLToPath(new URL(WORKFLOWS, import.meta.url)))
    .filter((file) => file.endsWith(".yml"))
    .flatMap((file) => Object.entries(yaml.load(sourceOf(`${WORKFLOWS}/${file}`)).jobs ?? {})
      .flatMap(([job, { steps = [] }]) => {
        const runs = steps.map((step) => String(step.run ?? "").replace(/\\\n\s*/g, " "));
        const firstUse = runs.findIndex((run) => /(?:^|[\s"(])(?:\.\/|frontend\/)node\/node\b/.test(run));
        const firstInstall = runs.findIndex((run) => installs.test(run));
        return firstUse >= 0 && (firstInstall < 0 || firstInstall > firstUse) ? [`${file}:${job}`] : [];
      }));

  // then
  assert.deepEqual(offenders, [],
    "these jobs call frontend/node/node, which only a Maven build or install-node-and-npm puts there");
});

test("given no release passes upgrade origins, when the gates run at night, then they upgrade from a retained "
  + "nightly", () => {
  // given
  const gates = yaml.load(gatesWorkflow);
  const call = (gates.on ?? gates[true]).workflow_call.inputs["upgrade-origins"];
  const resolve = gates.jobs["upgrade-origins"].steps.find((step) => step.id === "resolve").run;

  // when / then
  assert.equal(call.default, "nightly", "build.yml and the branch rehearsal pass no origins and must still rehearse");
  assert.match(resolve, /--nightly-origins "\$GITHUB_REPOSITORY"/);
  assert.match(resolve, /if \[ "\$origins" = '\[\]' \]; then\s+test -n "\$UPGRADE_BASE"/,
    "a night that found no origin must not pass silently");
  const nightly = yaml.load(readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8"))
    .jobs["release-gates"];
  assert.equal(nightly.with["upgrade-base"], undefined, "the nightly names no base, so an empty set fails it");
  assert.deepEqual(gates.jobs.upgrade.needs, "upgrade-origins");
  assert.equal(gates.jobs["upgrade-origins"].steps.find((step) => step.id === "resolve").shell, "bash",
    "GitHub adds pipefail only to an explicit bash shell, so a failed registry request would read as bad JSON");
});

test("given a published release, when it finishes, then the release plan is synchronized by the release itself",
  () => {
    // given
    const jobs = yaml.load(workflow).jobs;

    // when / then
    assert.equal(jobs["plan-sync"].uses, "./.github/workflows/release-plan-sync.yml",
      "a release published with the workflow token triggers no release event");
    assert.equal(jobs["plan-sync"].needs, "publish");
    assert.equal(jobs["plan-sync"].permissions.issues, "write");
  });
