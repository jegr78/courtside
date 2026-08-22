import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const manifestSchema = JSON.parse(readFileSync(new URL("../security/run-manifest.schema.json", import.meta.url), "utf8"));
const gateSchema = JSON.parse(readFileSync(new URL("../security/assessment-gate.schema.json", import.meta.url), "utf8"));
const contractSchema = JSON.parse(readFileSync(new URL("../security/run-contract.schema.json", import.meta.url), "utf8"));
const runContract = JSON.parse(readFileSync(new URL("../security/run-contract.json", import.meta.url), "utf8"));
const catalog = JSON.parse(readFileSync(new URL("../security/assessment-catalog.json", import.meta.url), "utf8"));
const manifestAjv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
manifestAjv.addSchema(contractSchema);
const validateManifest = manifestAjv.compile(manifestSchema);
const gateAjv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
gateAjv.addSchema(contractSchema);
const validateGate = gateAjv.compile(gateSchema);

function fail(message) {
  throw new Error(`Invalid security assessment gate: ${message}`);
}

export function assessmentGateRecord(manifestBytes, expected) {
  const manifest = JSON.parse(manifestBytes);
  if (!validateManifest(manifest)) fail(JSON.stringify(validateManifest.errors));
  const subject = manifest.application.imageDigest.split("@").at(-1);
  if (manifest.status !== "finished") fail("run is not finished");
  if (manifest.profile !== expected.profile) fail("profile differs from the required profile");
  if (subject !== expected.subject) fail("assessed image differs from the required digest");
  if (manifest.application.commit !== expected.sourceCommit) fail("source commit differs from the required commit");
  const selectedTests = runContract.selectedTests.filter((testId) =>
    catalog.tests.some((entry) => entry.id === testId && entry.profile === manifest.profile));
  if (JSON.stringify(manifest.selectedTests) !== JSON.stringify(selectedTests)) fail("required test coverage is incomplete");
  if (JSON.stringify(manifest.budgets) !== JSON.stringify(runContract.profiles[manifest.profile])) {
    fail("run budgets differ from the pinned contract");
  }
  const expectedTools = runContract.tools.filter((tool) => tool.id === "target-identity"
    || tool.testIds.some((testId) => selectedTests.includes(testId)));
  if (JSON.stringify(manifest.tools) !== JSON.stringify(expectedTools)) fail("tool identities differ from the pinned contract");
  if (manifest.outcome === "passed" && manifest.toolResults.some(({ outcome }) => outcome !== "passed")) {
    fail("passing run contains a non-passing tool result");
  }
  if (manifest.outcome === "passed" && (manifest.toolResults.length !== expectedTools.length
      || expectedTools.some((tool) => !manifest.toolResults.some((result) =>
        result.id === tool.id && result.version === tool.version)))) {
    fail("passing run is missing a required tool result");
  }
  if (manifest.outcome === "failed" && !manifest.toolResults.some(({ outcome }) => outcome === "failed")) {
    fail("failed run has no failed tool result");
  }
  if (manifest.outcome === "incomplete" && manifest.toolResults.length === expectedTools.length
      && manifest.toolResults.every(({ outcome }) => outcome === "passed")) {
    fail("incomplete run contradicts complete passing tool results");
  }
  if (Date.parse(manifest.finishedAt) < Date.parse(manifest.startedAt)) fail("run chronology is invalid");
  const status = manifest.outcome;
  const record = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runId: manifest.runId,
    attempt: manifest.attempt,
    profile: manifest.profile,
    status,
    subject,
    sourceCommit: manifest.application.commit,
    targetFingerprint: manifest.targetFingerprint,
    catalogVersion: manifest.catalogVersion,
    tools: manifest.tools.map(({ id, version }) => ({ id, version })),
    selectedTests: structuredClone(manifest.selectedTests),
    budgets: structuredClone(manifest.budgets),
    startedAt: manifest.startedAt,
    finishedAt: manifest.finishedAt,
    toolResults: structuredClone(manifest.toolResults),
    usage: structuredClone(manifest.usage),
    manifestDigest: `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`,
    ...(status === "passed" ? {} : { reason: manifest.reason ?? "Assessment did not pass" })
  };
  if (!validateGate(record)) fail(JSON.stringify(validateGate.errors));
  return record;
}

export function validateAssessmentGateRecord(record) {
  if (!validateGate(record)) fail(JSON.stringify(validateGate.errors));
  return record;
}

function parseArguments(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!["--manifest", "--profile", "--subject", "--source-commit", "--output"].includes(option) || !value) {
      fail("usage requires --manifest, --profile, --subject, --source-commit and --output");
    }
    values[option.slice(2)] = value;
  }
  for (const name of ["manifest", "profile", "subject", "source-commit", "output"]) {
    if (!values[name]) fail(`missing --${name}`);
  }
  return values;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const values = parseArguments(process.argv.slice(2));
    const bytes = readFileSync(values.manifest, "utf8");
    const record = assessmentGateRecord(bytes, {
      profile: values.profile,
      subject: values.subject,
      sourceCommit: values["source-commit"]
    });
    writeFileSync(values.output, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    if (record.status !== "passed") throw new Error(`Security assessment is ${record.status}: ${record.reason}`);
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = 1;
  }
}
