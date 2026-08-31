import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assessmentGateRecord } from "./security-assessment-gate.mjs";

export function validateBaselinePair(safe, active) {
  if (safe.profile !== "safe" || safe.attempt !== 1 || active.profile !== "active" || active.attempt !== 2) {
    throw new Error("The baseline pair has an invalid profile or attempt order");
  }
  if (safe.runId !== active.runId || safe.targetFingerprint !== active.targetFingerprint) {
    throw new Error("The baseline pair does not share one run and target identity");
  }
  for (const record of [safe, active]) {
    const tools = record.tools.map(({ id, version }) => `${id}@${version}`);
    const results = record.toolResults.map(({ id, version }) => `${id}@${version}`);
    if (JSON.stringify(tools) !== JSON.stringify(results)) {
      throw new Error("The baseline pair requires complete tool evidence");
    }
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 6) {
      throw new Error("Usage: security-baseline-pair.mjs <safe> <active> <image-digest> <source-commit>");
    }
    const expected = { subject: process.argv[4], sourceCommit: process.argv[5] };
    const safe = assessmentGateRecord(readFileSync(process.argv[2], "utf8"), { ...expected, profile: "safe" });
    const active = assessmentGateRecord(readFileSync(process.argv[3], "utf8"), { ...expected, profile: "active" });
    validateBaselinePair(safe, active);
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = 1;
  }
}
