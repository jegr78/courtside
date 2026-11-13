import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { bindPlanToRun, classifyChanges, classifyChangesAtCommits, classifyPath, fallbackPlanToRun, parseNameStatus,
  executedTests, profileSummary, validateGitHubManifest, validateRules,
  validateToolManifest } from "./test-profile-classifier.mjs";
import { ciJobsForProfiles, loadProfileContract } from "./test-profile-contract.mjs";

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
  validateGitHubManifest(githubManifest, trackedGitHub, toolManifest, executedTests(toolManifest));
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

test("given a reduced GitHub entry, when no job of its own profiles runs the named validator, then validation fails closed", () => {
  // given
  const executed = executedTests(toolManifest);
  const unreachable = { schemaVersion: 1, entries: [
    { path: ".github/ISSUE_TEMPLATE/bug.md", profiles: ["docs"],
      validators: ["tools/github-metadata.test.mjs"] }
  ] };
  const reachable = { schemaVersion: 1, entries: [
    { path: ".github/ISSUE_TEMPLATE/bug.md", profiles: ["docs"],
      validators: ["tools/github-template-metadata.test.mjs"] }
  ] };
  const throughTooling = { schemaVersion: 1, entries: [
    { path: ".github/ISSUE_TEMPLATE/bug.md", profiles: ["tooling"],
      validators: ["tools/github-metadata.test.mjs"] }
  ] };

  // when / then
  assert.ok(!executed.docs.includes("tools/github-metadata.test.mjs"));
  assert.ok(executed.tooling.includes("tools/github-metadata.test.mjs"));
  assert.throws(() => validateGitHubManifest(unreachable, undefined, toolManifest, executed),
    /validator is unreachable/i);
  validateGitHubManifest(reachable, undefined, toolManifest, executed);
  validateGitHubManifest(throughTooling, undefined, toolManifest, executed);
});

test("given reviewed GitHub metadata, when classifying, then templates and validated automation use their declared checks", () => {
  // given
  const contract = loadProfileContract();

  // when / then
  assert.deepEqual(classifyChanges([{ status: "M", path: ".github/ISSUE_TEMPLATE/bug.md" }], []).profiles, ["docs"]);
  assert.deepEqual(ciJobsForProfiles(contract, ["docs"]), ["docs", "tooling"]);
  assert.deepEqual(classifyChanges([{ status: "M", path: ".github/dependabot.yml" }], []).profiles, ["tooling"]);
  assert.deepEqual(classifyChanges([{ status: "M", path: ".github/workflows/pr-title-lint.yml" }], []).profiles,
    ["tooling"]);
  assert.deepEqual(classifyChanges([{ status: "M", path: ".github/workflows/build.yml" }], []).profiles, ["full"]);
});

test("given a file that decides the selection, when classifying it, then it can never select a reduced profile", () => {
  // given
  const deciding = [
    ".github/workflows/build.yml", "ci/github-profile-manifest.json", "ci/node-toolchain.json",
    "ci/test-profile-contract.json", "ci/test-profile-plan.schema.json", "ci/test-profiles.json",
    "ci/tool-profile-manifest.json", "frontend/package.json", "tools/docs-check.mjs",
    "tools/local-check.mjs", "tools/node-toolchain.mjs", "tools/test-profile-classifier.mjs",
    "tools/test-profile-contract.mjs", "tools/tool-tests.mjs"
  ];
  const selfChecking = ["tools/github-metadata.test.mjs", "tools/github-template-metadata.test.mjs",
    "tools/workflow-action-pinning.test.mjs"];

  // when / then
  for (const path of deciding) {
    assert.deepEqual(classifyChanges([{ status: "M", path }], []).profiles, ["full"], path);
  }
  for (const path of selfChecking) {
    assert.deepEqual(classifyChanges([{ status: "M", path }], []).profiles, ["tooling"], path);
  }
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

test("given agent policy prose changes, when classifying, then bounded documentation checks apply", () => {
  // when / then
  assert.deepEqual(classifyChanges([{ status: "M", path: "AGENTS.md" }], []).profiles, ["docs"]);
  assert.deepEqual(classifyChanges([{ status: "M", path: "CLAUDE.md" }], []).profiles, ["docs"]);
  assert.deepEqual(classifyChanges([{ status: "D", path: "CLAUDE.md" }], []).profiles, ["full"]);
});

test("given the community health files, when classifying, then bounded documentation checks apply", () => {
  // when / then
  assert.deepEqual(classifyChanges([{ status: "M", path: "CONTRIBUTING.md" }], []).profiles, ["docs"]);
  assert.deepEqual(classifyChanges([{ status: "M", path: "CODE_OF_CONDUCT.md" }], []).profiles, ["docs"]);
  assert.deepEqual(classifyChanges([{ status: "D", path: "CONTRIBUTING.md" }], []).profiles, ["full"]);
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

test("given an added tool test and an additive manifest entry, when classifying commits, "
  + "then tooling is enough", () => {
  // given
  const addedPath = "tools/new-policy.test.mjs";
  const headManifest = structuredClone(toolManifest);
  headManifest.entries.push({ path: addedPath, profiles: ["tooling"], test: true });
  const changes = [
    { status: "M", path: "ci/tool-profile-manifest.json" },
    { status: "A", path: addedPath }
  ];

  // when
  const plan = classifyChangesAtCommits(changes, [], commitInventory(headManifest));

  // then
  assert.deepEqual(plan.profiles, ["tooling"]);
  assert.equal(plan.isFull, false);
  assert.deepEqual(plan.reasons.map(({ path, profile }) => ({ path, profile })), [
    { path: "ci/tool-profile-manifest.json", profile: "tooling" },
    { path: addedPath, profile: "tooling" }
  ]);
});

test("given an additive full runner, when classifying commits, then it still selects full", () => {
  // given
  const addedPath = "tools/new-runner.mjs";
  const headManifest = structuredClone(toolManifest);
  headManifest.entries.push({ path: addedPath, profiles: ["full"], test: false });
  const changes = [
    { status: "M", path: "ci/tool-profile-manifest.json" },
    { status: "A", path: addedPath }
  ];

  // when
  const plan = classifyChangesAtCommits(changes, [], commitInventory(headManifest));

  // then
  assert.deepEqual(plan.profiles, ["full"]);
});

test("given an additive non-test claims a reduced profile, when classifying commits, then it selects full", () => {
  // given
  const addedPath = "tools/new-runner.mjs";
  const headManifest = structuredClone(toolManifest);
  headManifest.entries.push({ path: addedPath, profiles: ["docs"], test: false });
  const changes = [
    { status: "M", path: "ci/tool-profile-manifest.json" },
    { status: "A", path: addedPath }
  ];

  // when
  const plan = classifyChangesAtCommits(changes, [], commitInventory(headManifest));

  // then
  assert.deepEqual(plan.profiles, ["full"]);
});

test("given a narrowed or stale tool manifest, when classifying commits, then it fails closed to full", () => {
  // given
  const removed = structuredClone(toolManifest);
  removed.entries = removed.entries.filter((entry) => entry.path !== "tools/mail-check.test.mjs");
  const moved = structuredClone(toolManifest);
  moved.entries.find((entry) => entry.path === "tools/courtside.mjs").profiles = ["tooling"];
  const nonexistent = structuredClone(toolManifest);
  nonexistent.entries.push({ path: "tools/missing.test.mjs", profiles: ["tooling"], test: true });
  const unrelatedBase = structuredClone(toolManifest);
  unrelatedBase.entries.reverse();
  const additive = structuredClone(toolManifest);
  additive.entries.push({ path: "tools/new-policy.test.mjs", profiles: ["tooling"], test: true });
  const manifestChange = [{ status: "M", path: "ci/tool-profile-manifest.json" }];

  // when / then
  assert.deepEqual(classifyChangesAtCommits(manifestChange, [], commitInventory(removed)).profiles, ["full"]);
  assert.deepEqual(classifyChangesAtCommits(manifestChange, [], commitInventory(moved)).profiles, ["full"]);
  assert.deepEqual(classifyChangesAtCommits([
    ...manifestChange, { status: "A", path: "tools/missing.test.mjs" }
  ], [], commitInventory(nonexistent, { omit: ["tools/missing.test.mjs"] })).profiles, ["full"]);
  assert.deepEqual(classifyChangesAtCommits(manifestChange, [], commitInventory(
    toolManifest, { baseManifest: unrelatedBase }
  )).profiles, ["full"]);
  assert.deepEqual(classifyChangesAtCommits([
    ...manifestChange,
    { status: "A", path: "tools/new-policy.test.mjs" },
    { status: "A", path: "tools/unlisted-helper.mjs" }
  ], [], commitInventory(additive, { extra: ["tools/unlisted-helper.mjs"] })).profiles, ["full"]);
});

test("given the deployment guide changes, when classifying it, then only modifications use documentation checks", () => {
  // when / then
  assert.deepEqual(classifyChanges([{ status: "M", path: "deploy/README.md" }], []).profiles, ["docs"]);
  assert.deepEqual(classifyChanges([{ status: "D", path: "deploy/README.md" }], []).profiles, ["full"]);
  assert.deepEqual(classifyChanges([{
    status: "R100", previousPath: "deploy/README.md", path: "deploy/OPERATIONS.md"
  }], []).profiles, ["full"]);
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

test("given a change to the security environment's tools, when classifying it, then its own gate replaces the full run", () => {
  // given
  const environment = [
    { status: "M", path: "tools/security-environment.mjs" },
    { status: "M", path: "tools/security-mail-capture.mjs" },
    { status: "M", path: "tools/security-environment.test.mjs" },
    { status: "M", path: "tools/security-mail-capture.test.mjs" }
  ];

  // when / then
  assert.deepEqual(classifyChanges(environment, []).profiles, ["tooling", "security-tooling"]);
  assert.deepEqual(classifyChanges([...environment, { status: "M", path: "src/main/java/org/courtside/Booking.java" }],
    []).profiles, ["backend", "tooling", "security-tooling"]);
  assert.deepEqual(classifyChanges([{ status: "A", path: "tools/security-new-step.mjs" }], []).profiles, ["full"],
    "an unlisted tool still selects everything");
  assert.deepEqual(classifyChanges([{ status: "M", path: "tools/security-passive-deployment.mjs" }], []).profiles,
    ["full"], "the scanner normalizers and the workflow tools stay on the full run");
  assert.deepEqual(classifyChanges([{ status: "M", path: "tools/mail-relay-certificate.mjs" }], []).profiles,
    ["full"], "the restore and performance relays share this tool");
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

test("given an additive manifest reason contains markdown, when rendering it, then it remains inert", () => {
  // given
  const addedPath = "tools/![open](x)\u202e.test.mjs";
  const headManifest = structuredClone(toolManifest);
  headManifest.entries.push({ path: addedPath, profiles: ["tooling"], test: true });
  const plan = classifyChangesAtCommits([
    { status: "M", path: "ci/tool-profile-manifest.json" },
    { status: "A", path: addedPath }
  ], [], commitInventory(headManifest));

  // when
  const rendered = profileSummary(bindPlanToRun(plan, {
    runId: 101,
    attempt: 1,
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40)
  }));

  // then
  assert.doesNotMatch(rendered, /\[open\]|\u202e/);
  const visibleCodes = [...rendered.matchAll(/<code>([^<]*)<\/code>/g)].map((match) => match[1]
    .replace(/&#x([0-9a-f]+);/g, (_entity, point) => String.fromCodePoint(Number.parseInt(point, 16))));
  assert.ok(visibleCodes.some((code) => code.includes("\\u{202e}")));
});

test("given changes beside the API and security surface, when classifying, then the pull request skips the active assessment", () => {
  // when / then
  for (const path of [
    "frontend/src/views/AdminOverviewView.tsx",
    "src/main/java/org/courtside/booking/internal/BookingService.java",
    "docs/design.md",
    "frontend/e2e/message-log.spec.ts",
    "ci/test-profiles.json",
    "src/main/resources/db/migration/V98__example.sql"
  ]) {
    assert.equal(classifyChanges([{ status: "M", path }], []).activeSecurity, false, path);
  }
});

test("given a change to the API or security surface, when classifying, then the pull request runs the active assessment", () => {
  // when / then
  for (const path of [
    "src/main/resources/api/openapi.yaml",
    "src/main/java/org/courtside/booking/web/BookingController.java",
    "src/main/java/org/courtside/shared/web/AdmissionControl.java",
    "src/main/java/org/courtside/identity/internal/SecurityConfiguration.java",
    "src/main/java/org/courtside/identity/internal/LoginAttemptFilter.java",
    "src/main/resources/application.yaml",
    "src/main/resources/application-security.yaml",
    "security/zap-authenticated-policy.json",
    "deploy/Caddyfile",
    "tools/security-passive-deployment.mjs",
    "Dockerfile",
    "Dockerfile.fixtures",
    "pom.xml",
    ".github/workflows/release-gates.yml",
    ".github/actions/gate-image/action.yml",
    ".github/actions/tool-dependencies/action.yml",
    "src/main/java/org/courtside/securityassessment/SecurityAssessmentDataSeeder.java",
    "src/main/resources/security-assessment-dataset.properties",
    "tools/courtside.mjs"
  ]) {
    assert.equal(classifyChanges([{ status: "M", path }], []).activeSecurity, true, path);
  }
});

test("given an unclassifiable, structural or forced change, when classifying, then the active assessment runs", () => {
  // when / then
  assert.equal(classifyChanges([{ status: "M", path: "unknown/place.txt" }], []).activeSecurity, true, "unknown path");
  assert.equal(classifyChanges([{ status: "D", path: "frontend/src/App.tsx" }], []).activeSecurity, true, "deletion");
  assert.equal(classifyChanges([{ status: "M", path: "docs/design.md" }], ["ci:full"]).activeSecurity, true, "ci:full");
  assert.equal(fallbackPlanToRun({ runId: 1, attempt: 1, baseCommit: "a".repeat(40), headCommit: "b".repeat(40) })
    .activeSecurity, true, "a failed classification");
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
  assert.equal(bound.schemaVersion, 7);
  assert.equal(bound.activeSecurity, false);
  assert.equal(bound.runId, 101);
  assert.equal(bound.attempt, 1);
  assert.equal(bound.baseCommit, "a".repeat(40));
  assert.equal(bound.headCommit, "b".repeat(40));
  assert.equal(bound.plannerOutcome, "passed");
  assert.deepEqual(bound.profiles, ["docs"]);
  assert.deepEqual(bound.ciJobs, ["docs", "tooling"]);
  assert.deepEqual(bound.localTasks.map((task) => task.label),
    ["docs-check", "frontend-toolchain", "site-install", "site-build", "tooling-test"]);
  assert.equal(bound.isFull, false);
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
  assert.deepEqual(fallback.profiles, ["full"]);
  assert.equal(fallback.isFull, true);
  assert.deepEqual(fallback.reasons, [
    { code: "classifier-error", path: null, profile: "full", status: null }
  ]);
  assert.equal(validatePlan(fallback), true, JSON.stringify(validatePlan.errors));
  assert.doesNotMatch(JSON.stringify(fallback), /message|stack|error.*error/i);
});

function commitInventory(headManifest, { baseManifest = toolManifest, omit = [], extra = [] } = {}) {
  const baseCommit = "a".repeat(40);
  const headCommit = "b".repeat(40);
  const tracked = [
    ...headManifest.entries.filter((entry) => !omit.includes(entry.path)).map((entry) => entry.path),
    ...extra
  ].join("\0");
  return {
    baseCommit,
    headCommit,
    git: (arguments_) => {
      if (arguments_[0] === "show" && arguments_[1] === `${baseCommit}:ci/tool-profile-manifest.json`) {
        return JSON.stringify(baseManifest);
      }
      if (arguments_[0] === "show" && arguments_[1] === `${headCommit}:ci/tool-profile-manifest.json`) {
        return JSON.stringify(headManifest);
      }
      if (arguments_[0] === "ls-tree") {
        assert.deepEqual(arguments_, ["ls-tree", "-r", "-z", "--name-only", headCommit, "--", "tools"]);
        return `${tracked}\0`;
      }
      throw new Error(`Unexpected git call: ${arguments_.join(" ")}`);
    }
  };
}

test("given the files release-please changed in a release commit, when they are classified, then the plan is full", () => {
  // given
  const changes = parseNameStatus(execFileSync("git",
    ["diff", "--name-status", "-z", "--find-renames", "b1cd6c3a^", "b1cd6c3a"],
    { cwd: repository, encoding: "utf8" }));

  // when
  const plan = bindPlanToRun(classifyChanges(changes, []),
    { runId: 1, attempt: 1, baseCommit: "a".repeat(40), headCommit: "b".repeat(40) });

  // then
  assert.deepEqual(plan.profiles, ["full"], "a release pull request must run every gate");
  assert.ok(plan.ciJobs.includes("gates"), "a release pull request runs the release gates");
  assert.equal(plan.activeSecurity, true, "a release pull request runs the active assessment too");
  assert.equal(plan.schemaVersion, 7);
});

function realCommits(commit, event, verifiedBase) {
  const git = (arguments_) => execFileSync("git", arguments_, { cwd: repository, encoding: "utf8" });
  return { baseCommit: git(["rev-parse", `${commit}^`]).trim(), headCommit: git(["rev-parse", commit]).trim(), git, event,
    verifiedBase };
}

function releaseChanges(commit) {
  return parseNameStatus(execFileSync("git",
    ["diff", "--name-status", "-z", "--find-renames", `${commit}^`, commit], { cwd: repository, encoding: "utf8" }));
}

for (const commit of ["b1cd6c3a", "94640424", "df0ac0cb", "3f355748"]) {
  test(`given release-please's own version bump ${commit} as a pull request, when it is classified, then only docs and tooling run`, () => {
    // when
    const plan = classifyChangesAtCommits(releaseChanges(commit), [], realCommits(commit, "pull_request"));

    // then
    assert.deepEqual(plan.profiles, ["docs"], JSON.stringify(plan.reasons));
    assert.equal(plan.isFull, false);
  });
}

test("given the same version bump pushed to main without a full build of its parent, when it is classified, then the plan stays full", () => {
  // when
  const plan = classifyChangesAtCommits(releaseChanges("94640424"), [], realCommits("94640424", "push"));

  // then
  assert.deepEqual(plan.profiles, ["full"], "the release commit on main feeds the candidate, so it is verified whole");
});

for (const commit of ["94640424", "3f355748"]) {
  test(`given release-please's version bump ${commit} pushed onto a parent with a full green build, when it is classified, then only docs run`, () => {
    // when
    const plan = classifyChangesAtCommits(releaseChanges(commit), [], realCommits(commit, "push", true));

    // then
    assert.deepEqual(plan.profiles, ["docs"], JSON.stringify(plan.reasons));
  });
}

test("given a verified parent and a push that changes code beside the version, when it is classified, then the plan is full", () => {
  // given
  const [changes, labels, commits] = syntheticRelease({
    changes: [...bumpChanges, { status: "M", path: "frontend/src/App.tsx" }], files: bumpFiles });

  // when
  const plan = classifyChangesAtCommits(changes, labels, { ...commits, event: "push", verifiedBase: true });

  // then
  assert.deepEqual(plan.profiles, ["full"], "the parent's build does not cover code the release commit adds");
});

function syntheticRelease({ changes, files }) {
  const baseCommit = "a".repeat(40);
  const headCommit = "b".repeat(40);
  return [changes, [], {
    baseCommit, headCommit, event: "pull_request",
    git: (arguments_) => {
      const [, commit, path] = /^([ab]{40}):(.+)$/.exec(arguments_[1]) ?? [];
      if (arguments_[0] !== "show" || !(path in files)) throw new Error(`Unexpected git call: ${arguments_.join(" ")}`);
      return files[path][commit === baseCommit ? 0 : 1];
    }
  }];
}

const bumpFiles = {
  ".release-please-manifest.json": ['{\n  ".": "1.2.0-rc.1"\n}\n', '{\n  ".": "1.2.0-rc.2"\n}\n'],
  "pom.xml": ["<version>1.2.0-rc.1</version>\n<x>1</x>\n", "<version>1.2.0-rc.2</version>\n<x>1</x>\n"]
};
const bumpChanges = [
  { status: "M", path: ".release-please-manifest.json" },
  { status: "M", path: "CHANGELOG.md" },
  { status: "M", path: "pom.xml" }
];

test("given a release file that changes more than its version, when the pull request is classified, then the plan is full", () => {
  // given
  const files = { ...bumpFiles, "pom.xml": [bumpFiles["pom.xml"][0], "<version>1.2.0-rc.2</version>\n<x>2</x>\n"] };

  // when
  const plan = classifyChangesAtCommits(...syntheticRelease({ changes: bumpChanges, files }));

  // then
  assert.deepEqual(plan.profiles, ["full"]);
});

test("given a version bump beside any other change, when the pull request is classified, then the plan is full", () => {
  // when
  const plan = classifyChangesAtCommits(...syntheticRelease({
    changes: [...bumpChanges, { status: "M", path: "frontend/src/App.tsx" }], files: bumpFiles }));

  // then
  assert.deepEqual(plan.profiles, ["full"]);
});

test("given release files without a version change in the manifest, when the pull request is classified, then the plan is full", () => {
  // when
  const plan = classifyChangesAtCommits(...syntheticRelease({
    changes: bumpChanges.filter(({ path }) => path !== ".release-please-manifest.json"), files: bumpFiles }));

  // then
  assert.deepEqual(plan.profiles, ["full"]);
});

test("given a version bump the reviewer can read, when the pull request is classified, then each version file names the rule", () => {
  // when
  const plan = classifyChangesAtCommits(...syntheticRelease({ changes: bumpChanges, files: bumpFiles }));

  // then
  assert.deepEqual(plan.profiles, ["docs"]);
  assert.deepEqual(plan.reasons.map(({ path, code }) => [path, code]), [
    [".release-please-manifest.json", "release-version:.release-please-manifest.json"],
    ["CHANGELOG.md", "exact:CHANGELOG.md"],
    ["pom.xml", "release-version:pom.xml"]
  ]);
});

test("given the pull request event on the command line, when the classifier plans a release bump, then the written plan selects docs", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "profile-plan-"));
  const commits = realCommits("94640424");
  const run = (extra) => {
    execFileSync(process.execPath, [fileURLToPath(new URL("./test-profile-classifier.mjs", import.meta.url)),
      "--base", commits.baseCommit, "--head", commits.headCommit, "--labels", "[]", "--run-id", "1", "--attempt", "1",
      "--output", join(directory, "plan.json"), "--summary", join(directory, "summary.md"), ...extra], { cwd: repository });
    return JSON.parse(readFileSync(join(directory, "plan.json"), "utf8"));
  };

  // when / then
  assert.deepEqual(run(["--event", "pull_request"]).profiles, ["docs"]);
  assert.deepEqual(run([]).profiles, ["full"], "without the event the bump is not reduced");
  assert.deepEqual(run(["--event", "push"]).profiles, ["full"], "a push is reduced only on a verified parent");
  assert.deepEqual(run(["--event", "push", "--verified-base"]).profiles, ["docs"]);
});

test("given a dependency that shares the release version, when the pull request bumps both, then the plan is full", () => {
  // given
  const files = { ...bumpFiles, "pom.xml": [
    "<version>1.2.0-rc.1</version>\n<dependency><version>1.2.0-rc.1</version></dependency>\n",
    "<version>1.2.0-rc.2</version>\n<dependency><version>1.2.0-rc.2</version></dependency>\n"] };

  // when
  const plan = classifyChangesAtCommits(...syntheticRelease({ changes: bumpChanges, files }));

  // then
  assert.deepEqual(plan.profiles, ["full"], "only the version fields release-please writes may change");
});

test("given a manifest version that is not a release version, when the pull request is classified, then the plan is full", () => {
  // given
  const files = {
    ".release-please-manifest.json": ['{\n  ".": "x"\n}\n', '{\n  ".": "y"\n}\n'],
    "pom.xml": ["<version>x</version>\n", "<version>y</version>\n"]
  };

  // when
  const plan = classifyChangesAtCommits(...syntheticRelease({ changes: bumpChanges, files }));

  // then
  assert.deepEqual(plan.profiles, ["full"]);
});
