import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const failingStates = new Set(["validated", "remediation-in-progress", "accepted-risk"]);

export function findingsByControl(findingSummary) {
  const byControl = new Map();
  for (const finding of findingSummary.findings) {
    for (const controlId of [...finding.mappings.wstg ?? [], ...finding.mappings.asvs ?? []]) {
      byControl.set(controlId, [...byControl.get(controlId) ?? [], finding]);
    }
  }
  return byControl;
}

export function readControl(control, findings, resolve) {
  const open = (findings.get(control.id) ?? [])
    .filter(({ state }) => state !== "retest-passed")
    .toSorted((left, right) => left.fingerprint < right.fingerprint ? -1 : 1);
  if (control.controlEvidence && open.length > 0) {
    throw new Error(`${control.id} carries both a control anchor and an open lifecycle finding`);
  }
  if (control.controlEvidence) {
    const { productionPath, falsifyingTest } = control.controlEvidence;
    const [testFile, testName] = falsifyingTest.split("#");
    if ([productionPath, testFile].some((path) => path.split("/").includes(".."))) {
      throw new Error(`${control.id} names a path that leaves the repository`);
    }
    if (resolve(productionPath) === null) {
      throw new Error(`${control.id} names the production path ${productionPath}, which the assessed commit `
        + "does not carry");
    }
    if (!(resolve(testFile) ?? "").includes(testName)) {
      throw new Error(`${control.id} names ${testName} in ${testFile}, which does not contain it at the `
        + "assessed commit");
    }
    return { outcome: "pass", disposition: "control-evidence", ...control.controlEvidence };
  }
  if (open.length > 0) {
    const finding = open[0];
    const failing = failingStates.has(finding.state);
    return { outcome: failing ? "fail" : "blocked", disposition: "lifecycle-finding",
      findingFingerprint: finding.fingerprint, findingState: finding.state,
      findingPriority: finding.priority,
      ...failing ? {} : { trackingReference: finding.fingerprint },
      rationale: `Finding ${finding.fingerprint} maps ${control.id} and is recorded ${finding.state} at `
        + `priority ${finding.priority}. `
        + (failing
          ? "No passed retest has moved it out of that state, so the run reads the control as still failing."
          : "A fix awaiting its retest leaves the control undecided rather than remediated.") };
  }
  if (control.findingReference) {
    return { outcome: "blocked", disposition: "finding-document",
      findingReference: control.findingReference, trackingReference: control.findingReference,
      rationale: `The control was read to the finding recorded at ${control.findingReference}. `
        + "That finding carries no lifecycle fingerprint, so the evidence contract cannot record this "
        + "control as a failure of the run." };
  }
  if (control.status === "not-applicable" && control.rationale) {
    return { outcome: "not-applicable", disposition: "catalog-not-applicable", rationale: control.rationale };
  }
  if (control.rationale) {
    return { outcome: "blocked", disposition: "catalog-rationale", rationale: control.rationale,
      trackingReference: `security/assessment-catalog.json#${control.id}` };
  }
  return { outcome: "blocked", disposition: "unanchored" };
}

const steps = (control, reading, input) => {
  const commit = input.manifest.application.commit;
  if (reading.disposition === "control-evidence") {
    return [
      `Read ${reading.productionPath} at source commit ${commit} as the production path this control names.`,
      `Located ${reading.falsifyingTest.split("#")[1]} in ${reading.falsifyingTest.split("#")[0]} at that commit.`,
      `Read hosted ${input.verification.workflow} run ${input.verification.runId}, which executed the assessed `
        + `commit's whole test suite.`
    ];
  }
  if (reading.disposition === "lifecycle-finding") {
    return [
      `Read the lifecycle finding ${reading.findingFingerprint} that run ${input.priorRunId} mapped to `
        + `${control.id}.`,
      "Read its state, priority and retest history in security/manual-baseline-finding-summary.json."
    ];
  }
  if (reading.disposition === "finding-document") {
    return [`Read the control review recorded for ${control.id} at ${reading.findingReference}.`];
  }
  if (reading.disposition === "unanchored") {
    return [
      `Searched the catalog entry for ${control.id} at source commit ${commit} for a control anchor, a `
        + "not-applicable rationale and a finding reference.",
      `Searched security/manual-baseline-finding-summary.json for a lifecycle finding mapping ${control.id}.`
    ];
  }
  return [`Read the catalog's control-specific rationale for ${control.id} at source commit ${commit}.`];
};

const expectation = (control, reading) => {
  if (reading.disposition === "control-evidence") {
    return `${reading.productionPath} keeps the behaviour ${reading.falsifyingTest.split("#")[1]} asserts, `
      + "and that test goes red when it stops.";
  }
  if (reading.disposition === "lifecycle-finding") {
    return `No open finding maps ${control.id}, or a passed retest records that its condition is gone.`;
  }
  if (reading.disposition === "finding-document") {
    return `The requirement ${control.id} states is complete rather than open at ${reading.findingReference}.`;
  }
  if (reading.disposition === "unanchored") {
    return `A control anchor, a lifecycle finding or a not-applicable rationale states what ${control.id} `
      + "requires of this application and one named check goes red when it stops.";
  }
  return `The catalog's rationale for ${control.id} states why no shipped surface has to satisfy it.`;
};

const observation = (control, reading, input) => {
  const commit = input.manifest.application.commit;
  if (reading.disposition === "control-evidence") {
    const [file, name] = reading.falsifyingTest.split("#");
    return `${reading.productionPath} is present at ${commit}, ${file} contains ${name}, and hosted `
      + `${input.verification.workflow} run ${input.verification.runId} concluded `
      + `${input.verification.conclusion} for that commit.`;
  }
  if (reading.disposition === "lifecycle-finding") {
    return `Finding ${reading.findingFingerprint} is recorded ${reading.findingState} at priority `
      + `${reading.findingPriority} for ${control.id}, and no retest is recorded against it.`;
  }
  if (reading.disposition === "finding-document") {
    return `${reading.findingReference} records the review of ${control.id} as an open finding without a `
      + "lifecycle fingerprint.";
  }
  if (reading.disposition === "unanchored") {
    return `Nothing tracked at ${commit} decides ${control.id}: the catalog carries no anchor, no rationale `
      + `and no finding reference, and no lifecycle finding maps it. Run ${input.priorRunId} recorded an `
      + "outcome for it whose rationale left no tracked artefact behind.";
  }
  return `The catalog carries a control-specific rationale for ${control.id} and no anchor, so the run can `
    + "read why the control stays open but not that it holds.";
};

const readingDocument = (control, reading, input) => ({
  schemaVersion: 1,
  runId: input.runId,
  controlId: control.id,
  procedureId: control.manualProcedureId,
  sourceCommit: input.manifest.application.commit,
  targetImageDigest: input.manifest.application.imageDigest,
  disposition: reading.disposition,
  outcome: reading.outcome,
  productionPath: reading.productionPath,
  falsifyingTest: reading.falsifyingTest,
  findingFingerprint: reading.findingFingerprint,
  findingReference: reading.findingReference,
  verification: input.verification
});

const evidenceId = (controlId) => `reading-${controlId.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;

export function buildAnchoredRun(input) {
  if (input.verification.conclusion !== "success") {
    throw new Error(`Verification run ${input.verification.runId} concluded `
      + `${input.verification.conclusion}, so no control anchor it executed can be read as a pass`);
  }
  const findings = findingsByControl(input.findingSummary);
  const selected = input.catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ manualProcedureId }) => manualProcedureId)
    .toSorted((left, right) => left.id < right.id ? -1 : 1);
  const readings = [];
  const outcomes = new Map();
  for (const control of selected) {
    const reading = readControl(control, findings, input.readSource);
    const document = readingDocument(control, reading, input);
    const digest = `sha256:${createHash("sha256").update(JSON.stringify(document)).digest("hex")}`;
    readings.push({ id: evidenceId(control.id), controlId: control.id, digest, document });
    const rationale = reading.rationale ?? (reading.disposition === "unanchored"
      ? `No tracked artefact at ${input.manifest.application.commit} carries a disposition for ${control.id}: `
        + `run ${input.priorRunId} recorded one, and the protected record it came from is not in this `
        + "repository."
      : undefined);
    outcomes.set(control.id, {
      controlId: control.id,
      stepsPerformed: steps(control, reading, input),
      expectedSecureOutcome: expectation(control, reading),
      observedResult: observation(control, reading, input),
      redactedEvidenceReferences: [{ id: evidenceId(control.id), digest,
        classification: "restricted-security-evidence", expiresOn: input.evidenceExpiresOn }],
      outcome: reading.outcome,
      ...rationale === undefined ? {} : { rationale },
      ...reading.findingFingerprint === undefined ? {} : { findingFingerprint: reading.findingFingerprint },
      ...reading.outcome === "pass" || reading.outcome === "fail" ? {} : { owner: input.owner },
      ...reading.outcome !== "blocked" ? {} : {
        trackingReference: reading.trackingReference ?? input.unanchoredTrackingReference }
    });
  }
  if (new Set(readings.map(({ id }) => id)).size !== readings.length) {
    throw new Error("Two selected controls share one retained reading identifier");
  }
  const procedureIds = [...new Set(selected.map(({ manualProcedureId }) => manualProcedureId))].toSorted();
  const prerequisites = [
    `Assessment catalog ${input.catalog.catalogVersion} at source commit ${input.manifest.application.commit}`,
    `Qualified immutable image ${input.manifest.application.imageDigest} in one disposable ${input.manifest.environment} target`,
    `Hosted ${input.verification.workflow} run ${input.verification.runId} over the assessed commit`,
    `The redacted per-control outcomes of run ${input.priorRunId}`
  ];
  const evidence = {
    schemaVersion: 2,
    catalogVersion: input.catalog.catalogVersion,
    runId: input.runId,
    tester: input.tester,
    recordedAt: input.recordedAt,
    sourceCommit: input.manifest.application.commit,
    targetImageDigest: input.manifest.application.imageDigest,
    targetFingerprint: input.manifest.targetFingerprint,
    targetOrigin: input.manifest.target,
    environment: input.manifest.environment,
    profile: "active",
    authorization: {
      id: `authorize-${input.runId}`,
      origin: input.manifest.target,
      targetFingerprint: input.manifest.targetFingerprint,
      targetImageDigest: input.manifest.application.imageDigest,
      profile: "active",
      procedureIds,
      expiresAt: input.authorizationExpiresAt
    },
    selectedControlIds: selected.map(({ id }) => id),
    independentReview: { performed: false },
    procedures: procedureIds.map((procedureId) => ({
      procedureId,
      prerequisites,
      controls: selected.filter((control) => control.manualProcedureId === procedureId)
        .map(({ id }) => outcomes.get(id)),
      tester: input.tester,
      recordedAt: input.recordedAt,
      targetImageDigest: input.manifest.application.imageDigest
    }))
  };
  const controlOutcomes = {
    schemaVersion: 1,
    run: {
      runId: input.runId,
      catalogVersion: input.catalog.catalogVersion,
      sourceCommit: input.manifest.application.commit,
      recordedAt: input.recordedAt
    },
    controls: selected.map(({ id }) => ({ id, outcome: outcomes.get(id).outcome }))
  };
  return { evidence, readings, controlOutcomes };
}

const writeProtected = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [manifestPath, runId, verificationRunId, verificationConclusion, trackingReference,
    outputDirectory] = process.argv.slice(2);
  if (process.argv.length !== 8) {
    process.stderr.write("Usage: security-anchored-control-run.mjs <manifest.json> <run-id> "
      + "<verification-run-id> <verification-conclusion> <tracking-reference> <output-directory>\n");
    process.exitCode = 1;
  } else {
    const repository = new URL("..", import.meta.url);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const recordedAt = `${new Date().toISOString().slice(0, 19)}Z`;
    const day = (offset) => new Date(Date.parse(recordedAt) + offset * 86400000).toISOString().slice(0, 10);
    const { evidence, readings, controlOutcomes } = buildAnchoredRun({
      catalog: JSON.parse(readFileSync(new URL("security/assessment-catalog.json", repository), "utf8")),
      findingSummary: JSON.parse(readFileSync(
        new URL("security/manual-baseline-finding-summary.json", repository), "utf8")),
      priorRunId: "manual-baseline-20260906",
      runId,
      recordedAt,
      tester: "Repository maintainer",
      owner: "Repository maintainer",
      manifest,
      verification: { workflow: "build", runId: verificationRunId, conclusion: verificationConclusion },
      readSource: (path) => {
        try {
          return readFileSync(new URL(path, repository), "utf8");
        } catch {
          return null;
        }
      },
      unanchoredTrackingReference: trackingReference,
      evidenceExpiresOn: day(30),
      authorizationExpiresAt: `${day(7)}T00:00:00Z`
    });
    mkdirSync(join(outputDirectory, "readings"), { recursive: true, mode: 0o700 });
    for (const reading of readings) {
      writeProtected(join(outputDirectory, "readings", `${reading.id}.json`), reading.document);
    }
    writeProtected(join(outputDirectory, "evidence.json"), evidence);
    writeFileSync(join(outputDirectory, "control-outcomes.json"),
      `${JSON.stringify(controlOutcomes, null, 2)}\n`);
    process.stdout.write(`${runId} recorded ${controlOutcomes.controls.length} controls\n`);
  }
}
