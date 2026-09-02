import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeProfileDecision, ciJobsForProfiles, loadProfileContract, localTasksForProfiles,
  profilePolicyFingerprint
} from "./test-profile-contract.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
const rulesUrl = new URL("../ci/test-profiles.json", import.meta.url);
const admissionUrl = new URL("../ci/test-profile-admission.json", import.meta.url);
const toolManifestUrl = new URL("../ci/tool-profile-manifest.json", import.meta.url);
const githubManifestUrl = new URL("../ci/github-profile-manifest.json", import.meta.url);
const rules = JSON.parse(readFileSync(rulesUrl, "utf8"));
const toolManifest = JSON.parse(readFileSync(toolManifestUrl, "utf8"));
const githubManifest = JSON.parse(readFileSync(githubManifestUrl, "utf8"));
const reducedProfiles = ["docs", "backend", "frontend", "tooling"];
validateRules(rules);
validateToolManifest(toolManifest);
validateGitHubManifest(githubManifest, undefined, toolManifest);

export function validateRules(candidate) {
  const profileNames = ["full", ...reducedProfiles];
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)
      || Object.keys(candidate).sort().join() !== ["profiles", "schemaVersion"].sort().join()
      || candidate.schemaVersion !== 1
      || Object.keys(candidate.profiles ?? {}).sort().join() !== [...profileNames].sort().join()) {
    throw new Error("Test profile path rules are invalid");
  }
  for (const profile of profileNames) {
    const configured = candidate.profiles[profile];
    if (configured === null || typeof configured !== "object" || Array.isArray(configured)
        || Object.keys(configured).some((field) => !["exact", "prefixes", "patterns"].includes(field))
        || !Array.isArray(configured.exact) || !Array.isArray(configured.prefixes)
        || [...configured.exact, ...configured.prefixes].some((value) => typeof value !== "string" || value.length < 1)
        || (configured.patterns !== undefined && (!Array.isArray(configured.patterns)
          || configured.patterns.some((pattern) => pattern === null || typeof pattern !== "object"
            || Array.isArray(pattern) || Object.keys(pattern).some((field) => !["prefix", "suffix", "contains"].includes(field))
            || typeof pattern.prefix !== "string" || pattern.prefix.length < 1
            || (pattern.suffix !== undefined && (typeof pattern.suffix !== "string" || pattern.suffix.length < 1))
            || (pattern.contains !== undefined && (typeof pattern.contains !== "string" || pattern.contains.length < 1)))))) {
      throw new Error("Test profile path rules are invalid");
    }
  }
}

export function validateToolManifest(candidate, trackedPaths) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)
      || Object.keys(candidate).sort().join() !== ["entries", "schemaVersion"].sort().join()
      || candidate.schemaVersion !== 1 || !Array.isArray(candidate.entries)) {
    throw new Error("Tool profile manifest is invalid");
  }
  const paths = candidate.entries.map((entry) => entry?.path);
  if (new Set(paths).size !== paths.length || candidate.entries.some((entry) => entry === null
      || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).sort().join() !== ["path", "profiles", "test"].sort().join()
      || typeof entry.path !== "string" || !entry.path.startsWith("tools/")
      || !Array.isArray(entry.profiles) || entry.profiles.length < 1
      || typeof entry.test !== "boolean"
      || new Set(entry.profiles).size !== entry.profiles.length
      || entry.profiles.some((profile) => ![...reducedProfiles, "full"].includes(profile))
      || entry.test !== entry.path.endsWith(".test.mjs")
      || (entry.test && !entry.profiles.includes("tooling"))
      || (entry.profiles.includes("full") && entry.profiles.length !== 1))) {
    throw new Error("Tool profile manifest is invalid");
  }
  if (trackedPaths !== undefined) {
    const expected = [...trackedPaths].sort();
    if (JSON.stringify([...paths].sort()) !== JSON.stringify(expected)) {
      throw new Error("Tool profile manifest inventory is stale");
    }
  }
}

export function validateGitHubManifest(candidate, trackedPaths, validators) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)
      || Object.keys(candidate).sort().join() !== ["entries", "schemaVersion"].sort().join()
      || candidate.schemaVersion !== 1 || !Array.isArray(candidate.entries)) {
    throw new Error("GitHub profile manifest is invalid");
  }
  const paths = candidate.entries.map((entry) => entry?.path);
  if (new Set(paths).size !== paths.length || candidate.entries.some((entry) => entry === null
      || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).sort().join() !== ["path", "profiles", "validators"].sort().join()
      || typeof entry.path !== "string" || !entry.path.startsWith(".github/")
      || !Array.isArray(entry.profiles) || entry.profiles.length < 1
      || new Set(entry.profiles).size !== entry.profiles.length
      || entry.profiles.some((profile) => ![...reducedProfiles, "full"].includes(profile))
      || (entry.profiles.includes("full") && entry.profiles.length !== 1)
      || !Array.isArray(entry.validators) || new Set(entry.validators).size !== entry.validators.length
      || entry.validators.some((validator) => typeof validator !== "string")
      || (!entry.profiles.includes("full") && entry.validators.length < 1))) {
    throw new Error("GitHub profile manifest is invalid");
  }
  if (validators !== undefined) {
    const executable = new Map(validators.entries
      .filter((entry) => entry.test).map((entry) => [entry.path, entry.profiles]));
    if (candidate.entries.some((entry) => entry.validators.some((validator) => !executable.has(validator)))) {
      throw new Error("GitHub profile manifest validator is invalid");
    }
    if (candidate.entries.some((entry) => !entry.profiles.includes("full")
        && entry.validators.some((validator) => !executable.get(validator)
          .some((profile) => entry.profiles.includes(profile))))) {
      throw new Error("GitHub profile manifest validator is unreachable");
    }
  }
  if (trackedPaths !== undefined && JSON.stringify([...paths].sort()) !== JSON.stringify([...trackedPaths].sort())) {
    throw new Error("GitHub profile manifest inventory is stale");
  }
}

function matchingRule(path, profile, kind) {
  const configured = rules.profiles[profile];
  if (kind === "exact" && configured.exact.includes(path)) return `exact:${path}`;
  if (kind === "specific") {
    const pattern = (configured.patterns ?? []).find((candidate) => path.startsWith(candidate.prefix)
      && (candidate.suffix === undefined || path.endsWith(candidate.suffix))
      && (candidate.contains === undefined || path.includes(candidate.contains)));
    if (pattern === undefined) return null;
    if (pattern.suffix !== undefined) return `suffix:${pattern.prefix}*${pattern.suffix}`;
    if (pattern.contains !== undefined) return `contains:${pattern.prefix}${pattern.contains}`;
    return `prefix:${pattern.prefix}`;
  }
  const prefix = kind === "prefix"
    ? configured.prefixes.find((candidate) => path.startsWith(candidate)) : undefined;
  return prefix === undefined ? null : `prefix:${prefix}`;
}

export function classifyPath(path) {
  if (typeof path !== "string" || path.length < 1 || path.includes("\0")) return null;
  if (path.startsWith(".github/")) {
    const entry = githubManifest.entries.find((candidate) => candidate.path === path);
    if (entry === undefined) return null;
    return { profiles: entry.profiles, rule: `manifest:${path}` };
  }
  if (path.startsWith("tools/")) {
    const entry = toolManifest.entries.find((candidate) => candidate.path === path);
    if (entry === undefined) return null;
    return { profiles: entry.profiles, rule: `manifest:${path}` };
  }
  for (const kind of ["exact", "specific", "prefix"]) {
    for (const profile of ["full", ...reducedProfiles]) {
      const rule = matchingRule(path, profile, kind);
    if (rule !== null) return { profiles: [profile], rule };
    }
  }
  return null;
}

export function parseNameStatus(value) {
  if (typeof value !== "string" || !value.endsWith("\0")) throw new Error("Git change evidence is malformed");
  const fields = value.slice(0, -1).split("\0");
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^(?:[ACDMRTUXB]|R\d{1,3}|C\d{1,3})$/.test(status)) throw new Error("Git change status is malformed");
    if (status.startsWith("R") || status.startsWith("C")) {
      if (index + 1 >= fields.length) throw new Error("Git rename evidence is malformed");
      changes.push({ status, previousPath: fields[index++], path: fields[index++] });
    } else {
      if (index >= fields.length) throw new Error("Git change evidence is malformed");
      changes.push({ status, path: fields[index++] });
    }
  }
  return changes;
}

export function classifyChanges(changes, labels) {
  if (!Array.isArray(changes) || changes.length < 1 || !Array.isArray(labels)
      || labels.some((label) => typeof label !== "string")) throw new Error("Classification input is invalid");
  const reasons = [];
  let requiresFull = labels.includes("ci:full");
  if (requiresFull) reasons.push({ code: "manual-full", path: null, profile: "full", status: null });
  const selected = new Set();
  for (const change of changes) {
    if (change === null || typeof change !== "object" || typeof change.status !== "string"
        || typeof change.path !== "string") throw new Error("Changed path evidence is invalid");
    if (!/^(?:[ACDMRTUXB]|R\d{1,3}|C\d{1,3})$/.test(change.status)
        || ((change.status.startsWith("R") || change.status.startsWith("C"))
          && typeof change.previousPath !== "string")) {
      throw new Error("Changed path status is invalid");
    }
    const structural = change.status !== "M" && change.status !== "A";
    const classification = classifyPath(change.path);
    const classifiedProfiles = structural || classification === null ? ["full"] : classification.profiles;
    if (classifiedProfiles.includes("full")) requiresFull = true;
    for (const profile of classifiedProfiles) if (profile !== "full") selected.add(profile);
    reasons.push({
      code: structural ? "structural-change" : classification === null ? "unknown-path" : classification.rule,
      path: change.path,
      profile: classifiedProfiles.includes("full") ? "full" : classifiedProfiles[0],
      status: change.status
    });
  }
  const profiles = requiresFull ? ["full"] : reducedProfiles.filter((profile) => selected.has(profile));
  if (profiles.length === 0) throw new Error("Classification selected no test profile");
  return { schemaVersion: 1, profiles, isFull: requiresFull, reasons };
}

export function bindPlanToRun(plan, identity, mode = "admitted", admission = readAdmission()) {
  if (plan === null || typeof plan !== "object" || plan.schemaVersion !== 1
      || identity === null || typeof identity !== "object"
      || !Number.isSafeInteger(identity.runId) || identity.runId < 1
      || !Number.isSafeInteger(identity.attempt) || identity.attempt < 1
      || !/^[a-f0-9]{40}$/.test(identity.baseCommit)
      || !/^[a-f0-9]{40}$/.test(identity.headCommit)) {
    throw new Error("Profile plan run identity is invalid");
  }
  const admitted = admitPlan(plan, mode, admission);
  return {
    schemaVersion: 4,
    runId: identity.runId,
    attempt: identity.attempt,
    baseCommit: identity.baseCommit,
    headCommit: identity.headCommit,
    ...admitted,
    plannerOutcome: "passed",
    reasons: plan.reasons
  };
}

export function admitPlan(plan, mode = "admitted", admission = readAdmission()) {
  const contract = loadProfileContract();
  const proposedPolicyFingerprint = profilePolicyFingerprint();
  const decision = activeProfileDecision(plan.profiles, proposedPolicyFingerprint, admission, mode);
  return {
    activePolicyFingerprint: decision.admissionOutcome === "matched"
      ? proposedPolicyFingerprint : null,
    proposedPolicyFingerprint,
    admissionOutcome: decision.admissionOutcome,
    overrideOutcome: decision.overrideOutcome,
    activeProfiles: decision.activeProfiles,
    proposedProfiles: plan.profiles,
    activeCiJobs: ciJobsForProfiles(contract, decision.activeProfiles),
    proposedCiJobs: ciJobsForProfiles(contract, plan.profiles),
    activeLocalTasks: localTasksForProfiles(contract, decision.activeProfiles),
    proposedLocalTasks: localTasksForProfiles(contract, plan.profiles).map((task) => task.label),
    isFull: decision.activeProfiles.includes("full")
  };
}

export function fallbackPlanToRun(identity) {
  const contract = loadProfileContract();
  const proposedPolicyFingerprint = profilePolicyFingerprint();
  return {
    schemaVersion: 4,
    runId: identity.runId,
    attempt: identity.attempt,
    baseCommit: identity.baseCommit,
    headCommit: identity.headCommit,
    activePolicyFingerprint: null,
    proposedPolicyFingerprint,
    admissionOutcome: "invalid",
    overrideOutcome: "invalid-full",
    plannerOutcome: "failed",
    activeProfiles: ["full"],
    proposedProfiles: ["full"],
    activeCiJobs: ciJobsForProfiles(contract, ["full"]),
    proposedCiJobs: ciJobsForProfiles(contract, ["full"]),
    activeLocalTasks: localTasksForProfiles(contract, ["full"]),
    proposedLocalTasks: ["full"],
    isFull: true,
    reasons: [{ code: "classifier-error", path: null, profile: "full", status: null }]
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

export function profileSummary(plan) {
  const safe = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll("|", "&#124;").replaceAll("@", "&#64;")
    .replace(/[\u0000-\u001f\u007f]/g,
      (character) => `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`);
  const inertCode = (value) => {
    const visible = String(value).replace(/[@\u0000-\u001f\u007f-\u009f\p{Bidi_Control}]/gu,
      (character) => `\\u{${character.codePointAt(0).toString(16)}}`);
    return `<code>${[...visible].map((character) => `&#x${character.codePointAt(0).toString(16)};`).join("")}</code>`;
  };
  return [
    "# Selected test profiles",
    "",
    `Active: ${plan.activeProfiles.map((profile) => `\`${profile}\``).join(", ")}`,
    `Proposed: ${plan.proposedProfiles.map((profile) => `\`${profile}\``).join(", ")}`,
    "",
    "The required build runs only the jobs assigned to these conservative profiles.",
    "",
    "| Status | Path | Profile | Reason |",
    "| --- | --- | --- | --- |",
    ...plan.reasons.map((reason) => `| ${safe(reason.status ?? "label")} | ${inertCode(reason.path ?? "ci:full")} | ${safe(reason.profile)} | ${safe(reason.code)} |`),
    ""
  ].join("\n");
}

function main() {
  const base = argument("--base");
  const head = argument("--head");
  if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) throw new Error("Commit identity is invalid");
  const identity = {
    runId: Number(argument("--run-id")),
    attempt: Number(argument("--attempt")),
    baseCommit: base,
    headCommit: head
  };
  const output = resolve(argument("--output"));
  const summaryOutput = resolve(argument("--summary"));
  const mode = argument("--mode");
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(dirname(summaryOutput), { recursive: true });
  try {
    const labels = JSON.parse(argument("--labels"));
    const evidence = execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", base, head, "--"], {
      cwd: repository, encoding: "utf8", maxBuffer: 10 * 1024 * 1024
    });
    const plan = bindPlanToRun(classifyChanges(parseNameStatus(evidence), labels), identity, mode);
    writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(summaryOutput, profileSummary(plan), { mode: 0o600 });
  } catch (error) {
    if (!process.argv.includes("--fallback-on-error")) throw error;
    const fallback = fallbackPlanToRun(identity);
    writeFileSync(output, `${JSON.stringify(fallback, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(summaryOutput, profileSummary(fallback), { mode: 0o600 });
    throw error;
  }
}

function readAdmission() {
  try {
    return JSON.parse(readFileSync(admissionUrl, "utf8"));
  } catch (error) {
    return error?.code === "ENOENT" ? null : {};
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
