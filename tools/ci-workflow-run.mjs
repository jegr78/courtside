import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const refPattern = /^[^\p{Cc}\p{Zl}\p{Zp}]{1,255}$/u;
const shaPattern = /^[a-f0-9]{40}$/;

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function runIdentity(value) {
  const valid = value?.event === "pull_request"
    && value?.name === "build" && value?.path === ".github/workflows/build.yml"
    && positiveInteger(value?.id) && positiveInteger(value?.run_attempt)
    && positiveInteger(value?.repository?.id)
    && repositoryPattern.test(value?.repository?.full_name ?? "")
    && positiveInteger(value?.head_repository?.id)
    && repositoryPattern.test(value?.head_repository?.full_name ?? "")
    && refPattern.test(value?.head_branch ?? "")
    && shaPattern.test(value?.head_sha ?? "");
  if (!valid) throw new Error("Workflow run provenance is invalid");
  return {
    id: value.id,
    attempt: value.run_attempt,
    repositoryId: value.repository.id,
    repository: value.repository.full_name,
    headRepositoryId: value.head_repository.id,
    headRepository: value.head_repository.full_name,
    headRef: value.head_branch,
    headCommit: value.head_sha,
  };
}

export function resolveWorkflowRun(event, run, expectedRepository, runId, attempt) {
  const captured = runIdentity(event?.workflow_run);
  const observed = runIdentity(run);
  const references = event.workflow_run.pull_requests;
  const reference = Array.isArray(references) && references.length === 1 ? references[0] : null;
  const valid = repositoryPattern.test(expectedRepository ?? "")
    && positiveInteger(runId) && positiveInteger(attempt)
    && event?.repository?.id === captured.repositoryId
    && event?.repository?.full_name === expectedRepository
    && captured.repository === expectedRepository
    && observed.repository === expectedRepository
    && Object.keys(captured).every((key) => captured[key] === observed[key])
    && captured.id === runId && captured.attempt === attempt
    && positiveInteger(reference?.number)
    && reference?.base?.repo?.id === captured.repositoryId
    && refPattern.test(reference?.base?.ref ?? "")
    && shaPattern.test(reference?.base?.sha ?? "")
    && reference?.head?.repo?.id === captured.headRepositoryId
    && reference?.head?.ref === captured.headRef
    && reference?.head?.sha === captured.headCommit;
  if (!valid) throw new Error("Workflow run provenance is invalid");
  return {
    baseCommit: reference.base.sha,
    headCommit: captured.headCommit,
    pullRequestNumber: reference.number
  };
}

function integerArgument(value, name) {
  const parsed = Number(value);
  if (!positiveInteger(parsed) || String(parsed) !== value) throw new Error(`Invalid ${name}`);
  return parsed;
}

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || values[name] !== undefined) {
      throw new Error("Arguments must be unique --name value pairs");
    }
    values[name] = value;
  }
  for (const name of ["--event", "--run", "--repository", "--run-id", "--attempt", "--output"]) {
    if (!values[name]) throw new Error(`Missing ${name}`);
  }
  return values;
}

function main() {
  const values = argumentsFrom(process.argv.slice(2));
  const provenance = resolveWorkflowRun(
    JSON.parse(readFileSync(values["--event"], "utf8")),
    JSON.parse(readFileSync(values["--run"], "utf8")),
    values["--repository"], integerArgument(values["--run-id"], "run id"),
    integerArgument(values["--attempt"], "attempt"));
  writeFileSync(values["--output"], `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o600 });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
