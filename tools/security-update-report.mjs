import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const files = [
  "security/run-contract.json",
  "security/assessment-catalog.json",
  "security/run-contract.schema.json",
  "security/run-manifest.schema.json",
  "security/assessment-gate.schema.json",
  "security/zap-authenticated-policy.json",
  "security/openapi-fuzz-policy.json",
  "security/resource-abuse-policy.json"
];

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function baseFile(base, path) {
  try {
    return execFileSync("git", ["show", `${base}:${path}`], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    return null;
  }
}

export function securityUpdateReport(base) {
  const rows = files.map((path) => {
    const current = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const previous = baseFile(base, path);
    return {
      path,
      previous: previous === null ? "not present" : digest(previous),
      current: digest(current),
      changed: previous === null || previous !== current
    };
  });
  const contract = JSON.parse(readFileSync(new URL("../security/run-contract.json", import.meta.url), "utf8"));
  const previousContractBytes = baseFile(base, "security/run-contract.json");
  const previousVersions = previousContractBytes === null ? "not present"
    : JSON.parse(previousContractBytes).tools.map(({ id, version }) => `${id}=${version}`).join(", ");
  const currentVersions = contract.tools.map(({ id, version }) => `${id}=${version}`).join(", ");
  return [
    "# Security update comparison",
    "",
    `Base: \`${base}\``,
    `Previous runtime tools: ${previousVersions}`,
    `Current runtime tools: ${currentVersions}`,
    "",
    "| Contract or policy | Previous SHA-256 | Current SHA-256 | Changed |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| \`${row.path}\` | \`${row.previous}\` | \`${row.current}\` | ${row.changed ? "yes" : "no"} |`),
    ""
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [baseOption, base, outputOption, output] = process.argv.slice(2);
  if (baseOption !== "--base" || !base || outputOption !== "--output" || !output) {
    throw new Error("Usage: security-update-report.mjs --base <commit> --output <file>");
  }
  writeFileSync(output, securityUpdateReport(base), { mode: 0o600 });
}
