import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const shaPattern = /^[a-f0-9]{40}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function requiredString(value, pattern, name) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function requiredId(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
}

function runIdentity(run) {
  if (run?.event !== "pull_request") {
    throw new Error("Expected a pull_request run");
  }
  return {
    repository: requiredString(run.repository?.full_name, repositoryPattern, "run repository"),
    repositoryId: requiredId(run.repository?.id, "run repository id"),
    headRepository: requiredString(run.head_repository?.full_name, repositoryPattern,
      "run head repository"),
    headRepositoryId: requiredId(run.head_repository?.id, "run head repository id"),
    headBranch: requiredString(run.head_branch, /^.{1,255}$/, "run head branch"),
    headSha: requiredString(run.head_sha, shaPattern, "run head SHA"),
  };
}

export function resolveRunPullRequest(run, candidates) {
  const identity = runIdentity(run);
  if (!Array.isArray(candidates)) {
    throw new Error("Pull request candidates must be an array");
  }
  const matches = candidates.filter(candidate =>
    candidate?.base?.repo?.full_name === identity.repository
    && candidate?.head?.repo?.full_name === identity.headRepository
    && candidate?.head?.ref === identity.headBranch
    && candidate?.head?.sha === identity.headSha
    && shaPattern.test(candidate?.base?.sha ?? ""));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one pull request for the completed run, found ${matches.length}`);
  }
  const candidate = matches[0];
  const runMatches = Array.isArray(run.pull_requests) ? run.pull_requests.filter(reference =>
    reference?.number === candidate.number
    && reference?.base?.repo?.id === identity.repositoryId
    && reference?.base?.ref === candidate.base.ref
    && shaPattern.test(reference?.base?.sha ?? "")
    && reference?.head?.repo?.id === identity.headRepositoryId
    && reference?.head?.ref === identity.headBranch
    && reference?.head?.sha === identity.headSha) : [];
  if (runMatches.length !== 1) {
    throw new Error(`Expected exactly one run-bound pull request, found ${runMatches.length}`);
  }
  return { ...candidate, runBaseSha: runMatches[0].base.sha };
}

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Arguments must be --name value pairs");
    }
    values[name] = value;
  }
  for (const name of ["--run", "--candidates", "--output"]) {
    if (!values[name]) {
      throw new Error(`Missing ${name}`);
    }
  }
  return values;
}

function main() {
  const values = argumentsFrom(process.argv.slice(2));
  const run = JSON.parse(readFileSync(values["--run"], "utf8"));
  const candidates = JSON.parse(readFileSync(values["--candidates"], "utf8"));
  const pullRequest = resolveRunPullRequest(run, candidates);
  writeFileSync(values["--output"], `${JSON.stringify(pullRequest, null, 2)}\n`, { mode: 0o600 });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
