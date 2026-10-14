import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { releaseBranchOf } from "./release-line.mjs";

const commitPattern = /^[a-f0-9]{40}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const usage = "usage: release-anchor release-commit --commit <sha> | ensure --version <version> --commit <sha> --branch <branch>";

export function anchorRefOf(version, commit) {
  if (!versionPattern.test(version ?? "")) throw new Error(`${JSON.stringify(version)} is not a release version`);
  if (!commitPattern.test(commit ?? "")) throw new Error("the anchored commit must be a full 40-character sha");
  return `refs/heads/release-anchor/v${version}/${commit}`;
}

export function releaseVersionOf(manifest, parentManifest) {
  return manifest !== parentManifest && versionPattern.test(manifest ?? "") ? manifest : null;
}

// GitHub lets a token without the Workflows permission name a commit only while some ref already names it.
export function ensureAnchor({ version, commit, branch, github }) {
  const ref = anchorRefOf(version, commit);
  const existing = github.get(ref);
  if (existing === commit) return "present";
  if (existing !== null) throw new Error(`${ref} names ${existing}, not ${commit}`);
  try {
    github.create(ref, commit);
  } catch (error) {
    throw new Error(`GitHub refused ${ref}: ${error.message.trim()}. The tag can only be written while a branch names `
      + `the release commit, and ${commit} no longer heads ${branch}; dispatch the candidate for the head of ${branch}`);
  }
  return "created";
}

function gh(arguments_) {
  return execFileSync("gh", arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function errorText(error) {
  return `${error.stderr ?? ""}${error.stdout ?? ""}`.trim() || error.message;
}

function githubOf(repository) {
  return {
    get(ref) {
      try {
        return gh(["api", `repos/${repository}/git/${ref.replace(/^refs\//, "ref/")}`, "--jq", ".object.sha"]);
      } catch (error) {
        if (/HTTP 404/.test(errorText(error))) return null;
        throw new Error(errorText(error));
      }
    },
    create(ref, sha) {
      try {
        gh(["api", `repos/${repository}/git/refs`, "-f", `ref=${ref}`, "-f", `sha=${sha}`]);
      } catch (error) {
        throw new Error(errorText(error));
      }
    }
  };
}

function manifestAt(revision) {
  try {
    return JSON.parse(execFileSync("git", ["show", `${revision}:.release-please-manifest.json`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))["."] ?? null;
  } catch {
    return null;
  }
}

function optionsOf(arguments_) {
  const [command, ...rest] = arguments_;
  const options = { command };
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index]?.startsWith("--") || rest[index + 1] === undefined) throw new Error(usage);
    options[rest[index].slice(2)] = rest[index + 1];
  }
  return options;
}

function run(options, environment) {
  const github = githubOf(environment.GITHUB_REPOSITORY);
  if (options.command === "release-commit") {
    const version = releaseVersionOf(manifestAt(options.commit), manifestAt(`${options.commit}^1`));
    if (version === null) return `${options.commit} is not a release commit`;
    const outcome = ensureAnchor({ version, commit: options.commit, branch: releaseBranchOf(version), github });
    return `${anchorRefOf(version, options.commit)} ${outcome}`;
  }
  if (options.command === "ensure") {
    const outcome = ensureAnchor({ version: options.version, commit: options.commit, branch: options.branch, github });
    return `${anchorRefOf(options.version, options.commit)} ${outcome}`;
  }
  throw new Error(usage);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${run(optionsOf(process.argv.slice(2)), process.env)}\n`);
  } catch (error) {
    process.stdout.write(`::error::${error.message}\n`);
    process.exitCode = 1;
  }
}
