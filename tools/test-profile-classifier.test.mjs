import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { bindPlanToRun, classifyChanges, classifyPath, fallbackPlanToRun, parseNameStatus,
  profilePolicyFingerprint, profileSummary } from "./test-profile-classifier.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const planSchema = JSON.parse(readFileSync(
  new URL("../ci/test-profile-plan.schema.json", import.meta.url), "utf8"));
const profileRules = JSON.parse(readFileSync(
  new URL("../ci/test-profiles.json", import.meta.url), "utf8"));
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

test("given critical unknown or structural changes, when classifying, then each fails closed to full", () => {
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
    [{ status: "A", path: "docs/new-guide.md" }],
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
  assert.ok(classifications.every((classification) => classification?.profile === "full"));
});

test("given any structural change, when classifying known reduced paths, then each selects full", () => {
  // given
  const statuses = ["A", "D", "R100", "C100", "T", "U", "X", "B"];

  // when / then
  for (const status of statuses) {
    assert.deepEqual(classifyChanges([{ status, path: "frontend/src/App.tsx" }], []).profiles, ["full"]);
  }
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
  const rendered = profileSummary(plan);

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
  assert.equal(bound.schemaVersion, 3);
  assert.match(bound.policyFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(bound.policyFingerprint, profilePolicyFingerprint());
  assert.equal(bound.runId, 101);
  assert.equal(bound.attempt, 1);
  assert.equal(bound.baseCommit, "a".repeat(40));
  assert.equal(bound.headCommit, "b".repeat(40));
  assert.equal(bound.plannerOutcome, "passed");
  assert.deepEqual(bound.profiles, ["docs"]);
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
  assert.deepEqual(fallback.reasons, [
    { code: "classifier-error", path: null, profile: "full", status: null }
  ]);
  assert.equal(validatePlan(fallback), true, JSON.stringify(validatePlan.errors));
  assert.doesNotMatch(JSON.stringify(fallback), /message|stack|error.*error/i);
});
