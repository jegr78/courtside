import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as images from "../frontend/e2e/container-images.ts";
import { dockerPull, PULL_ATTEMPTS, PULL_BACKOFF_SECONDS, PULL_BUDGET_SECONDS, pullImages } from "./pull-images.mjs";

const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ACTION = "./.github/actions/browser-images";
const packageScripts = JSON.parse(read("frontend/package.json")).scripts;
const browserScripts = Object.keys(packageScripts)
  .filter((name) => /^playwright test\b|webkit-reliability\.mjs (run|experiment)\b/.test(packageScripts[name]));

function e2eSources(directory = "frontend/e2e") {
  return readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return e2eSources(path);
    return /\.ts$/.test(entry.name) && entry.name !== "container-images.ts" ? [path] : [];
  });
}

// Every image expression the module offers, keyed the way the setup writes it.
function imageExpressions() {
  return new Map(Object.entries(images).flatMap(([name, value]) => {
    if (name === "reaperImage" || name === "browserSetupImages") return [];
    if (typeof value === "function" && name.endsWith("Image")) return [[`${name}()`, value()]];
    if (typeof value === "string" && name.endsWith("_IMAGE")) return [[name, value]];
    return [];
  }));
}

const startsBrowserSetup = (step) => {
  const run = String(step.run ?? "");
  return /\bplaywright test\b/.test(run)
    || browserScripts.some((name) => new RegExp(`\\bnpm run ${name.replace(/[.:]/g, "\\$&")}(\\s|$)`).test(run));
};

function workflowJobs() {
  return readdirSync(new URL("../.github/workflows/", import.meta.url))
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) => Object.entries(yaml.load(read(`.github/workflows/${name}`)).jobs ?? {})
      .map(([id, job]) => ({ name: `${name}#${id}`, job })));
}

test("given the browser setup starts containers, when its images are listed for the pull, then each one is covered", () => {
  const offered = imageExpressions();
  const pulled = images.browserSetupImages();
  const started = e2eSources().flatMap((path) => [...read(path).matchAll(/new\s+\w*Container\(\s*(\w+(?:\(\))?|"[^"]*"|'[^']*'|`[^`]*`)/g)]
    .map((match) => ({ path, expression: match[1] })));

  assert.ok(started.length >= 4, `the setup starts its containers through GenericContainer (${started.length} found)`);
  for (const { path, expression } of started) {
    assert.ok(offered.has(expression), `${path} starts ${expression}, which container-images.ts does not offer`);
    assert.ok(pulled.includes(offered.get(expression)), `${path} starts ${offered.get(expression)}, which the pull skips`);
  }
  assert.ok(pulled.includes(images.reaperImage()), "the Testcontainers reaper must be pulled before the first container");
});

test("given the installed Testcontainers, when the reaper image is read, then it is the release's own unless overridden", () => {
  const entry = createRequire(new URL("../frontend/package.json", import.meta.url)).resolve("testcontainers/package.json");
  const reaper = readFileSync(join(entry, "..", "build", "reaper", "reaper.js"), "utf8");

  assert.ok(reaper.includes(`"${images.reaperImage({})}"`), "the reaper image must come from the installed release");
  assert.equal(images.reaperImage({ RYUK_CONTAINER_IMAGE: "mirror/ryuk:1" }), "mirror/ryuk:1");
});

test("given a workflow job, when a step starts the browser setup, then the images were pulled before it", () => {
  let browserSteps = 0;
  for (const { name, job } of workflowJobs()) {
    const steps = job.steps ?? [];
    steps.forEach((step, index) => {
      if (!startsBrowserSetup(step)) return;
      browserSteps++;
      assert.ok(steps.slice(0, index).some((earlier) => earlier.uses === ACTION),
        `${name} step "${step.name}" starts the browser setup without ${ACTION} before it`);
    });
  }
  assert.ok(browserSteps >= 4, `the browser jobs must be found (${browserSteps})`);
});

test("given a job pulls the browser images, when the pull spends its whole budget, then half of the job remains", () => {
  for (const { name, job } of workflowJobs()) {
    if (!(job.steps ?? []).some((step) => step.uses === ACTION)) continue;
    const minutes = Math.min(...String(job["timeout-minutes"] ?? 360).match(/\d+/g).map(Number));
    assert.ok(PULL_BUDGET_SECONDS <= minutes * 30, `${name} has ${minutes} min, the pull may take ${PULL_BUDGET_SECONDS} s`);
  }
});

test("given the pull action, when it runs, then it pulls the list the setup module prints", () => {
  const run = yaml.load(read(".github/actions/browser-images/action.yml")).runs.steps.map((step) => step.run).join("\n");
  assert.match(run, /node e2e\/container-images\.ts/);
  assert.match(run, /node \.\.\/tools\/pull-images\.mjs/);
});

test("given a registry that fails twice, when the images are pulled, then the third attempt pulls after both waits", async () => {
  const calls = [];
  const waits = [];

  await pullImages(["a", "b"], {
    pull: (image) => { calls.push(image); return calls.length <= 2 ? { pulled: false, reason: "exit 1" } : { pulled: true }; },
    sleep: async (seconds) => { waits.push(seconds); },
    log: () => {}
  });

  assert.deepEqual(calls, ["a", "a", "a", "b"]);
  assert.deepEqual(waits, PULL_BACKOFF_SECONDS);
});

test("given an image that stays unavailable, when it is pulled, then the pull fails naming it after the last attempt", async () => {
  let calls = 0;
  await assert.rejects(pullImages(["postgres:18"], {
    pull: () => { calls++; return { pulled: false, reason: "exit 1" }; }, sleep: async () => {}, log: () => {}
  }), /postgres:18 could not be pulled after 3 attempts: exit 1/);
  assert.equal(calls, PULL_ATTEMPTS);
});

test("given the budget is spent, when the next attempt is due, then the pull fails instead of starting it", async () => {
  let clock = 0;
  let calls = 0;
  await assert.rejects(pullImages(["caddy:2"], {
    pull: () => { calls++; clock += PULL_BUDGET_SECONDS * 1000; return { pulled: false, reason: "stopped by SIGTERM" }; },
    sleep: async () => {}, now: () => clock, log: () => {}
  }), new RegExp(`Pulling caddy:2 exceeded the ${PULL_BUDGET_SECONDS} s budget`));
  assert.equal(calls, 1);
});

test("given a docker command that fails once, when the images are pulled through it, then the retry pulls the image", async () => {
  const directory = mkdtempSync(join(tmpdir(), "courtside-docker-stub-"));
  const counter = join(directory, "calls");
  writeFileSync(counter, "");
  writeFileSync(join(directory, "docker"),
    `#!/bin/sh\necho "$*" >> "${counter}"\n[ "$(wc -l < "${counter}")" -ge 2 ]\n`);
  chmodSync(join(directory, "docker"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${directory}:${path}`;
  try {
    const first = dockerPull("ryuk:1", 5);
    assert.deepEqual(first, { pulled: false, reason: "exit 1" });
    await pullImages(["ryuk:1"], { sleep: async () => {}, log: () => {} });
    assert.deepEqual(readFileSync(counter, "utf8").trim().split("\n"), ["pull ryuk:1", "pull ryuk:1"]);
  } finally {
    process.env.PATH = path;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given a docker command that hangs, when its attempt runs out, then the attempt is stopped", () => {
  const directory = mkdtempSync(join(tmpdir(), "courtside-docker-stub-"));
  writeFileSync(join(directory, "docker"), "#!/bin/sh\nexec sleep 30\n");
  chmodSync(join(directory, "docker"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${directory}:${path}`;
  try {
    assert.deepEqual(dockerPull("ryuk:1", 1), { pulled: false, reason: "spawnSync docker ETIMEDOUT" });
  } finally {
    process.env.PATH = path;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given the list the setup module prints, when it reaches the pull as one argument, then each image is pulled", () => {
  const directory = mkdtempSync(join(tmpdir(), "courtside-docker-stub-"));
  const calls = join(directory, "calls");
  writeFileSync(join(directory, "docker"), `#!/bin/sh\necho "$*" >> "${calls}"\n`);
  chmodSync(join(directory, "docker"), 0o755);
  try {
    const result = spawnSync(process.execPath, [new URL("./pull-images.mjs", import.meta.url).pathname, "ryuk:1\ncaddy:2\n"],
      { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n"), ["pull ryuk:1", "pull caddy:2"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
