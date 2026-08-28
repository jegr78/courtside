import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));
const rules = JSON.parse(readFileSync(new URL("../ci/test-profiles.json", import.meta.url), "utf8"));
const reducedProfiles = ["docs", "backend", "frontend"];

function matchingRule(path, profile) {
  const configured = rules.profiles[profile];
  if (configured.exact.includes(path)) return `exact:${path}`;
  const prefix = configured.prefixes.find((candidate) => path.startsWith(candidate));
  return prefix === undefined ? null : `prefix:${prefix}`;
}

export function classifyPath(path) {
  if (typeof path !== "string" || path.length < 1 || path.includes("\0")) return null;
  for (const profile of ["full", ...reducedProfiles]) {
    const rule = matchingRule(path, profile);
    if (rule !== null) return { profile, rule };
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
    const structural = change.status !== "M";
    const classification = classifyPath(change.path);
    if (structural || classification === null || classification.profile === "full") requiresFull = true;
    const profile = structural || classification === null ? "full" : classification.profile;
    if (profile !== "full") selected.add(profile);
    reasons.push({
      code: structural ? "structural-change" : classification === null ? "unknown-path" : classification.rule,
      path: change.path,
      profile,
      status: change.status
    });
  }
  const profiles = requiresFull ? ["full"] : reducedProfiles.filter((profile) => selected.has(profile));
  if (profiles.length === 0) throw new Error("Classification selected no test profile");
  return { schemaVersion: 1, profiles, isFull: requiresFull, reasons };
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
    "# Observed test profiles",
    "",
    `Selected: ${plan.profiles.map((profile) => `\`${profile}\``).join(", ")}`,
    "",
    "This decision is observational. The complete quality gate still runs.",
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
  const labels = JSON.parse(argument("--labels"));
  const evidence = execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", base, head, "--"], {
    cwd: repository, encoding: "utf8", maxBuffer: 10 * 1024 * 1024
  });
  const plan = classifyChanges(parseNameStatus(evidence), labels);
  const output = resolve(argument("--output"));
  const summaryOutput = resolve(argument("--summary"));
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(dirname(summaryOutput), { recursive: true });
  writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(summaryOutput, profileSummary(plan), { mode: 0o600 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
