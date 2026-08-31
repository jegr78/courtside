import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assessmentGateRecord } from "./security-assessment-gate.mjs";

const expectedResults = ["target-identity", "passive-deployment"];

export function baselineMayContinue(manifest) {
  if (manifest.profile !== "safe" || manifest.attempt !== 1) {
    throw new Error("The baseline continuation requires the finished first safe attempt");
  }
  if (!["passed", "incomplete"].includes(manifest.status)) {
    throw new Error("The baseline continuation rejects a failed safe outcome");
  }
  const tools = manifest.tools?.map(({ id, version }) => `${id}@${version}`) ?? [];
  const results = manifest.toolResults?.map(({ id, version }) => `${id}@${version}`) ?? [];
  const outcomes = manifest.toolResults?.map(({ outcome }) => outcome) ?? [];
  if (JSON.stringify(manifest.tools?.map(({ id }) => id) ?? []) !== JSON.stringify(expectedResults)
      || JSON.stringify(results) !== JSON.stringify(tools)
      || outcomes[0] !== "passed" || !["passed", "incomplete"].includes(outcomes[1])
      || !Number.isInteger(manifest.usage?.requests) || manifest.usage.requests < 1
      || !Number.isInteger(manifest.usage?.evidenceBytes) || manifest.usage.evidenceBytes < 1) {
    throw new Error("The baseline continuation requires complete passive evidence");
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) {
      throw new Error("Usage: security-baseline-continuation.mjs <manifest> <image-digest> <source-commit>");
    }
    const record = assessmentGateRecord(readFileSync(process.argv[2], "utf8"), {
      profile: "safe", subject: process.argv[3], sourceCommit: process.argv[4]
    });
    baselineMayContinue(record);
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = 1;
  }
}
