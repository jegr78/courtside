import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const manifestSchema = JSON.parse(readFileSync(new URL("../security/run-manifest.schema.json", import.meta.url), "utf8"));
const contractSchema = JSON.parse(readFileSync(new URL("../security/run-contract.schema.json", import.meta.url), "utf8"));
const comparisonSchema = JSON.parse(readFileSync(new URL("../security/tool-update-comparison.schema.json", import.meta.url), "utf8"));
const manifestAjv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
manifestAjv.addSchema(contractSchema);
const validateManifest = manifestAjv.compile(manifestSchema);
const comparisonAjv = new Ajv({ strict: true, allErrors: true });
const validateComparison = comparisonAjv.compile(comparisonSchema);

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function runtimeFiles(root) {
  const security = readdirSync(join(root, "security")).map((name) => `security/${name}`);
  const tools = readdirSync(join(root, "tools"))
    .filter((name) => name.startsWith("security-") && !name.includes(".test.") && /\.(?:mjs|py)$/.test(name))
    .map((name) => `tools/${name}`);
  return ["pom.xml", "deploy/compose.security.yaml", "deploy/Caddyfile.security", "frontend/package.json",
    "frontend/package-lock.json", "tools/courtside.mjs", ...security, ...tools];
}

function runtimeDigest(root, otherRoot) {
  const files = [...new Set([...runtimeFiles(root), ...runtimeFiles(otherRoot)])].toSorted();
  const bytes = files.map((path) => {
    const location = join(root, path);
    return `${path}\0${existsSync(location) ? readFileSync(location, "utf8") : "<missing>"}\0`;
  }).join("");
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message) {
  throw new Error(`Invalid security tool comparison: ${message}`);
}

function fingerprints(directory) {
  const values = new Set();
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
    const evidence = JSON.parse(readFileSync(join(directory, name), "utf8"));
    for (const candidate of evidence.candidates ?? []) {
      if (typeof candidate?.fingerprint !== "string") fail(`${name} contains an invalid candidate fingerprint`);
      values.add(candidate.fingerprint);
    }
  }
  return [...values].toSorted();
}

const evidenceFiles = {
  "passive-deployment": "passive-deployment.json",
  "authenticated-zap": "authenticated-zap.json",
  "openapi-fuzzer": "openapi-fuzz.json",
  "authorization-matrix": "authorization-matrix.json",
  "resource-abuse": "resource-abuse.json"
};
const evidenceSchemas = {
  "passive-deployment": "passive-deployment-evidence.schema.json",
  "authenticated-zap": "authenticated-zap-evidence.schema.json",
  "openapi-fuzzer": "openapi-fuzz-evidence.schema.json",
  "authorization-matrix": "authorization-evidence.schema.json",
  "resource-abuse": "resource-abuse-evidence.schema.json"
};

function validateEvidence(root, toolId, evidence) {
  const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
  const lifecycle = join(root, "security", "finding-lifecycle.schema.json");
  if (existsSync(lifecycle)) ajv.addSchema(JSON.parse(readFileSync(lifecycle, "utf8")));
  const schema = JSON.parse(readFileSync(join(root, "security", evidenceSchemas[toolId]), "utf8"));
  const validate = ajv.compile(schema);
  if (!validate(evidence)) fail(`${toolId} evidence violates its runtime schema: ${JSON.stringify(validate.errors)}`);
}

function expectedPlan(contractPath, catalogPath, profile) {
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const selectedTests = contract.selectedTests.filter((testId) =>
    catalog.tests.some((entry) => entry.id === testId && entry.profile === profile));
  const tools = contract.tools.filter((tool) => tool.id === "target-identity"
    || tool.testIds.some((testId) => selectedTests.includes(testId)));
  return { catalogVersion: catalog.catalogVersion, budgets: contract.profiles[profile], selectedTests, tools };
}

function normalizeRun(root, manifestPath, evidenceDirectory, runtimeDigest, contractPath, catalogPath) {
  const bytes = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(bytes);
  if (!validateManifest(manifest)) fail(JSON.stringify(validateManifest.errors));
  if (manifest.status !== "finished" || manifest.finishedAt === null) fail("both runs must be finished");
  if (manifest.attempt !== 1) fail("both runs must be first attempts");
  const expected = expectedPlan(contractPath, catalogPath, manifest.profile);
  for (const property of ["catalogVersion", "budgets", "selectedTests", "tools"]) {
    if (JSON.stringify(manifest[property]) !== JSON.stringify(expected[property])) {
      fail(`${property} differs from the runtime contract and catalog`);
    }
  }
  if (manifest.toolResults.length !== manifest.tools.length) {
    fail(`both runs must retain every tool result, and this run ended with: ${manifest.reason ?? "no reason"}`);
  }
  for (const tool of manifest.tools) {
    const results = manifest.toolResults.filter((result) => result.id === tool.id && result.version === tool.version);
    if (results.length !== 1) fail("each planned tool must have one result with the planned version");
  }
  const expectedEvidence = manifest.tools.filter(({ id }) => id !== "target-identity")
    .map(({ id }) => evidenceFiles[id] ?? fail(`no evidence contract is registered for ${id}`)).toSorted();
  const actualEvidence = readdirSync(evidenceDirectory).filter((name) => name.endsWith(".json")).toSorted();
  if (JSON.stringify(actualEvidence) !== JSON.stringify(expectedEvidence)) {
    fail("evidence files differ from the executed tool set");
  }
  for (const result of manifest.toolResults) {
    if (result.id === "target-identity") {
      if (result.outcome !== "passed") fail("target identity must pass in both runs");
      continue;
    }
    const evidence = JSON.parse(readFileSync(join(evidenceDirectory, evidenceFiles[result.id]), "utf8"));
    validateEvidence(root, result.id, evidence);
    if (evidence.outcome !== result.outcome) fail(`${result.id} evidence outcome differs from its tool result`);
    if (result.outcome === "incomplete" && (!Array.isArray(evidence.candidates) || evidence.candidates.length === 0)) {
      fail(`${result.id} is incomplete without retained finding candidates`);
    }
  }
  const toolOutcomes = manifest.toolResults.map(({ outcome }) => outcome);
  const expectedOutcome = toolOutcomes.includes("failed") ? "failed"
    : toolOutcomes.includes("incomplete") ? "incomplete" : "passed";
  if (manifest.outcome !== expectedOutcome) fail("run outcome differs from its tool outcomes");
  const startedAt = Date.parse(manifest.startedAt);
  const finishedAt = Date.parse(manifest.finishedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) fail("run chronology is invalid");
  return {
    identity: {
      profile: manifest.profile,
      application: manifest.application,
      seedFingerprint: manifest.seedFingerprint
    },
    result: {
      runId: manifest.runId,
      attempt: manifest.attempt,
      manifestDigest: digest(bytes),
      runtimeDigest,
      catalogVersion: manifest.catalogVersion,
      tools: manifest.tools,
      selectedTests: manifest.selectedTests,
      outcome: manifest.outcome,
      durationMilliseconds: finishedAt - startedAt,
      findingFingerprints: fingerprints(evidenceDirectory)
    }
  };
}

function difference(candidate, base) {
  const known = new Set(base);
  return candidate.filter((value) => !known.has(value)).toSorted();
}

export function compareSecurityToolRuns(input) {
  const baseRuntimeDigest = runtimeDigest(input.baseRoot, input.candidateRoot);
  const candidateRuntimeDigest = runtimeDigest(input.candidateRoot, input.baseRoot);
  const base = normalizeRun(input.baseRoot, input.baseManifest, input.baseEvidence, baseRuntimeDigest,
    input.baseContract, input.baseCatalog);
  const candidate = normalizeRun(input.candidateRoot, input.candidateManifest, input.candidateEvidence, candidateRuntimeDigest,
    input.candidateContract, input.candidateCatalog);
  if (!["active", "destructive"].includes(base.identity.profile) || base.identity.profile !== candidate.identity.profile) {
    fail("paired runs must use the same active or destructive profile");
  }
  if (base.identity.seedFingerprint !== candidate.identity.seedFingerprint) {
    fail("paired runs must assess the same synthetic fixture");
  }
  // Each side runs the application of its own revision, so each side's image has to prove it.
  if (candidate.identity.application.commit !== input.candidateRef) {
    fail("the assessed application commit differs from the candidate revision");
  }
  if (base.identity.application.commit !== input.baseRef) {
    fail("the assessed application commit differs from the base revision");
  }
  if (candidate.result.outcome === "failed") fail("the candidate runtime produced a failed assessment");
  const comparison = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseRef: input.baseRef,
    candidateRef: input.candidateRef,
    profile: base.identity.profile,
    application: candidate.identity.application,
    baseApplication: base.identity.application,
    seedFingerprint: base.identity.seedFingerprint,
    base: base.result,
    candidate: candidate.result,
    newFindings: difference(candidate.result.findingFingerprints, base.result.findingFingerprints),
    resolvedFindings: difference(base.result.findingFingerprints, candidate.result.findingFingerprints)
  };
  if (!validateComparison(comparison)) fail(JSON.stringify(validateComparison.errors));
  return comparison;
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) values[args[index].slice(2)] = args[index + 1];
  const required = ["base-root", "base-manifest", "base-evidence", "base-ref", "base-contract", "base-catalog",
    "candidate-root", "candidate-manifest", "candidate-evidence",
    "candidate-ref", "candidate-contract", "candidate-catalog", "output"];
  if (args.length !== required.length * 2 || required.some((name) => !values[name])) fail("required arguments are missing");
  return values;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const values = parseArguments(process.argv.slice(2));
    const comparison = compareSecurityToolRuns({
      baseRoot: values["base-root"],
      baseManifest: values["base-manifest"],
      baseEvidence: values["base-evidence"],
      baseRef: values["base-ref"],
      baseContract: values["base-contract"],
      baseCatalog: values["base-catalog"],
      candidateRoot: values["candidate-root"],
      candidateManifest: values["candidate-manifest"],
      candidateEvidence: values["candidate-evidence"],
      candidateRef: values["candidate-ref"],
      candidateContract: values["candidate-contract"],
      candidateCatalog: values["candidate-catalog"]
    });
    writeFileSync(values.output, `${JSON.stringify(comparison, null, 2)}\n`, { mode: 0o600 });
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = 1;
  }
}
