import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { bindPlanToRun, classifyChanges, classifyPath, fallbackPlanToRun, parseNameStatus,
  profileSummary, validateGitHubManifest, validateRules, validateToolManifest } from "./test-profile-classifier.mjs";
import { profilePolicyFingerprint } from "./test-profile-contract.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const planSchema = JSON.parse(readFileSync(
  new URL("../ci/test-profile-plan.schema.json", import.meta.url), "utf8"));
const profileRules = JSON.parse(readFileSync(
  new URL("../ci/test-profiles.json", import.meta.url), "utf8"));
const toolManifest = JSON.parse(readFileSync(
  new URL("../ci/tool-profile-manifest.json", import.meta.url), "utf8"));
const githubManifest = JSON.parse(readFileSync(
  new URL("../ci/github-profile-manifest.json", import.meta.url), "utf8"));
const validatePlan = new Ajv({ strict: true }).compile(planSchema);

test("given tracked repository paths, when classifying each path, then none depends on the unknown fallback", () => {
  // given
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: repository, encoding: "utf8" })
    .split("\0").filter(Boolean);

  // when
  const classifications = paths.map((path) => ({ path, classification: classifyPath(path) }));

  // then
  assert.deepEqual(classifications.filter(({ classification }) => classification === null), []);
});

test("given the reviewed tool inventory, when tracked files change, then every tool remains assigned exactly once", () => {
  // given
  const trackedTools = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "tools"],
    { cwd: repository, encoding: "utf8" })
    .trim().split("\n").filter(Boolean);

  // when / then
  validateToolManifest(toolManifest, trackedTools);
});

test("given the reviewed GitHub inventory, when tracked files change, then every reduced file names an executable validator", () => {
  // given
  const trackedGitHub = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", ".github"],
    { cwd: repository, encoding: "utf8" }).trim().split("\n").filter(Boolean);

  // when / then
  validateGitHubManifest(githubManifest, trackedGitHub, toolManifest);
});

test("given stale unknown or unvalidated GitHub metadata, when validating or classifying, then it fails closed", () => {
  // given
  const missingValidator = { schemaVersion: 1, entries: [
    { path: ".github/dependabot.yml", profiles: ["tooling"], validators: [] }
  ] };
  const unknownValidator = { schemaVersion: 1, entries: [
    { path: ".github/dependabot.yml", profiles: ["tooling"], validators: ["tools/missing.test.mjs"] }
  ] };
  const duplicate = { schemaVersion: 1, entries: [
    { path: ".github/dependabot.yml", profiles: ["tooling"], validators: ["tools/github-metadata.test.mjs"] },
    { path: ".github/dependabot.yml", profiles: ["full"], validators: [] }
  ] };
  const stale = { schemaVersion: 1, entries: [
    { path: ".github/dependabot.yml", profiles: ["tooling"], validators: ["tools/github-metadata.test.mjs"] }
  ] };

  // when / then
  assert.throws(() => validateGitHubManifest(missingValidator, undefined, toolManifest), /manifest is invalid/i);
  assert.throws(() => validateGitHubManifest(unknownValidator, undefined, toolManifest), /validator is invalid/i);
  assert.throws(() => validateGitHubManifest(duplicate, undefined, toolManifest), /manifest is invalid/i);
  assert.throws(() => validateGitHubManifest(stale, [".github/new.yml"], toolManifest), /inventory is stale/i);
  assert.deepEqual(classifyChanges([{ status: "A", path: ".github/new-metadata.yml" }], []).profiles, ["full"]);
});

test("given reviewed GitHub metadata, when classifying, then templates and validated automation use their declared checks", () => {
  // when / then
  assert.deepEqual(classifyChanges([{ status: "M", path: ".github/ISSUE_TEMPLATE/bug.md" }], []).profiles, ["docs"]);
  assert.deepEqual(classifyChanges([{ status: "M", path: ".github/dependabot.yml" }], []).profiles, ["tooling"]);
  assert.deepEqual(classifyChanges([{ status: "M", path: ".github/workflows/pr-title-lint.yml" }], []).profiles,
    ["tooling"]);
  assert.deepEqual(classifyChanges([{ status: "M", path: ".github/workflows/build.yml" }], []).profiles, ["full"]);
});

test("given backend and frontend changes, when classifying, then both reduced profiles are observed", () => {
  // given
  const changes = [
    { status: "M", path: "src/main/java/org/courtside/booking/BookingService.java" },
    { status: "M", path: "frontend/src/App.tsx" }
  ];

  // when
  const plan = classifyChanges(changes, []);

  // then
  assert.deepEqual(plan.profiles, ["backend", "frontend"]);
  assert.equal(plan.isFull, false);
});

test("given critical unknown or destructive changes, when classifying, then each fails closed to full", () => {
  // given
  const cases = [
    [{ status: "M", path: "pom.xml" }],
    [{ status: "M", path: ".github/workflows/build.yml" }],
    [{ status: "M", path: "deploy/compose.yaml" }],
    [{ status: "M", path: "security/run-contract.json" }],
    [{ status: "M", path: "SECURITY.md" }],
    [{ status: "M", path: "AGENTS.md" }],
    [{ status: "M", path: "src/main/resources/application.yaml" }],
    [{ status: "M", path: "tools/test-profile-classifier.mjs" }],
    [{ status: "M", path: "src/test/java/org/courtside/AbstractIntegrationTest.java" }],
    [{ status: "M", path: "src/main/resources/db/migration/V1__baseline.sql" }],
    [{ status: "M", path: "src/main/resources/api/openapi.yaml" }],
    [{ status: "M", path: "unknown/new-surface.txt" }],
    [{ status: "D", path: "docs/old-guide.md" }],
    [{ status: "R100", path: "docs/old.md", previousPath: "docs/new.md" }]
  ];

  // when / then
  for (const changes of cases) assert.deepEqual(classifyChanges(changes, []).profiles, ["full"]);
});

test("given every configured full trigger, when classifying, then each selects full", () => {
  // given
  const exactPaths = profileRules.profiles.full.exact;
  const prefixedPaths = profileRules.profiles.full.prefixes.map((prefix) => `${prefix}representative`);

  // when
  const classifications = [...exactPaths, ...prefixedPaths].map((path) => classifyPath(path));

  // then
  assert.ok(classifications.length > 0);
  assert.ok(classifications.every((classification) => classification?.profiles.includes("full")));
});

test("given reviewed tool assignments, when classifying changes, then tests reduce and runners remain full", () => {
  // when / then
  assert.deepEqual(classifyChanges([
    { status: "M", path: "tools/mail-check.test.mjs" }
  ], []).profiles, ["tooling"]);
  assert.deepEqual(classifyChanges([
    { status: "M", path: "tools/courtside.mjs" }
  ], []).profiles, ["full"]);
  assert.deepEqual(classifyChanges([
    { status: "A", path: "tools/new-policy.test.mjs" }
  ], []).profiles, ["full"]);
});

test("given duplicate or stale tool assignments, when validating the manifest, then it fails closed", () => {
  // given
  const duplicate = { schemaVersion: 1, entries: [
    { path: "tools/example.test.mjs", profiles: ["tooling"], test: true },
    { path: "tools/example.test.mjs", profiles: ["full"], test: false }
  ] };
  const stale = { schemaVersion: 1, entries: [
    { path: "tools/missing.test.mjs", profiles: ["tooling"], test: true }
  ] };

  // when / then
  assert.throws(() => validateToolManifest(duplicate), /manifest is invalid/i);
  assert.throws(() => validateToolManifest(stale, ["tools/current.test.mjs"]), /inventory is stale/i);
});

test("given malformed path rules, when loading their contract, then classification fails closed", () => {
  // given
  const openPattern = structuredClone(profileRules);
  openPattern.profiles.frontend.patterns[0].unknown = "value";
  const missingProfiles = structuredClone(profileRules);
  delete missingProfiles.profiles.full;

  // when / then
  assert.throws(() => validateRules(openPattern), /path rules are invalid/i);
  assert.throws(() => validateRules(missingProfiles), /path rules are invalid/i);
});

test("given added known paths, when classifying them, then the declared reduced profiles apply", () => {
  // given
  const changes = [
    { status: "A", path: "docs/new-guide.md" },
    { status: "A", path: "src/main/java/org/courtside/NewService.java" },
    { status: "A", path: "frontend/src/NewView.tsx" }
  ];

  // when / then
  assert.deepEqual(classifyChanges(changes, []).profiles, ["docs", "backend", "frontend"]);
  assert.ok(classifyChanges(changes, []).reasons.every((reason) => reason.status === "A"));
  assert.deepEqual(classifyChanges([{ status: "A", path: "unknown/new.txt" }], []).profiles, ["full"]);
});

test("given e2e evidence or orchestration, when classifying it, then only executable evidence is frontend", () => {
  // when / then
  for (const path of [
    "frontend/e2e/accessibility.spec.ts",
    "frontend/e2e/new-journey.spec.ts",
    "frontend/e2e/visual-regression.spec.ts-snapshots/new-state.png",
    "frontend/e2e/static-fixtures/import.csv"
  ]) {
    assert.deepEqual(classifyChanges([{ status: "A", path }], []).profiles, ["frontend"]);
  }
  assert.deepEqual(classifyChanges([{ status: "M", path: "src/test/example.spec.ts" }], []).profiles,
    ["backend"]);
  for (const path of [
    "frontend/e2e/global-setup.ts",
    "frontend/e2e/fixtures.ts",
    "frontend/e2e/browser-container-lifecycle.ts",
    "frontend/e2e/browser-container-lifecycle.test.ts",
    "frontend/e2e/journey-control.ts",
    "frontend/e2e/visual-regression.spec.ts-snapshots/update-baseline.sh",
    "frontend/e2e/static-fixtures/setup.ts"
  ]) {
    assert.deepEqual(classifyChanges([{ status: "A", path }], []).profiles, ["full"]);
  }
});

test("given a non additive structural status, when classifying known reduced paths, then each selects full", () => {
  // given
  const statuses = ["D", "R100", "C100", "T", "U", "X", "B"];

  // when / then
  for (const status of statuses) {
    const change = status.startsWith("R") || status.startsWith("C")
      ? { status, previousPath: "frontend/src/Old.tsx", path: "frontend/src/App.tsx" }
      : { status, path: "frontend/src/App.tsx" };
    assert.deepEqual(classifyChanges([change], []).profiles, ["full"]);
  }
  assert.throws(() => classifyChanges([{ status: "Z", path: "frontend/src/App.tsx" }], []), /status/);
});

test("given a full label, when classifying, then it can escalate but no label can suppress full", () => {
  // given
  const docs = [{ status: "M", path: "docs/design.md" }];
  const critical = [{ status: "M", path: ".github/workflows/build.yml" }];

  // when / then
  assert.deepEqual(classifyChanges(docs, ["ci:full"]).profiles, ["full"]);
  assert.deepEqual(classifyChanges(critical, ["ci:docs"]).profiles, ["full"]);
});

test("given only known documentation changes, when no labels are available, then the docs profile is safe for forks", () => {
  // given
  const changes = [{ status: "M", path: "docs/design.md" }];

  // when
  const plan = classifyChanges(changes, []);

  // then
  assert.deepEqual(plan.profiles, ["docs"]);
  assert.equal(plan.reasons[0].code, "prefix:docs/");
  assert.match(profileSummary(bindPlanToRun(plan, {
    runId: 101,
    attempt: 1,
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40)
  })), /required build runs only the jobs assigned/);
});

test("given null delimited git evidence, when parsing, then renames keep both paths and malformed input fails", () => {
  // given
  const evidence = "M\0docs/design.md\0R100\0docs/old.md\0docs/new.md\0";

  // when
  const changes = parseNameStatus(evidence);

  // then
  assert.deepEqual(changes, [
    { status: "M", path: "docs/design.md" },
    { status: "R100", previousPath: "docs/old.md", path: "docs/new.md" }
  ]);
  assert.throws(() => parseNameStatus("M\0docs/design.md"), /malformed/);
});

test("given a repository path contains markdown, when rendering reasons, then it cannot inject summary content", () => {
  // given
  const plan = classifyChanges([{
    status: "M", path: "unknown/<b>@team|`![open](https://example.org)\n\u202e\u200freversed.md"
  }], []);

  // when
  const rendered = profileSummary(bindPlanToRun(plan, {
    runId: 101,
    attempt: 1,
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40)
  }));

  // then
  const code = rendered.match(/<code>([^<]*)<\/code>/)?.[1];
  assert.ok(code);
  assert.match(code, /^(?:&#x[0-9a-f]+;)+$/);
  const visible = code.replace(/&#x([0-9a-f]+);/g,
    (_entity, point) => String.fromCodePoint(Number.parseInt(point, 16)));
  assert.match(visible, /\\u\{202e\}\\u\{200f\}/);
  assert.doesNotMatch(rendered, /<b>|@team|\[open\]|\u202e|\u200f|\nreversed/);
});

test("given a profile plan, when binding it to the workflow run, then every identity is retained", () => {
  // given
  const plan = classifyChanges([{ status: "M", path: "docs/design.md" }], []);

  // when
  const bound = bindPlanToRun(plan, {
    runId: 101,
    attempt: 1,
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40)
  });

  // then
  assert.equal(bound.schemaVersion, 4);
  assert.match(bound.proposedPolicyFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(bound.proposedPolicyFingerprint, profilePolicyFingerprint());
  assert.equal(bound.runId, 101);
  assert.equal(bound.attempt, 1);
  assert.equal(bound.baseCommit, "a".repeat(40));
  assert.equal(bound.headCommit, "b".repeat(40));
  assert.equal(bound.plannerOutcome, "passed");
  assert.deepEqual(bound.activeProfiles, ["docs"]);
  assert.deepEqual(bound.proposedProfiles, ["docs"]);
  assert.equal(bound.admissionOutcome, "matched");
  assert.equal(bound.activePolicyFingerprint, bound.proposedPolicyFingerprint);
  assert.equal(validatePlan(bound), true, JSON.stringify(validatePlan.errors));
  assert.throws(() => bindPlanToRun(plan, { ...bound, runId: 0 }), /identity/);
});

test("given the classifier fails, when binding fallback evidence, then the plan fails closed without raw errors", () => {
  // when
  const fallback = fallbackPlanToRun({
    runId: 101,
    attempt: 1,
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40)
  });

  // then
  assert.equal(fallback.plannerOutcome, "failed");
  assert.deepEqual(fallback.activeProfiles, ["full"]);
  assert.deepEqual(fallback.proposedProfiles, ["full"]);
  assert.deepEqual(fallback.reasons, [
    { code: "classifier-error", path: null, profile: "full", status: null }
  ]);
  assert.equal(validatePlan(fallback), true, JSON.stringify(validatePlan.errors));
  assert.doesNotMatch(JSON.stringify(fallback), /message|stack|error.*error/i);
});
