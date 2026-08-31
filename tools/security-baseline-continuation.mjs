import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assessmentGateRecord } from "./security-assessment-gate.mjs";

const expectedResults = ["target-identity", "passive-deployment"];

export function baselineMayContinue(manifest) {
  if (manifest.profile !== "safe" || manifest.attempt !== 1) {
    throw new Error("The baseline continuation requires the finished first safe attempt");
  }
  const resultIds = manifest.toolResults?.map(({ id }) => id) ?? [];
  if (JSON.stringify(resultIds) !== JSON.stringify(expectedResults)
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
