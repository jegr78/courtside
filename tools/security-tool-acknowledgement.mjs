import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { comparisonSummary, unacknowledgedFindings } from "./security-tool-comparison.mjs";

const namingFields = ["scanner", "ruleId", "normalizedSurface", "parameter", "attackClass"];

function findingsIn(directory) {
  const byFingerprint = new Map();
  let names;
  try {
    names = readdirSync(directory).filter((entry) => entry.endsWith(".json"));
  } catch {
    return null;
  }
  for (const name of names) {
    const evidence = JSON.parse(readFileSync(join(directory, name), "utf8"));
    for (const candidate of evidence.candidates ?? []) {
      if (typeof candidate?.fingerprint === "string") byFingerprint.set(candidate.fingerprint, candidate);
    }
  }
  return byFingerprint;
}

function readEvidence(directories) {
  const sides = [["candidate", directories.candidate], ["base", directories.base]]
    .map(([side, directory]) => [side, directory, findingsIn(directory)]);
  return {
    readable: sides.filter(([, , found]) => found !== null).map(([side, , found]) => [side, found]),
    unreadable: sides.filter(([, , found]) => found === null).map(([side, directory]) => `${side}: ${directory}`)
  };
}

// Copied by name, so a field added to the finding schema later stays out of a public artifact by
// default instead of travelling because nobody thought to exclude it.
export function describeFindings(fingerprints, directories) {
  const { readable } = readEvidence(directories);
  return fingerprints.map((fingerprint) => {
    for (const [side, found] of readable) {
      const finding = found.get(fingerprint);
      if (finding) {
        return { fingerprint, side, ...Object.fromEntries(namingFields.map((key) => [key, finding[key]])) };
      }
    }
    return { fingerprint, side: "unresolved" };
  });
}

// The workflow points both runs at one contract, and this is what turns that wiring into something
// the run proves: each side's fuzz evidence records the document it actually read.
export function assessedContracts(directories) {
  const digestIn = (directory) => {
    try {
      return JSON.parse(readFileSync(join(directory, "openapi-fuzz.json"), "utf8")).specificationDigest;
    } catch {
      return undefined;
    }
  };
  return { candidate: digestIn(directories.candidate), base: digestIn(directories.base) };
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
  const { unreadable } = readEvidence(directories);
  if (unreadable.length > 0) {
    lines.push("", `Evidence that could not be read, so a finding of that run stays unnamed: ${unreadable.join(", ")}.`);
  }
  return [...lines, ""].join("\n");
}

// The comparison itself is produced by the protected base's comparator, whose arguments this must
// not change. Reading its output afterwards is what turns a difference into something somebody saw.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const required = ["comparison", "acknowledgement", "summary", "candidate-evidence", "base-evidence"];
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    if (String(args[index]).startsWith("--")) values[String(args[index]).slice(2)] = args[index + 1];
  }
  if (args.length !== required.length * 2
      || required.some((name) => !values[name] || String(values[name]).startsWith("--"))) {
    process.stderr.write("Usage: security-tool-acknowledgement.mjs --comparison <file>"
      + " --acknowledgement <file> --summary <file>"
      + " --candidate-evidence <directory> --base-evidence <directory>\n");
    process.exit(1);
  }
  const directories = { candidate: values["candidate-evidence"], base: values["base-evidence"] };
  const contracts = assessedContracts(directories);
  if (contracts.candidate !== undefined && contracts.base !== undefined
      && contracts.candidate !== contracts.base) {
    process.stderr.write("The two runs read different API documents, so a finding difference cannot be "
      + `attributed to the tools: candidate ${contracts.candidate}, base ${contracts.base}.\n`);
    process.exit(1);
  }
  const comparison = JSON.parse(readFileSync(values.comparison, "utf8"));
  const acknowledgement = JSON.parse(readFileSync(values.acknowledgement, "utf8"));
  writeFileSync(values.summary, findingReport(comparison, acknowledgement, directories), { mode: 0o600 });
  const unacknowledged = unacknowledgedFindings(comparison, acknowledgement);
  if (unacknowledged.length > 0) {
    process.stderr.write("The comparison changed findings nobody recorded. What they are:\n"
      + describeFindings(unacknowledged, directories)
        .map((finding) => `  ${finding.fingerprint} (${finding.side}): `
          + namingFields.map((key) => finding[key] ?? "—").join(" / ")).join("\n")
      + `\nRead the run summary, then record them in ${values.acknowledgement}.\n`);
    process.exit(1);
  }
}
