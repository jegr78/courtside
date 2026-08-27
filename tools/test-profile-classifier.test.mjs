import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { classifyChanges, classifyPath, parseNameStatus, profileSummary } from "./test-profile-classifier.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));

test("givenTrackedRepositoryPaths_whenClassifyingEachPath_thenNoneDependsOnTheUnknownFallback", () => {
  // given
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: repository, encoding: "utf8" })
    .split("\0").filter(Boolean);

  // when
  const classifications = paths.map((path) => ({ path, classification: classifyPath(path) }));

  // then
  assert.deepEqual(classifications.filter(({ classification }) => classification === null), []);
});

test("givenBackendAndFrontendChanges_whenClassifying_thenBothReducedProfilesAreObserved", () => {
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

test("givenCriticalUnknownOrStructuralChanges_whenClassifying_thenEachFailsClosedToFull", () => {
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

test("givenAFullLabel_whenClassifying_thenItCanEscalateButNoLabelCanSuppressFull", () => {
  // given
  const docs = [{ status: "M", path: "docs/design.md" }];
  const critical = [{ status: "M", path: ".github/workflows/build.yml" }];

  // when / then
  assert.deepEqual(classifyChanges(docs, ["ci:full"]).profiles, ["full"]);
  assert.deepEqual(classifyChanges(critical, ["ci:docs"]).profiles, ["full"]);
});

test("givenOnlyKnownDocumentationChanges_whenNoLabelsAreAvailable_thenTheDocsProfileIsSafeForForks", () => {
  // given
  const changes = [{ status: "M", path: "docs/design.md" }];

  // when
  const plan = classifyChanges(changes, []);

  // then
  assert.deepEqual(plan.profiles, ["docs"]);
  assert.equal(plan.reasons[0].code, "prefix:docs/");
});

test("givenNullDelimitedGitEvidence_whenParsing_thenRenamesKeepBothPathsAndMalformedInputFails", () => {
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

test("givenARepositoryPathContainsMarkdown_whenRenderingReasons_thenItCannotInjectSummaryContent", () => {
  // given
  const plan = classifyChanges([{ status: "M", path: "unknown/<b>@team|`[open](https://example.org)\n.md" }], []);

  // when
  const rendered = profileSummary(plan);

  // then
  assert.doesNotMatch(rendered, /<b>|@team|\)\n\.md/);
  assert.match(rendered,
    /<code>unknown\/&lt;b&gt;&#64;team&#124;`\[open\]\(https:\/\/example\.org\)\\u000a\.md<\/code>/);
});
