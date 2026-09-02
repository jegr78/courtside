import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAdmissionRecord } from "./test-profile-contract.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const startMarker = "<!-- profile-admission:start -->";
const endMarker = "<!-- profile-admission:end -->";

export function admissionSection(admission) {
  validateAdmissionRecord(admission, admission.evidence.expiresOn);
  const evidence = admission.evidence;
  const lines = [
    startMarker,
    "The admitted profile policy is backed by Profile Evidence run",
    `\`${evidence.runId}\`, artifact \`${evidence.artifact}\`, reported \`${evidence.status}\` at`,
    `${evidence.assessedAt} under policy fingerprint`,
    `\`${admission.admittedPolicyFingerprint}\`. The evidence expires on ${evidence.expiresOn}. It contains`,
    `${evidence.qualifyingFirstAttempts} qualifying first attempts, including ${evidence.backendPlans} backend and`,
    admission.schemaVersion >= 2
      ? `${evidence.frontendPlans} frontend and ${evidence.toolingPlans} tooling plans, with ${evidence.candidateMisses} candidate misses and`
      : `${evidence.frontendPlans} frontend plans, with ${evidence.candidateMisses} candidate misses and`,
    `${evidence.classificationErrors} classification errors. ${evidence.incompleteObservations} incomplete observations were excluded.`
  ];
  if (admission.schemaVersion === 3) lines.push(...qualificationLines(evidence));
  lines.push(endMarker);
  return lines.join("\n");
}

function qualificationLines(evidence) {
  const ci = evidence.ciTiming;
  const local = evidence.localTiming;
  const [firstNightly, secondNightly] = evidence.nightlies;
  return [
    "",
    `${ci.observedFirstAttempts} observed CI first attempts had a ${duration(ci.medianDurationMs)} median and`,
    `${duration(ci.p95DurationMs)} p95, consuming ${ci.runnerMinutes.toFixed(2)} runner minutes. The`,
    `${ci.successfulFirstAttempts} successful attempts had a ${duration(ci.successfulMedianDurationMs)} median and`,
    `consumed ${ci.successfulRunnerMinutes.toFixed(2)} runner minutes. These are pre-activation full-execution`,
    "figures; shadow classifications do not prove hosted-runner savings.",
    "",
    `Local qualification on commit \`${local.commit}\` retained ${local.firstAttempts} first attempts with`,
    `${local.retries} retries and ${local.interruptedAttempts} interruptions. Docs measured ${duration(local.docs.medianMs)}`,
    `median and ${duration(local.docs.maximumMs)} maximum; tooling measured ${duration(local.tooling.medianMs)} median and`,
    `${duration(local.tooling.maximumMs)} maximum. Backend saved ${percentage(saving(local.backend, local.full))} with a`,
    `${duration(local.backend.medianMs)} median, and frontend saved ${percentage(saving(local.frontend, local.full))} with a`,
    `${duration(local.frontend.medianMs)} median, against the ${duration(local.full.medianMs)} full median. The`,
    `representative combined plan saved ${percentage(saving(local.combined, local.full))} with a`,
    `${duration(local.combined.medianMs)} median. Combined savings are reported evidence, not an admission gate or`,
    "a general acceleration claim.",
    "",
    `Genuine scheduled runs \`${firstNightly.runId}\` and \`${secondNightly.runId}\` each passed docs, backend, frontend,`,
    "tooling and security on their first attempt. Protected replay continues after activation without a fixed",
    "waiting period; a candidate miss triggers immediate full escalation and requalification."
  ];
}

function duration(milliseconds) {
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(3)} seconds`;
  const minutes = Math.floor(milliseconds / 60_000);
  return `${minutes}m ${((milliseconds % 60_000) / 1000).toFixed(3)}s`;
}

function percentage(value) {
  return `${(value * 100).toFixed(2)} percent`;
}

function saving(timing, full) {
  return 1 - timing.medianMs / full.medianMs;
}

export function renderAdmissionDocument(source, admission) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end < start || source.indexOf(startMarker, start + 1) >= 0
      || source.indexOf(endMarker, end + 1) >= 0) {
    throw new Error("Profile admission markers are invalid");
  }
  return `${source.slice(0, start)}${admissionSection(admission)}${source.slice(end + endMarker.length)}`;
}

export function writeAdmissionDocument(path, admission) {
  const rendered = renderAdmissionDocument(readFileSync(path, "utf8"), admission);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, rendered, { mode: 0o600 });
  renameSync(temporary, path);
}

export function checkDocumentation(root, admission, assessedOn = new Date().toISOString().slice(0, 10),
    inventory = markdownFiles) {
  validateAdmissionRecord(admission, assessedOn);
  const files = inventory(root);
  const documents = new Map(files.map((path) => [path, readFileSync(join(root, path), "utf8")]));
  for (const [path, source] of documents) {
    const prose = validateMarkdown(path, source);
    validateLinks(root, path, prose, documents);
  }
  const strategyPath = "docs/quality-strategy.md";
  const strategy = documents.get(strategyPath);
  if (strategy === undefined || renderAdmissionDocument(strategy, admission) !== strategy) {
    throw new Error("The generated profile admission section is stale");
  }
}

function markdownFiles(root) {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"], {
    cwd: root, encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"]
  }).split("\n").filter(Boolean).sort();
}

function validateMarkdown(path, source) {
  if (source.includes("\r")) throw new Error(`${path} does not use LF line endings`);
  if (!source.endsWith("\n")) throw new Error(`${path} lacks a final newline`);
  let fence = null;
  const prose = source.split("\n").map((line) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1];
    if (fence === null && marker !== undefined) {
      fence = marker;
      return "";
    }
    if (fence !== null) {
      const closing = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/u)?.[1];
      if (closing?.[0] === fence[0] && closing.length >= fence.length) fence = null;
      return "";
    }
    return line;
  }).join("\n");
  if (fence !== null) throw new Error(`${path} has an unclosed code fence`);
  return prose.replace(/(`+)[\s\S]*?\1/gu, "");
}

function validateLinks(root, sourcePath, source, documents) {
  const definitions = new Map([...source.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)]
    .map((match) => [match[1].trim().toLowerCase(), match[2] ?? match[3]]));
  const withoutDefinitions = source.replace(/^\s{0,3}\[[^\]]+\]:.*$/gm, "");
  const targets = [];
  for (const match of withoutDefinitions.matchAll(/!?\[([^\]]+)\](?:\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)|\[([^\]]*)\])?/g)) {
    if (match[2] !== undefined || match[3] !== undefined) {
      targets.push(match[2] ?? match[3]);
      continue;
    }
    const reference = (match[4] || match[1]).trim().toLowerCase();
    const target = definitions.get(reference);
    if (target === undefined && match[4] === undefined) continue;
    if (target === undefined) throw new Error(`${sourcePath} uses an undefined link reference`);
    targets.push(target);
  }
  for (const target of targets) {
    if (/^(?:https?:|mailto:)/.test(target)) continue;
    const [rawPath, rawFragment] = target.split("#", 2);
    const decodedPath = decodeURIComponent(rawPath);
    const resolved = normalize(join(dirname(sourcePath), decodedPath || "."));
    if (resolved.startsWith("..") || resolve(root, resolved) === root && decodedPath !== "") {
      throw new Error(`${sourcePath} links outside the repository`);
    }
    const repositoryPath = decodedPath === "" ? sourcePath : resolved.replaceAll("\\", "/");
    const document = documents.get(repositoryPath);
    if (document === undefined && !existsSync(join(root, repositoryPath))) {
      throw new Error(`${sourcePath} links to ${repositoryPath}, which does not exist`);
    }
    if (rawFragment && document !== undefined && !headingAnchors(document).has(decodeURIComponent(rawFragment))) {
      throw new Error(`${sourcePath} links to missing anchor ${rawFragment} in ${repositoryPath}`);
    }
  }
}

function headingAnchors(source) {
  return new Set(source.split("\n").filter((line) => /^#{1,6}\s+/.test(line)).map((line) => line
    .replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-")));
}

function main() {
  const admissionPath = join(repository, "ci", "test-profile-admission.json");
  const strategyPath = join(repository, "docs", "quality-strategy.md");
  const admission = JSON.parse(readFileSync(admissionPath, "utf8"));
  if (process.argv.includes("--write")) writeAdmissionDocument(strategyPath, admission);
  else if (process.argv.includes("--check")) {
    checkDocumentation(repository, admission);
    execFileSync(process.execPath, ["--test", "tools/docs-check.test.mjs",
      "tools/github-template-metadata.test.mjs",
      "tools/quality-strategy.test.mjs", "tools/post-merge-policy.test.mjs",
      "tools/test-profile-contract.test.mjs"], { cwd: repository, shell: false, stdio: "inherit" });
  }
  else throw new Error("Use --check or --write");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
