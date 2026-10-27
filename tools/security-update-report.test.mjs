import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeComparisonRequired, securityRuntimeFiles, securityUpdateReport, semanticChanges,
  semanticJsonChanges, writeSecurityUpdateReport } from "./security-update-report.mjs";

test("given the actual npm lockfile, when release metadata alone changes, then the CLI skips a paired assessment but still detects dependency changes", () => {
  // given
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "release-assessment-identity-")));
  for (const child of ["tools", "security", "frontend"]) mkdirSync(join(directory, child));
  copyFileSync(new URL("./security-update-report.mjs", import.meta.url), join(directory, "tools/security-update-report.mjs"));
  copyFileSync(new URL("../security/run-contract.json", import.meta.url), join(directory, "security/run-contract.json"));
  const lock = JSON.parse(readFileSync(new URL("../frontend/package-lock.json", import.meta.url), "utf8"));
  const lockPath = join(directory, "frontend/package-lock.json");
  writeFileSync(lockPath, JSON.stringify(lock));
  const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  git("init");
  git("add", ".");
  git("-c", "user.name=Example Developer", "-c", "user.email=developer@example.org", "commit", "-m", "test: capture the actual lockfile");
  const compare = () => {
    execFileSync(process.execPath, [join(directory, "tools/security-update-report.mjs"), "--base", "HEAD",
      "--output", join(directory, "report.md"), "--identity-output", join(directory, "identity.json")], { stdio: "pipe" });
    return JSON.parse(readFileSync(join(directory, "identity.json"), "utf8")).comparisonRequired;
  };

  // when / then
  try {
    const release = structuredClone(lock);
    release.version = "0.4.0-rc.1";
    release.packages[""].version = "0.4.0-rc.1";
    writeFileSync(lockPath, JSON.stringify(release, null, 2) + "\n");
    assert.equal(compare(), false, "release-please changes only the two root version fields");
    const dependency = Object.keys(release.packages).find((name) => name.startsWith("node_modules/") && release.packages[name].version);
    release.packages[dependency].version = "99.0.0";
    writeFileSync(lockPath, JSON.stringify(release));
    assert.equal(compare(), true, "a resolved dependency version remains part of the assessment runtime");
    const constraint = structuredClone(lock);
    constraint.packages[""].devDependencies.ajv = "99.0.0";
    writeFileSync(lockPath, JSON.stringify(constraint));
    assert.equal(compare(), true, "root dependency constraints remain part of the assessment runtime");
    const inconsistent = structuredClone(lock);
    inconsistent.packages[""].version = "99.0.0";
    writeFileSync(lockPath, JSON.stringify(inconsistent));
    assert.equal(compare(), true, "inconsistent release metadata does not receive normalization");
    writeFileSync(lockPath, JSON.stringify(lock));
    const policyPath = join(directory, "security/run-contract.json");
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    policy.tools[0].version = "99.0.0";
    writeFileSync(policyPath, JSON.stringify(policy));
    assert.equal(compare(), true, "security tool version fields remain part of the assessment runtime");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given a proposed security-tool update, when comparing it with the base, then versions policies and schemas are visible", () => {
  // when
  const report = securityUpdateReport("origin/main");

  // then
  assert.match(report, /Previous runtime tools:/);
  assert.match(report, /Current runtime tools:/);
  assert.match(report, /security\/run-contract\.json/);
  assert.match(report, /security\/assessment-catalog\.json/);
  assert.match(report, /security\/assessment-gate\.schema\.json/);
  assert.match(report, /deploy\/compose\.security\.yaml/);
  assert.match(report, /Runtime comparison required: (?:yes|no)/);
  assert.match(report, /Previous SHA-256.*Current SHA-256.*Changed/);
  assert.match(report, /Rule and report-schema changes/);
});

test("given two runtime digests, when they are compared, then only a difference demands a run", () => {
  // when / then
  assert.equal(runtimeComparisonRequired({ baseRuntimeDigest: "a", candidateRuntimeDigest: "b" }), true);
  assert.equal(runtimeComparisonRequired({ baseRuntimeDigest: "a", candidateRuntimeDigest: "a" }), false);
});

// A file this test writes itself, so no commit reachable from any base can hold it. Reading the
// direction off the repository's own history needs a checkout deep enough to reach a commit that
// predates the file, which a shallow one is not.
test("given a file no base can hold, when it is compared, then it reads as added and not removed", () => {
  // given
  const probe = `build/comparison-direction-probe-${process.pid}.json`;
  const location = new URL(`../${probe}`, import.meta.url);
  mkdirSync(new URL("../build", import.meta.url), { recursive: true });
  writeFileSync(location, "{}");

  // when / then — swapped arguments would report the club's own rules as deleted
  try {
    const toolProbes = execFileSync("git",
      ["ls-files", "--others", "--exclude-standard", "tools/comparison-direction-probe-*.json"],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" }).trim();
    assert.equal(toolProbes, "", "a test probe must not race the tracked tool inventory");
    assert.deepEqual(semanticChanges(probe, "HEAD"), { added: ["/"], removed: [], modified: [] });
  } finally {
    rmSync(location);
  }
});

test("given a changed rule file, when its JSON paths are compared, then each kind of change is named", () => {
  // given
  const previous = JSON.stringify({ tools: { zap: { version: "2.16.1", active: true } } });
  const current = JSON.stringify({ tools: { zap: { version: "2.17.0", failOn: "high" } } });

  // when
  const changes = semanticJsonChanges(previous, current);

  // then
  assert.deepEqual(changes.added, ["/tools/zap/failOn"]);
  assert.deepEqual(changes.removed, ["/tools/zap/active"]);
  assert.deepEqual(changes.modified, ["/tools/zap/version"]);
});

test("given a rule file that is new or gone, when it is compared, then the whole document is the change", () => {
  // when / then
  assert.deepEqual(semanticJsonChanges(null, "{}"), { added: ["/"], removed: [], modified: [] });
  assert.deepEqual(semanticJsonChanges("{}", null), { added: [], removed: ["/"], modified: [] });
});

test("given the assessment runtime, when identifying a candidate, then execution normalization and assets contribute", () => {
  // when
  const files = new Set(securityRuntimeFiles);

  // then
  for (const path of [
    "tools/courtside.mjs", "tools/security-environment.mjs", "tools/security-triage.mjs",
    "tools/security-request-gateway.py", "deploy/compose.security.yaml",
    "deploy/Caddyfile.security", "frontend/package-lock.json",
    "security/run-contract.json", "security/resource-abuse.js"
  ]) assert.equal(files.has(path), true, path);
  for (const path of ["pom.xml", "frontend/package.json"]) {
    assert.equal(files.has(path), false,
      `${path} describes the application, and each side of a paired run now builds its own. A `
      + "dependency bump is not a tool update, and starting two stacks for one is why a branch that "
      + "touched no scanner could hold up every other branch.");
  }
});

test("given a fresh output directory, when writing the report, then its parent is created", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-security-update-"));
  const output = join(directory, "nested", "report.md");
  const identity = join(directory, "identity", "runtime.json");

  // when
  try {
    writeSecurityUpdateReport("origin/main", output, identity);

    // then
    assert.equal(existsSync(output), true);
    assert.match(readFileSync(output, "utf8"), /Security update comparison/);
    assert.equal(typeof JSON.parse(readFileSync(identity, "utf8")).comparisonRequired, "boolean");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
