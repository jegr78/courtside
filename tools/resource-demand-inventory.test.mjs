import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const YAML = require("yaml");
const repository = fileURLToPath(new URL("..", import.meta.url));
const productionJava = `${repository}/src/main/java`;
const productionJavaFiles = () => readdirSync(productionJava, { recursive: true })
  .filter((path) => path.endsWith(".java"))
  .map((path) => `src/main/java/${path.replaceAll("\\", "/")}`);
const inventory = JSON.parse(readFileSync(new URL(
  "../security/resource-demand-inventory.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(new URL(
  "../security/resource-demand-inventory.schema.json", import.meta.url), "utf8"));
const openapi = YAML.parse(readFileSync(new URL(
  "../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));

const operationIds = () => Object.values(openapi.paths)
  .flatMap((path) => Object.values(path).map((operation) => operation?.operationId).filter(Boolean))
  .toSorted();

const scheduledFiles = () => productionJavaFiles()
  .filter((path) => readFileSync(`${repository}/${path}`, "utf8").includes("@Scheduled"))
  .toSorted();

const backgroundFiles = () => productionJavaFiles()
  .filter((path) => readFileSync(`${repository}/${path}`, "utf8").includes("@Async"))
  .toSorted();

const scheduledEntryPoints = () => scheduledFiles().flatMap((path) => {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const className = source.match(/\bclass\s+(\w+)/)?.[1];
  return [...source.matchAll(/@Scheduled\([\s\S]*?\)\s+(?:@\w+(?:\([^)]*\))?\s+)*(?:public\s+)?void\s+(\w+)\s*\(/g)]
    .map(([, method]) => `${className}#${method}`);
}).toSorted();

const backgroundEntryPoints = () => backgroundFiles().flatMap((path) => {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const className = source.match(/\bclass\s+(\w+)/)?.[1];
  return [...source.matchAll(/@Async\([^)]*\)\s+(?:@\w+(?:\([^)]*\))?\s+)*(?:public\s+)?void\s+(\w+)\s*\(\s*([\w.]+)/g)]
    .map(([, method, parameter]) => `${className}#${method}(${parameter})`);
}).toSorted();

const startupFiles = () => productionJavaFiles()
  .filter((path) => {
    const source = readFileSync(`${repository}/${path}`, "utf8");
    const profile = source.match(/@Profile\("([^"]+)"\)/)?.[1];
    return source.includes("implements ApplicationRunner")
      && !["demo", "perf", "security"].includes(profile);
  })
  .toSorted();

const startupEntryPoints = () => startupFiles().map((path) => {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  return `${source.match(/\bclass\s+(\w+)/)?.[1]}#run`;
}).toSorted();

const classified = (kind) => inventory.classifications
  .filter((entry) => entry.kind === kind)
  .flatMap((entry) => entry.entryPoints);
const productionEntryPoints = () => [
  ...operationIds(), ...scheduledEntryPoints(), ...backgroundEntryPoints(), ...startupEntryPoints()
].toSorted();
const requireExactCoverage = (actual) => assert.deepEqual(actual.toSorted(), productionEntryPoints());
const annotationCount = (paths, annotation) => paths.reduce((count, path) =>
  count + readFileSync(`${repository}/${path}`, "utf8").split(annotation).length - 1, 0);

test("given the resource-demand inventory, when validating it, then every decision satisfies the closed schema", () => {
  // given
  const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);

  // when
  const valid = validate(inventory);

  // then
  assert.equal(valid, true, JSON.stringify(validate.errors));
});

test("given production entry points, when classifying resource demand, then every HTTP and background path is covered once", () => {
  // given
  const discoveredScheduledFiles = scheduledFiles();
  const discoveredBackgroundFiles = backgroundFiles();
  const discoveredStartupFiles = startupFiles();

  // when
  const actual = inventory.classifications.flatMap((entry) => entry.entryPoints).toSorted();

  // then
  assert.deepEqual(inventory.sources.scheduledFiles.toSorted(), discoveredScheduledFiles);
  assert.deepEqual(inventory.sources.backgroundFiles.toSorted(), discoveredBackgroundFiles);
  assert.deepEqual(inventory.sources.startupFiles.toSorted(), discoveredStartupFiles);
  assert.equal(scheduledEntryPoints().length, annotationCount(discoveredScheduledFiles, "@Scheduled"));
  assert.equal(backgroundEntryPoints().length, annotationCount(discoveredBackgroundFiles, "@Async"));
  requireExactCoverage(actual);
  assert.equal(new Set(actual).size, actual.length, "an entry point has more than one demand decision");
  const ids = inventory.classifications.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "a demand decision id is duplicated");
});

test("given a demanding decision, when a required fact is removed or an unknown claim is added, then validation fails", () => {
  // given
  const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
  const missingBound = structuredClone(inventory);
  delete missingBound.classifications.find(({ kind }) => kind === "demanding").inputOrDataBound;
  const unknownClaim = structuredClone(inventory);
  unknownClaim.classifications.find(({ kind }) => kind === "demanding").implicitlySafe = true;

  // when / then
  assert.equal(validate(missingBound), false);
  assert.equal(validate(unknownClaim), false);
});

test("given a new or reclassified entry point, when inventory coverage drifts, then the contract fails closed", () => {
  // given
  const actual = [...classified("ordinary"), ...classified("demanding")];

  // when / then
  assert.throws(() => requireExactCoverage([...actual, "unreviewedProductionOperation"]));
  assert.throws(() => requireExactCoverage(actual.slice(1)));
});

test("given a demanding production path, when reading its decision, then its sources and falsifying tests exist", () => {
  // given
  const demanding = inventory.classifications.filter(({ kind }) => kind === "demanding");

  // when / then
  assert.ok(demanding.length > 0);
  for (const decision of demanding) {
    for (const path of decision.productionPaths) {
      assert.equal(statSync(`${repository}/${path}`).isFile(), true, `${decision.id} names no production file ${path}`);
    }
    for (const anchor of decision.evidence) {
      const [path, testName] = anchor.split("#");
      const source = readFileSync(`${repository}/${path}`, "utf8");
      const escaped = testName.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
      assert.match(source, new RegExp(
        String.raw`(?:\bvoid\s+${escaped}\s*\(|\b(?:test|it)\(\s*"${escaped}")`), anchor);
    }
  }
});
