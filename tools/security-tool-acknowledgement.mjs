import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { comparisonSummary, unacknowledgedFindings } from "./security-tool-comparison.mjs";

const described = ["scanner", "ruleId", "normalizedSurface", "parameter", "attackClass"];

function findingsIn(directory) {
  const byFingerprint = new Map();
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
    const evidence = JSON.parse(readFileSync(join(directory, name), "utf8"));
    for (const candidate of evidence.candidates ?? []) {
      if (typeof candidate?.fingerprint === "string") byFingerprint.set(candidate.fingerprint, candidate);
    }
  }
  return byFingerprint;
}

// Only the naming fields travel. A candidate's own evidence holds requests and responses the
// assessment captured, and an artifact of a public repository is not where those belong.
export function describeFindings(fingerprints, directories) {
  const sides = [["candidate", findingsIn(directories.candidate)], ["base", findingsIn(directories.base)]];
  return fingerprints.map((fingerprint) => {
    for (const [side, found] of sides) {
      const finding = found.get(fingerprint);
      if (finding) {
        return { fingerprint, side, ...Object.fromEntries(described.map((key) => [key, finding[key]])) };
      }
    }
    return { fingerprint, side: "unresolved" };
  });
}

export function findingReport(comparison, acknowledgement, directories) {
  const unacknowledged = unacknowledgedFindings(comparison, acknowledgement);
  const lines = [comparisonSummary(comparison), "### Differences nobody has recorded", ""];
  if (unacknowledged.length === 0) return [...lines, "Unacknowledged: none.", ""].join("\n");
  lines.push("| Fingerprint | Seen in | Scanner | Rule | Surface | Parameter | Attack class |",
    "| --- | --- | --- | --- | --- | --- | --- |");
  for (const finding of describeFindings(unacknowledged, directories)) {
    const cell = (value) => value === undefined ? "—" : `\`${value}\``;
    lines.push(`| \`${finding.fingerprint}\` | ${finding.side} | ${cell(finding.scanner)} `
      + `| ${cell(finding.ruleId)} | ${cell(finding.normalizedSurface)} | ${cell(finding.parameter)} `
      + `| ${cell(finding.attackClass)} |`);
  }
  return [...lines, ""].join("\n");
}

// The comparison itself is produced by the protected base's comparator, whose arguments this must
// not change. Reading its output afterwards is what turns a difference into something somebody saw.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const values = {};
  for (let index = 0; index < args.length; index += 2) values[String(args[index]).slice(2)] = args[index + 1];
  const required = ["comparison", "acknowledgement", "summary", "candidate-evidence", "base-evidence"];
  if (args.length !== required.length * 2 || required.some((name) => !values[name])) {
    process.stderr.write("Usage: security-tool-acknowledgement.mjs --comparison <file>"
      + " --acknowledgement <file> --summary <file>"
      + " --candidate-evidence <directory> --base-evidence <directory>\n");
    process.exit(1);
  }
  const comparison = JSON.parse(readFileSync(values.comparison, "utf8"));
  const acknowledgement = JSON.parse(readFileSync(values.acknowledgement, "utf8"));
  const directories = { candidate: values["candidate-evidence"], base: values["base-evidence"] };
  writeFileSync(values.summary, findingReport(comparison, acknowledgement, directories), { mode: 0o600 });
  const unacknowledged = unacknowledgedFindings(comparison, acknowledgement);
  if (unacknowledged.length > 0) {
    process.stderr.write("The comparison changed findings nobody recorded. What they are:\n"
      + describeFindings(unacknowledged, directories)
        .map((finding) => `  ${finding.fingerprint} (${finding.side}): `
          + described.map((key) => finding[key] ?? "—").join(" / ")).join("\n")
      + `\nRead the run summary, then record them in ${values.acknowledgement}.\n`);
    process.exit(1);
  }
}
