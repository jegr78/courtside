import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  admissionSection, checkDocumentation, renderAdmissionDocument, writeAdmissionDocument
} from "./docs-check.mjs";

const admission = {
  schemaVersion: 3,
  admittedPolicyFingerprint: "a".repeat(64),
  evidence: {
    runId: 101,
    attempt: 1,
    artifact: "profile-evidence-101-1",
    windowStartedAt: "2026-08-28T00:00:00Z",
    windowEndedAt: "2026-08-30T10:00:00Z",
    assessedAt: "2026-08-30T10:00:00Z",
    expiresOn: "2026-09-30",
    status: "ready-for-review",
    qualifyingFirstAttempts: 20,
    backendPlans: 2,
    frontendPlans: 1,
    toolingPlans: 1,
    candidateMisses: 0,
    classificationErrors: 0,
    incompleteObservations: 2,
    ciTiming: {
      observedFirstAttempts: 22,
      successfulFirstAttempts: 20,
      medianDurationMs: 865000,
      p95DurationMs: 894000,
      runnerMinutes: 661.43,
      successfulMedianDurationMs: 862000,
      successfulP95DurationMs: 894000,
      successfulRunnerMinutes: 599.82
    },
    localTiming: {
      commit: "c".repeat(40),
      policyFingerprint: "a".repeat(64),
      status: "qualified",
      firstAttempts: 18,
      retries: 0,
      interruptedAttempts: 0,
      docs: { attempts: 3, medianMs: 204, maximumMs: 267 },
      tooling: { attempts: 3, medianMs: 14412, maximumMs: 14870 },
      backend: { attempts: 3, medianMs: 613648, maximumMs: 647435 },
      frontend: { attempts: 3, medianMs: 711164, maximumMs: 717124 },
      combined: { attempts: 3, medianMs: 1247036, maximumMs: 1310954 },
      full: { attempts: 3, medianMs: 1326984, maximumMs: 1390647 }
    },
    nightlies: [
      { runId: 201, attempt: 1, event: "schedule", commit: "d".repeat(40), outcome: "success",
        startedAt: "2026-08-29T01:00:00Z",
        jobs: ["docs", "backend", "frontend", "tooling", "security"] },
      { runId: 202, attempt: 1, event: "schedule", commit: "e".repeat(40), outcome: "success",
        startedAt: "2026-08-30T01:00:00Z",
        jobs: ["docs", "backend", "frontend", "tooling", "security"] }
    ]
  }
};

test("given admission facts, when rendering the maintained section, then output is deterministic and public", () => {
  // when
  const first = admissionSection(admission);
  const second = admissionSection(structuredClone(admission));

  // then
  assert.equal(first, second);
  assert.match(first, /Profile Evidence run\n`101`/);
  assert.match(first, /expires on 2026-09-30/);
  assert.match(first, /1 tooling plans/);
  assert.match(first, /22 observed CI first attempts/);
  assert.match(first, /661\.43 runner minutes/);
  assert.match(first, /6\.02 percent/);
  assert.match(first, /scheduled runs `201` and `202`/);
  assert.doesNotMatch(first, /token|cookie|credential/i);
});

test("given generated markers, when rendering a document, then only their bounded section changes", () => {
  // given
  const source = "Before\n<!-- profile-admission:start -->\nold\n<!-- profile-admission:end -->\nAfter\n";

  // when
  const rendered = renderAdmissionDocument(source, admission);

  // then
  assert.match(rendered, /^Before\n/);
  assert.match(rendered, /\nAfter\n$/);
  assert.doesNotMatch(rendered, /\nold\n/);
  assert.throws(() => renderAdmissionDocument("no markers\n", admission), /markers/);
});

test("given a documentation tree, when checking it, then broken structure references drift and expiry fail closed", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-docs-check-"));
  mkdirSync(join(directory, "docs"));
  writeFileSync(join(directory, "docs", "target.md"), "# Target heading\n");
  const strategy = "# Strategy\n\n<!-- profile-admission:start -->\nold\n<!-- profile-admission:end -->\n";
  writeFileSync(join(directory, "docs", "quality-strategy.md"), strategy);
  writeFileSync(join(directory, "README.md"), "# Readme\n\n[Target](docs/target.md#target-heading)\n");
  const inventory = () => ["README.md", "docs/quality-strategy.md", "docs/target.md"];

  try {
    // when / then
    assert.throws(() => checkDocumentation(directory, admission, "2026-08-31", inventory), /admission section/);
    writeFileSync(join(directory, "docs", "quality-strategy.md"),
      renderAdmissionDocument(strategy, admission));
    assert.doesNotThrow(() => checkDocumentation(directory, admission, "2026-08-31", inventory));
    writeFileSync(join(directory, "README.md"), "# Readme\n\n[Missing](docs/missing.md)\n");
    assert.throws(() => checkDocumentation(directory, admission, "2026-08-31", inventory), /does not exist/);
    writeFileSync(join(directory, "README.md"), "# Readme\n\n[Missing][target]\n");
    assert.throws(() => checkDocumentation(directory, admission, "2026-08-31", inventory), /undefined link reference/);
    writeFileSync(join(directory, "README.md"), "# Readme\n\n[Missing][target]\n\n[target]: docs/missing.md\n");
    assert.throws(() => checkDocumentation(directory, admission, "2026-08-31", inventory), /does not exist/);
    writeFileSync(join(directory, "README.md"), "# Readme\n\n[Target][]\n\n[Target]: docs/target.md\n");
    assert.doesNotThrow(() => checkDocumentation(directory, admission, "2026-08-31", inventory));
    writeFileSync(join(directory, "README.md"), "# Readme\n\n[Target]\n\n[Target]: docs/target.md\n");
    assert.doesNotThrow(() => checkDocumentation(directory, admission, "2026-08-31", inventory));
    writeFileSync(join(directory, "README.md"), "# Readme\n\n`[Ignored](docs/missing.md)`\n\n~~~md\n[Ignored](docs/missing.md)\n~~~\n");
    assert.doesNotThrow(() => checkDocumentation(directory, admission, "2026-08-31", inventory));
    writeFileSync(join(directory, "docs", "space name.md"), "# Spaced\n");
    const spacedInventory = () => [...inventory(), "docs/space name.md"];
    writeFileSync(join(directory, "README.md"), "# Readme\n\n[Spaced](<docs/space name.md>)\n");
    assert.doesNotThrow(() => checkDocumentation(directory, admission, "2026-08-31", spacedInventory));
    writeFileSync(join(directory, "README.md"), "# Readme\n\n```text\nopen\n");
    assert.throws(() => checkDocumentation(directory, admission, "2026-08-31", inventory), /fence/);
    writeFileSync(join(directory, "README.md"), "# Readme\n\n~~~text\nopen\n");
    assert.throws(() => checkDocumentation(directory, admission, "2026-08-31", inventory), /fence/);
    writeFileSync(join(directory, "README.md"), "# Readme\n\n```js\n[Ignored](docs/missing.md)\n```not-a-close\n");
    assert.throws(() => checkDocumentation(directory, admission, "2026-08-31", inventory), /fence/);
    assert.throws(() => checkDocumentation(directory, admission, "2026-10-01", inventory), /expired/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given a changed generated section, when writing it, then replacement is complete", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-docs-render-"));
  const path = join(directory, "strategy.md");
  writeFileSync(path, "Before\n<!-- profile-admission:start -->\nold\n<!-- profile-admission:end -->\nAfter\n");

  try {
    // when
    writeAdmissionDocument(path, admission);

    // then
    assert.equal(readFileSync(path, "utf8"),
      renderAdmissionDocument("Before\n<!-- profile-admission:start -->\nold\n<!-- profile-admission:end -->\nAfter\n", admission));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
