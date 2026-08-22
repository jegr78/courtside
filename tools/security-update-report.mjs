import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));
const securityFiles = readdirSync(new URL("../security", import.meta.url))
  .map((name) => `security/${name}`);
const securityToolFiles = readdirSync(new URL("../tools", import.meta.url))
  .filter((name) => name.startsWith("security-") && !name.includes(".test.") && /\.(?:mjs|py)$/.test(name))
  .map((name) => `tools/${name}`);
export const securityRuntimeFiles = [
  "deploy/compose.security.yaml",
  "deploy/Caddyfile.security",
  "frontend/package.json",
  "frontend/package-lock.json",
  "pom.xml",
  ...securityFiles,
  "tools/courtside.mjs",
  ...securityToolFiles
].toSorted();
const currentSchemaFiles = securityFiles.filter((path) => path.endsWith(".schema.json")).toSorted();

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function baseFile(base, path) {
  try {
    return execFileSync("git", ["show", `${base}:${path}`], {
      cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    return null;
  }
}

function currentFile(path) {
  const location = new URL(`../${path}`, import.meta.url);
  return existsSync(location) ? readFileSync(location, "utf8") : null;
}

function baseFiles(base, directory, predicate) {
  try {
    return execFileSync("git", ["ls-tree", "-r", "--name-only", base, directory], {
      cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    }).trim().split("\n").filter(Boolean).filter(predicate);
  } catch {
    return [];
  }
}

function runtimeFiles(base) {
  const baseSecurity = baseFiles(base, "security", () => true);
  const baseTools = baseFiles(base, "tools", (path) => /\/security-[^/]+\.(?:mjs|py)$/.test(path)
    && !path.includes(".test."));
  return [...new Set([...securityRuntimeFiles, ...baseSecurity, ...baseTools])].toSorted();
}

function combinedDigest(files, reader) {
  return digest(files.map((path) => `${path}\0${reader(path) ?? "<missing>"}\0`).join(""));
}

function changedRows(files, base) {
  return files.map((path) => {
    const current = currentFile(path);
    const previous = baseFile(base, path);
    return {
      path,
      previous: previous === null ? "not present" : digest(previous),
      current: current === null ? "not present" : digest(current),
      changed: previous === null || previous !== current
    };
  });
}

function jsonLeaves(value, path = "") {
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      jsonLeaves(child, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`));
  }
  return [[path || "/", JSON.stringify(value)]];
}

export function semanticJsonChanges(previous, current) {
  if (previous === null) return { added: current === null ? [] : ["/"], removed: [], modified: [] };
  if (current === null) return { added: [], removed: ["/"], modified: [] };
  const before = new Map(jsonLeaves(JSON.parse(previous)));
  const after = new Map(jsonLeaves(JSON.parse(current)));
  return {
    added: [...after.keys()].filter((key) => !before.has(key)).toSorted(),
    removed: [...before.keys()].filter((key) => !after.has(key)).toSorted(),
    modified: [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key)).toSorted()
  };
}

export function semanticChanges(path, base) {
  return semanticJsonChanges(baseFile(base, path), currentFile(path));
}

// Whether the paired assessments have to run at all. A branch that touches none of the runtime
// files answers no, which is why no test may hardwire either answer against the working tree.
export function runtimeComparisonRequired(identity) {
  return identity.baseRuntimeDigest !== identity.candidateRuntimeDigest;
}

export function securityRuntimeIdentity(base) {
  const files = runtimeFiles(base);
  return {
    baseRuntimeDigest: combinedDigest(files, (path) => baseFile(base, path)),
    candidateRuntimeDigest: combinedDigest(files, currentFile)
  };
}

export function securityUpdateReport(base) {
  const files = runtimeFiles(base);
  const baseSecurity = baseFiles(base, "security", () => true);
  const policyFiles = [...new Set([...securityFiles, ...baseSecurity])]
    .filter((path) => path.endsWith(".json") && !path.endsWith(".schema.json")).toSorted();
  const baseSchemas = baseFiles(base, "security", (path) => path.endsWith(".schema.json"));
  const schemaFiles = [...new Set([...currentSchemaFiles, ...baseSchemas])].toSorted();
  const runtime = changedRows(files, base);
  const policies = changedRows(policyFiles, base);
  const schemas = changedRows(schemaFiles, base);
  const identity = securityRuntimeIdentity(base);
  const contract = JSON.parse(currentFile("security/run-contract.json"));
  const previousContractBytes = baseFile(base, "security/run-contract.json");
  const previousVersions = previousContractBytes === null ? "not present"
    : JSON.parse(previousContractBytes).tools.map(({ id, version }) => `${id}=${version}`).join(", ");
  const currentVersions = contract.tools.map(({ id, version }) => `${id}=${version}`).join(", ");
  const rows = [...runtime, ...policies, ...schemas].filter((row, index, all) =>
    all.findIndex((candidate) => candidate.path === row.path) === index);
  const semantic = [...policyFiles, ...schemaFiles].map((path) => ({ path, ...semanticChanges(path, base) }))
    .filter(({ added, removed, modified }) => added.length || removed.length || modified.length);
  return [
    "# Security update comparison",
    "",
    `Base: \`${base}\``,
    `Previous runtime tools: ${previousVersions}`,
    `Current runtime tools: ${currentVersions}`,
    `Base runtime digest: \`${identity.baseRuntimeDigest}\``,
    `Candidate runtime digest: \`${identity.candidateRuntimeDigest}\``,
    `Runtime comparison required: ${runtimeComparisonRequired(identity) ? "yes" : "no"}`,
    "",
    "| Runtime, policy or report schema | Previous SHA-256 | Current SHA-256 | Changed |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| \`${row.path}\` | \`${row.previous}\` | \`${row.current}\` | ${row.changed ? "yes" : "no"} |`),
    "",
    "## Rule and report-schema changes",
    "",
    ...(semantic.length === 0 ? ["None."] : semantic.flatMap(({ path, added, removed, modified }) => [
      `### \`${path}\``,
      "",
      `Added JSON paths: ${added.join(", ") || "none"}`,
      `Removed JSON paths: ${removed.join(", ") || "none"}`,
      `Modified JSON paths: ${modified.join(", ") || "none"}`,
      ""
    ])),
    ""
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [baseOption, base, outputOption, output, identityOption, identityOutput] = process.argv.slice(2);
  if (baseOption !== "--base" || !base || outputOption !== "--output" || !output
      || (identityOption !== undefined && identityOption !== "--identity-output") || (identityOption && !identityOutput)) {
    throw new Error("Usage: security-update-report.mjs --base <commit> --output <file> [--identity-output <file>]");
  }
  writeFileSync(output, securityUpdateReport(base), { mode: 0o600 });
  if (identityOutput) {
    writeFileSync(identityOutput, `${JSON.stringify(securityRuntimeIdentity(base), null, 2)}\n`, { mode: 0o600 });
  }
}
