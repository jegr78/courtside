import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const preparation = "./.github/actions/trivy-databases";

function scanJobs() {
  return readdirSync(new URL("../.github/workflows", import.meta.url)).filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) => Object.entries(yaml.load(read(`.github/workflows/${file}`)).jobs ?? {})
      .filter(([, job]) => job.steps?.some((step) => step.uses?.startsWith("aquasecurity/trivy-action@")))
      .map(([name, job]) => ({ file, name, steps: job.steps })));
}

test("given every hosted Trivy scan, when the job runs, then database preparation succeeds before any scan without a later cache restore", () => {
  // given
  const jobs = scanJobs();
  let scans = 0;

  // when / then
  assert.equal(jobs.length, 4);
  for (const { file, name, steps } of jobs) {
    const index = steps.findIndex((step) => step.uses === preparation);
    assert.ok(index >= 0, `${file}:${name} needs shared database preparation`);
    assert.equal(steps[index]["continue-on-error"], undefined);
    assert.equal(steps[index].if, undefined);
    for (const [scanIndex, step] of steps.entries()) {
      if (!step.uses?.startsWith("aquasecurity/trivy-action@")) continue;
      scans++;
      assert.ok(scanIndex > index);
      assert.equal(step.with?.cache, "false", "the scanner must not restore older cache over prepared databases");
      assert.equal(step.with?.["skip-setup-trivy"], "true");
      assert.equal(step.with?.["cache-dir"], undefined, "all scans share the prepared default cache directory");
      assert.equal(step["continue-on-error"], undefined);
      assert.equal(step.with?.["exit-code"], "0", "finding policy remains in its existing separate gate");
    }
  }
  assert.equal(scans, 8);
  assert.ok(!jobs.some(({ file }) => file === "release.yml"), "promotion must not restart scanning");
});

test("given shared database preparation, when it finishes, then only successful native preparation enables offline scans", () => {
  // given
  const action = yaml.load(read(".github/actions/trivy-databases/action.yml"));
  const steps = action.runs.steps;
  const prepare = steps.findIndex((step) => /node tools\/security-trivy-database\.mjs/.test(step.run ?? ""));

  // when / then
  assert.ok(steps.slice(0, prepare).some((step) => step.uses?.startsWith("aquasecurity/setup-trivy@")));
  assert.ok(steps.slice(0, prepare).some((step) => step.uses?.startsWith("actions/cache@")));
  assert.equal(steps[prepare]["continue-on-error"], undefined);
  assert.equal(steps[prepare].shell, "bash");
  const command = steps[prepare].run;
  assert.ok(command.indexOf("node tools/") < command.indexOf("TRIVY_SKIP_DB_UPDATE=true"));
  assert.match(command, /TRIVY_SKIP_JAVA_DB_UPDATE=true/);
  assert.match(command, /GITHUB_ENV/);
});
