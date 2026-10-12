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
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null };
}

export function releaseBranchOf(version) {
  const { major, minor, patch, prerelease } = versionOf(version);
  if (patch > 0 && prerelease !== null) throw new Error(`${version}: no line releases a patch candidate`);
  return patch === 0 ? "main" : `release/${major}.${minor}`;
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

export function releaseToolingPaths(workflowTexts) {
  return [...new Set(workflowTexts.flatMap((text) => [...text.matchAll(/(?<![\w./-])tools\/[\w.-]+\.mjs\b/g)]
    .map(([path]) => path)))].toSorted();
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

// The same split as release-please 17.6's splitMessages, which lists each part as its own entry.
const nestedCommitPattern = /\r?\n\r?\n(?=(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\(.*?\))?: )/;

function entriesOf(message) {
  const [outer, ...nested] = message.split("BEGIN_NESTED_COMMIT");
  let head = outer;
  const entries = [];
  for (const part of nested) {
    const [entry, ...rest] = part.split("END_NESTED_COMMIT");
    entries.push(entry.trim());
    head += rest.join("END_NESTED_COMMIT");
  }
  return [...head.split(nestedCommitPattern), ...entries];
}

function releasedEntry(entry, releasable) {
  const header = headerPattern.exec(entry);
  return header !== null && (releasable.has(header[1]) || header[2] === "!" || /^BREAKING[ -]CHANGE: /m.test(entry));
}

function citedCommits(text) {
  return [...text.matchAll(cherryPickPattern)].map(([, sha]) => sha);
}

function pickedFromMain(message, releasable, onMain) {
  const segments = message.split(/\r?\n\r?\n(?=\* )/);
  const considered = (segments.length > 1 ? segments.slice(1) : segments).map((segment) => segment.replace(/^\* /, ""))
    .filter((segment) => !(headerPattern.test(segment) && !releasedEntry(segment, releasable)));
  return considered.length > 0 && considered.every((segment) => citedCommits(segment).some(onMain));
}

export function forwardPortVerdict({ git, baseRef, headRef, mainRef, releasable }) {
  const tag = `v${recordedVersion(git, baseRef)}`;
  const tagRef = `refs/tags/${tag}`;
  if (!succeeds(git, "rev-parse", "--verify", "--quiet", `${tagRef}^{commit}`)) {
    return { check: "forward-port", accepted: false, missing: [],
      detail: `${tag} is not tagged, so the changes since the last release cannot be read` };
  }
  const onMain = (sha) => succeeds(git, "merge-base", "--is-ancestor", sha, mainRef);
  const ported = new Set(commitsBetween(git, tagRef, mainRef).flatMap(({ message }) => citedCommits(message)));
  const missing = commitsBetween(git, tagRef, headRef)
    .filter(({ message }) => entriesOf(message).some((entry) => releasedEntry(entry, releasable)))
    .filter(({ sha }) => !ported.has(sha) && !onMain(sha))
    .filter(({ message }) => !pickedFromMain(message, releasable, onMain))
    .map(({ sha, message }) => `${sha} ${message.split("\n")[0]}`);
  return { check: "forward-port", accepted: missing.length === 0, missing,
    detail: missing.length === 0 ? `every released change since ${tag} is on main`
      : `${missing.length} released change(s) since ${tag} have no commit on main carrying their `
        + "(cherry picked from commit <sha>) line" };
}

export function pullRequestVerdicts({ git, base, headRef, refOf, releasable, body = "" }) {
  const baseRef = refOf(targetBranch(base));
  const override = base !== "main" && /BEGIN_COMMIT_OVERRIDE/.test(body ?? "")
    ? [{ check: "override", accepted: false, detail: "release-please would replace this pull request's commit message "
      + "with BEGIN_COMMIT_OVERRIDE, which the forward-port check cannot read from git" }]
    : [];
  const version = recordedVersion(git, headRef);
  if (version === recordedVersion(git, baseRef)) {
    return [...override, { check: "release", accepted: true,
      detail: "the manifest does not change, so this is not a release pull request" }];
  }
  const line = lineVerdict({ base, version });
  if (!line.accepted || base === "main") return [...override, line];
  return [...override, line, forwardPortVerdict({ git, baseRef, headRef, mainRef: refOf("main"), releasable })];
}

function precedes(left, right) {
  for (const field of ["major", "minor", "patch"]) {
    if (left[field] !== right[field]) return left[field] < right[field];
  }
  return false;
}

export function newestLineVerdict(version, published) {
  const releases = published.map((tag) => {
    const named = /^v(.+)$/.exec(tag)?.[1];
    try {
      return versionOf(named);
    } catch {
      throw new Error(`published tags must be release tags, not ${JSON.stringify(tag)}`);
    }
  }).filter((release) => release.prerelease === null);
  const candidate = versionOf(version);
  const newerLine = releases.find((release) => release.major > candidate.major
    || (release.major === candidate.major && release.minor > candidate.minor));
  const latest = candidate.prerelease === null && !releases.some((release) => precedes(candidate, release));
  if (candidate.patch > 0 && newerLine) {
    return { check: "newest-line", accepted: false, latest: false,
      detail: `${version} patches ${candidate.major}.${candidate.minor}, but ${newerLine.major}.${newerLine.minor}.`
        + `${newerLine.patch} is published and only the newest line is maintained` };
  }
  return { check: "newest-line", accepted: true, latest,
    detail: `no line newer than ${candidate.major}.${candidate.minor} is published` };
}

export function tagAdmission({ git, tag, commit, refOf, published }) {
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
        : `${tag} names ${version}, but ${commit} records ${recorded ?? "no released version"}` },
    newestLineVerdict(version, published)
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

function fetchTag(git, tag) {
  try {
    git("fetch", "--quiet", "--no-tags", "origin", `+refs/tags/${tag}:refs/tags/${tag}`);
  } catch {
    process.stderr.write(`origin has no tag ${tag}\n`);
  }
}

const usage = "usage: release-line.mjs pull-request --base <branch> --head <commit-or-ref> [--summary <file>] | "
  + "admit-tag --tag <tag> --commit <sha> --published-tags <json> [--summary <file>] [--github-output <file>]";
const optional = ["summary", "github-output"];

function optionsOf(arguments_) {
  const [command, ...rest] = arguments_;
  const allowed = { "pull-request": ["base", "head", "summary"],
    "admit-tag": ["tag", "commit", "published-tags", "summary", "github-output"] }[command];
  if (!allowed || rest.length % 2 !== 0) throw new Error(usage);
  const options = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index].slice(2);
    if (!rest[index].startsWith("--") || !allowed.includes(key) || options[key] !== undefined) throw new Error(usage);
    options[key] = rest[index + 1];
  }
  if (allowed.filter((key) => !optional.includes(key)).some((key) => !options[key])) throw new Error(usage);
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

export function main(arguments_, git = runGit, environment = process.env) {
  const options = optionsOf(arguments_);
  if (options.command === "pull-request") {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(options.head)) {
      throw new Error("--head must name a commit or a ref, such as a full sha");
    }
    const base = targetBranch(options.base);
    const head = git("rev-parse", "--verify", `${options.head}^{commit}`);
    fetchBranches(git, [base, "main"]);
    fetchTag(git, `v${recordedVersion(git, remoteRefOf(base))}`);
    const config = JSON.parse(readFileSync(new URL("../release-please-config.json", import.meta.url), "utf8"));
    return report(pullRequestVerdicts({ git, base, headRef: head, refOf: remoteRefOf,
      releasable: releasableTypes(config), body: environment.PULL_REQUEST_BODY ?? "" }), options.summary);
  }
  if (!commitPattern.test(options.commit)) throw new Error("--commit must be a full 40-character sha");
  const published = JSON.parse(options["published-tags"]);
  if (!Array.isArray(published)) throw new Error("--published-tags must be a JSON array of tags");
  const version = /^v(.+)$/.exec(options.tag)?.[1];
  let branch = null;
  try {
    branch = releaseBranchOf(version);
    fetchBranches(git, [branch]);
  } catch {
    branch = null;
  }
  const verdicts = tagAdmission({ git, tag: options.tag, commit: options.commit, refOf: remoteRefOf, published });
  if (options["github-output"] && branch !== null) {
    appendFileSync(options["github-output"], `branch=${branch}\nlatest=${verdicts.at(-1).latest === true}\n`);
  }
  return report(verdicts, options.summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!main(process.argv.slice(2))) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
