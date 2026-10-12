import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;
const releaseBranchPattern = /^release\/(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const commitPattern = /^[a-f0-9]{40}$/;
const headerPattern = /^(\w+)(?:\([^)]*\))?(!)?: /;
const cherryPickPattern = /\(cherry picked from commit ([a-f0-9]{40})\)/g;
const manifestPath = ".release-please-manifest.json";

function versionOf(version) {
  const match = typeof version === "string" ? versionPattern.exec(version) : null;
  if (!match) throw new Error(`${JSON.stringify(version)} is not a release version`);
  return { major: match[1], minor: match[2], patch: Number(match[3]), prerelease: match[4] ?? null };
}

export function releaseBranchOf(version) {
  const { major, minor, patch, prerelease } = versionOf(version);
  return patch === 0 || prerelease !== null ? "main" : `release/${major}.${minor}`;
}

export function targetBranch(branch) {
  if (branch !== "main" && !releaseBranchPattern.test(branch ?? "")) {
    throw new Error(`${JSON.stringify(branch)} is not a release target; use main or release/<major>.<minor>`);
  }
  return branch;
}

export function lineVerdict({ base, version }) {
  targetBranch(base);
  const { major, minor, patch, prerelease } = versionOf(version);
  const line = `${major}.${minor}`;
  if (base === "main") {
    return patch === 0
      ? { check: "line", accepted: true, detail: `${version} is cut on main` }
      : { check: "line", accepted: false,
        detail: `${version} is a patch of the ${line} line and is released from release/${line}, not from main` };
  }
  const accepted = base === `release/${line}` && patch > 0 && prerelease === null;
  return { check: "line", accepted,
    detail: accepted ? `${version} is a patch of ${base}` : `${base} releases patches of its own line only, not ${version}` };
}

export function releasableTypes(config) {
  return new Set((config["changelog-sections"] ?? []).filter((section) => section.hidden !== true)
    .map((section) => section.type));
}

function recordedVersion(git, revision) {
  return JSON.parse(git("show", `${revision}:${manifestPath}`))["."];
}

function succeeds(git, ...arguments_) {
  try {
    git(...arguments_);
    return true;
  } catch {
    return false;
  }
}

function commitsBetween(git, from, to) {
  return git("log", "--format=%H%x00%B%x1e", `${from}..${to}`).split("\x1e")
    .map((entry) => entry.trim()).filter(Boolean)
    .map((entry) => {
      const [sha, message] = entry.split("\0");
      return { sha, message: message.trim() };
    });
}

function released(message, releasable) {
  const header = headerPattern.exec(message);
  return header !== null && (releasable.has(header[1]) || header[2] === "!"
    || /^BREAKING[ -]CHANGE: /m.test(message));
}

export function forwardPortVerdict({ git, baseRef, headRef, mainRef, releasable }) {
  const tag = `v${recordedVersion(git, baseRef)}`;
  const tagRef = `refs/tags/${tag}`;
  const onMain = (sha) => succeeds(git, "merge-base", "--is-ancestor", sha, mainRef);
  const ports = commitsBetween(git, tagRef, mainRef).map(({ message }) => message).join("\n");
  const missing = commitsBetween(git, tagRef, headRef)
    .filter(({ message }) => released(message, releasable))
    .filter(({ message }) => ![...message.matchAll(cherryPickPattern)].some(([, origin]) => onMain(origin)))
    .filter(({ sha }) => !ports.includes(`(cherry picked from commit ${sha})`))
    .map(({ sha, message }) => `${sha} ${message.split("\n")[0]}`);
  return { check: "forward-port", accepted: missing.length === 0, missing,
    detail: missing.length === 0 ? `every released change since ${tag} is on main`
      : `${missing.length} released change(s) since ${tag} have no commit on main carrying their `
        + "(cherry picked from commit <sha>) line" };
}

export function pullRequestVerdicts({ git, base, headRef, refOf, releasable }) {
  const baseRef = refOf(targetBranch(base));
  const version = recordedVersion(git, headRef);
  if (version === recordedVersion(git, baseRef)) {
    return [{ check: "release", accepted: true,
      detail: "the manifest does not change, so this is not a release pull request" }];
  }
  const line = lineVerdict({ base, version });
  if (!line.accepted || base === "main") return [line];
  return [line, forwardPortVerdict({ git, baseRef, headRef, mainRef: refOf("main"), releasable })];
}

export function tagAdmission({ git, tag, commit, refOf }) {
  const version = /^v(.+)$/.exec(tag ?? "")?.[1];
  let branch;
  try {
    branch = releaseBranchOf(version);
  } catch (error) {
    return [{ check: "line", accepted: false, detail: `${tag}: ${error.message}` }];
  }
  const onBranch = succeeds(git, "merge-base", "--is-ancestor", commit, refOf(branch));
  let recorded = null;
  try {
    recorded = recordedVersion(git, commit);
  } catch {
    recorded = null;
  }
  return [
    { check: "line", accepted: true, detail: `${tag} belongs to ${branch}` },
    { check: "branch", accepted: onBranch,
      detail: onBranch ? `${commit} is on ${branch}` : `${tag} does not point at a commit on ${branch}` },
    { check: "manifest", accepted: recorded === version,
      detail: recorded === version ? `${commit} records ${version}`
        : `${tag} names ${version}, but ${commit} records ${recorded ?? "no released version"}` }
  ];
}

function runGit(...arguments_) {
  return execFileSync("git", arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024 }).trim();
}

export function remoteRefOf(branch) {
  return `refs/remotes/origin/${targetBranch(branch)}`;
}

export function branchFetchArguments(branch) {
  return ["fetch", "--no-tags", "origin", `+refs/heads/${targetBranch(branch)}:refs/remotes/origin/${branch}`];
}

function fetchBranches(git, branches) {
  for (const branch of new Set(branches)) {
    try {
      git(...branchFetchArguments(branch));
    } catch {
      process.stderr.write(`origin has no branch ${branch}\n`);
    }
  }
}

const usage = "usage: release-line.mjs pull-request --base <branch> --head <commit-or-ref> | "
  + "admit-tag --tag <tag> --commit <sha> [--summary <file>]";

function optionsOf(arguments_) {
  const [command, ...rest] = arguments_;
  const allowed = { "pull-request": ["base", "head", "summary"], "admit-tag": ["tag", "commit", "summary"] }[command];
  if (!allowed || rest.length % 2 !== 0) throw new Error(usage);
  const options = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index].slice(2);
    if (!rest[index].startsWith("--") || !allowed.includes(key) || options[key] !== undefined) throw new Error(usage);
    options[key] = rest[index + 1];
  }
  const required = allowed.filter((key) => key !== "summary");
  if (required.some((key) => !options[key])) throw new Error(usage);
  return options;
}

function report(verdicts, summary) {
  const lines = verdicts.map(({ check, accepted, detail, missing }) =>
    [`${accepted ? "accepted" : "refused"} ${check}: ${detail}`, ...(missing ?? []).map((entry) => `  ${entry}`)]
      .join("\n"));
  process.stdout.write(`${lines.join("\n")}\n`);
  if (summary) appendFileSync(summary, `${lines.map((line) => `    ${line}`).join("\n")}\n`);
  return verdicts.every(({ accepted }) => accepted);
}

export function main(arguments_, git = runGit) {
  const options = optionsOf(arguments_);
  const refOf = remoteRefOf;
  if (options.command === "pull-request") {
    const base = targetBranch(options.base);
    const head = git("rev-parse", "--verify", `${options.head}^{commit}`);
    const releaseBranch = releaseBranchOf(recordedVersion(git, head));
    fetchBranches(git, [base, "main", releaseBranch]);
    const config = JSON.parse(readFileSync(new URL("../release-please-config.json", import.meta.url), "utf8"));
    return report(pullRequestVerdicts({ git, base, headRef: head, refOf, releasable: releasableTypes(config) }),
      options.summary);
  }
  if (!commitPattern.test(options.commit)) throw new Error("--commit must be a full 40-character sha");
  const version = /^v(.+)$/.exec(options.tag)?.[1];
  if (versionPattern.test(version ?? "")) fetchBranches(git, [releaseBranchOf(version)]);
  return report(tagAdmission({ git, tag: options.tag, commit: options.commit, refOf }), options.summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!main(process.argv.slice(2))) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
