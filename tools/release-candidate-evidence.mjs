import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const candidateWorkflow = ".github/workflows/release-candidate.yml";
export const candidateJobs = ["preconditions", "release-build", "image", "archive", "qualify", "gates"];

const contract = "release-candidate-v1";
const recordFields = ["archive", "bookingSeedImage", "build", "commit", "contract", "image", "jobs", "outcome", "ref",
  "rehearsal", "repository", "runAttempt", "runId", "schemaVersion", "tag", "version", "workflow"];
const commitPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const checksumPattern = /^[a-f0-9]{64}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function artifactNameOf(commit) {
  return `release-candidate-evidence-${commit}`;
}

function modeOf(mode) {
  if (mode !== "release" && mode !== "rehearsal") throw new Error(`mode must be release or rehearsal, not ${mode}`);
  return mode;
}

function image(repository, digest) {
  if (!digestPattern.test(digest ?? "")) throw new Error(`image digest ${digest} is malformed`);
  return `ghcr.io/${repository}@${digest}`;
}

function buildOf(build, rehearsal) {
  if (build === null && rehearsal) return null;
  if (!hasExactly(build, ["runAttempt", "runId"]) || !Number.isSafeInteger(build.runId) || build.runId < 1
      || !Number.isSafeInteger(build.runAttempt) || build.runAttempt < 1) {
    throw new Error("candidate evidence names no green push build of its commit");
  }
  return { runId: build.runId, runAttempt: build.runAttempt };
}

export function candidateRecord({ repository, commit, version, rehearsal, runId, runAttempt, workflowRef, ref,
  imageDigest, bookingSeedDigest, archive, build, results }) {
  if (!repositoryPattern.test(repository ?? "")) throw new Error("the repository is malformed");
  if (!commitPattern.test(commit ?? "")) throw new Error("the candidate commit is malformed");
  if (!versionPattern.test(version ?? "")) throw new Error("the candidate version is malformed");
  if (typeof rehearsal !== "boolean") throw new Error("rehearsal must be true or false");
  if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(runAttempt) || runAttempt < 1) {
    throw new Error("the candidate run is malformed");
  }
  if (workflowRef !== `${repository}/${candidateWorkflow}@${ref}`) {
    throw new Error(`evidence is written by ${candidateWorkflow}, not ${workflowRef}`);
  }
  if (archive?.name !== `courtside-deployment-${version}.zip` || !checksumPattern.test(archive?.sha256 ?? "")) {
    throw new Error("the candidate archive is malformed");
  }
  for (const job of ["select", ...candidateJobs]) {
    const result = results?.[job]?.result;
    if (result === undefined) throw new Error(`the candidate cannot pass while ${job} is missing`);
    if (result !== "success") throw new Error(`the candidate cannot pass while ${job} is ${result}`);
  }
  return {
    schemaVersion: 1,
    contract,
    repository,
    commit,
    version,
    tag: `v${version}`,
    rehearsal,
    runId,
    runAttempt,
    workflow: candidateWorkflow,
    ref,
    image: image(repository, imageDigest),
    bookingSeedImage: image(repository, bookingSeedDigest),
    archive: { name: archive.name, sha256: archive.sha256 },
    build: buildOf(build, rehearsal),
    jobs: Object.fromEntries(candidateJobs.map((job) => [job, "success"])),
    outcome: "passed"
  };
}

function hasExactly(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).toSorted().join() === fields.toSorted().join();
}

export function verifyCandidateEvidence(record, { commit, version, runId, mode, archiveSha256 }) {
  const rehearsalMode = modeOf(mode) === "rehearsal";
  if (!hasExactly(record, recordFields) || record.schemaVersion !== 1 || record.contract !== contract
      || record.outcome !== "passed" || !hasExactly(record.archive, ["name", "sha256"])
      || !hasExactly(record.jobs, candidateJobs) || !repositoryPattern.test(record.repository)) {
    throw new Error("candidate evidence is incomplete or invalid");
  }
  if (record.workflow !== candidateWorkflow) throw new Error(`candidate evidence was written by ${record.workflow}`);
  if (record.commit !== commit) throw new Error(`candidate evidence records commit ${record.commit}, not ${commit}`);
  if (record.runId !== runId) throw new Error(`candidate evidence records run ${record.runId}, not ${runId}`);
  if (!version && !rehearsalMode) throw new Error("a release names its version");
  if (version && record.version !== version) {
    throw new Error(`candidate evidence records version ${record.version}, not ${version}`);
  }
  if (record.tag !== `v${record.version}`) throw new Error(`candidate evidence tags ${record.tag} for ${record.version}`);
  if (record.rehearsal !== rehearsalMode) {
    throw new Error(`a ${rehearsalMode ? "release" : "rehearsal"} record cannot be promoted in ${mode} mode`);
  }
  if (!rehearsalMode && record.ref !== "refs/heads/main") throw new Error(`the release candidate ran on ${record.ref}`);
  const build = buildOf(record.build, record.rehearsal);
  for (const [job, result] of Object.entries(record.jobs)) {
    if (result !== "success") throw new Error(`candidate job ${job} is ${result}`);
  }
  const imagePattern = new RegExp(`^ghcr\\.io/${record.repository.replaceAll(".", "\\.")}@sha256:[a-f0-9]{64}$`);
  if (!imagePattern.test(record.image) || !imagePattern.test(record.bookingSeedImage)
      || record.archive.name !== `courtside-deployment-${record.version}.zip`
      || !checksumPattern.test(record.archive.sha256)) {
    throw new Error("candidate evidence carries a malformed digest or archive");
  }
  if (archiveSha256 !== undefined && archiveSha256 !== record.archive.sha256) {
    throw new Error(`archive ${archiveSha256} does not match the qualified ${record.archive.sha256}`);
  }
  return { runId: record.runId, version: record.version, image: record.image,
    bookingSeedImage: record.bookingSeedImage, archiveSha256: record.archive.sha256, build };
}

export function candidateRuns({ artifacts, runs, jobs, commit, mode }) {
  const releaseMode = modeOf(mode) === "release";
  const name = artifactNameOf(commit);
  return artifacts.flatMap((page) => page.artifacts ?? [])
    .filter((artifact) => artifact.name === name && artifact.expired === false)
    .map((artifact) => ({ artifact, run: runs[artifact.workflow_run?.id] }))
    .filter(({ artifact, run }) => run !== undefined
      && run.path === candidateWorkflow
      && (run.event === "workflow_run" || run.event === "workflow_dispatch")
      && (!releaseMode || (run.head_branch === "main" && artifact.workflow_run.head_branch === "main"))
      && (jobs[run.id] ?? []).some((job) => job.name === "evidence" && job.conclusion === "success"))
    .map(({ run }) => run.id)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .toSorted((left, right) => right - left)
    .map((runId) => ({ runId, artifact: name }));
}

export function findCandidateRun({ artifacts, runs, jobs, records, commit, mode }) {
  const rehearsal = modeOf(mode) === "rehearsal";
  const found = candidateRuns({ artifacts, runs, jobs, commit, mode })
    .find(({ runId }) => records?.[runId]?.rehearsal === rehearsal);
  if (found === undefined) throw new Error(`no candidate evidence for ${commit} in ${mode} mode`);
  return found;
}

function sha256Of(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function command(executable, arguments_) {
  return execFileSync(executable, arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function api(path) {
  return JSON.parse(command("gh", ["api", "--paginate", "--slurp", path]));
}

function rehearsalOf(value) {
  if (value === "true") return true;
  if (value === "false" || value === "") return false;
  throw new Error(`rehearsal must be true or false, not ${value}`);
}

function writeOutputs(path, outputs) {
  if (path) appendFileSync(path, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(""));
}

function write(options, environment) {
  const record = candidateRecord({
    repository: environment.GITHUB_REPOSITORY,
    commit: options.commit,
    version: options.version,
    rehearsal: rehearsalOf(options.rehearsal),
    runId: Number(environment.GITHUB_RUN_ID),
    runAttempt: Number(environment.GITHUB_RUN_ATTEMPT),
    workflowRef: environment.GITHUB_WORKFLOW_REF,
    ref: environment.GITHUB_REF,
    imageDigest: options["image-digest"],
    bookingSeedDigest: options["booking-seed-digest"],
    archive: { name: basename(options.archive), sha256: sha256Of(options.archive) },
    build: options["build-run-id"] === "" && options["build-run-attempt"] === "" ? null
      : { runId: Number(options["build-run-id"]), runAttempt: Number(options["build-run-attempt"]) },
    results: JSON.parse(options.results)
  });
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ commit: record.commit, tag: record.tag, outcome: record.outcome })}\n`);
}

function find(options, environment) {
  const repository = environment.GITHUB_REPOSITORY;
  if (!repositoryPattern.test(repository ?? "")) throw new Error("GITHUB_REPOSITORY is required");
  const name = artifactNameOf(options.commit);
  const artifacts = api(`repos/${repository}/actions/artifacts?name=${name}&per_page=100`);
  const ids = [...new Set(artifacts.flatMap((page) => page.artifacts ?? []).map((artifact) => artifact.workflow_run?.id)
    .filter(Number.isSafeInteger))];
  const runs = Object.fromEntries(ids.map((id) => [id, JSON.parse(command("gh", ["api", `repos/${repository}/actions/runs/${id}`]))]));
  const jobs = Object.fromEntries(ids.map((id) => [id,
    api(`repos/${repository}/actions/runs/${id}/jobs?per_page=100`).flatMap((page) => page.jobs ?? [])]));
  const scratch = mkdtempSync(join(tmpdir(), "courtside-candidate-"));
  const records = {};
  for (const { runId } of candidateRuns({ artifacts, runs, jobs, commit: options.commit, mode: options.mode })) {
    const directory = join(scratch, String(runId));
    command("gh", ["run", "download", String(runId), "--repo", repository, "--name", name, "--dir", directory]);
    records[runId] = JSON.parse(readFileSync(join(directory, "evidence.json"), "utf8"));
  }
  const found = findCandidateRun({ artifacts, runs, jobs, records, commit: options.commit, mode: options.mode });
  if (options.download) {
    mkdirSync(options.download, { recursive: true });
    copyFileSync(join(scratch, String(found.runId), "evidence.json"), join(options.download, "evidence.json"));
  }
  writeOutputs(options["github-output"], { "run-id": found.runId });
  process.stdout.write(`${JSON.stringify(found)}\n`);
}

function verify(options) {
  const verified = verifyCandidateEvidence(JSON.parse(readFileSync(options.evidence, "utf8")), {
    commit: options.commit,
    version: options.version ?? "",
    runId: Number(options["run-id"]),
    mode: options.mode,
    archiveSha256: options.archive === undefined ? undefined : sha256Of(options.archive)
  });
  writeOutputs(options["github-output"], { version: verified.version, image: verified.image,
    "booking-seed-image": verified.bookingSeedImage, "archive-sha256": verified.archiveSha256 });
  process.stdout.write(`${JSON.stringify(verified)}\n`);
}

const modes = {
  "--write": { run: write, required: ["commit", "version", "rehearsal", "image-digest", "booking-seed-digest",
    "archive", "build-run-id", "build-run-attempt", "results", "output"], optional: [] },
  "--find": { run: find, required: ["commit", "mode"], optional: ["download", "github-output"] },
  "--verify": { run: verify, required: ["evidence", "commit", "run-id", "mode"],
    optional: ["version", "archive", "github-output"] }
};

function parse(arguments_) {
  const mode = modes[arguments_[0]];
  if (mode === undefined) throw new Error("usage: release-candidate-evidence --write|--find|--verify [options]");
  const options = {};
  for (let index = 1; index < arguments_.length; index += 2) {
    const key = arguments_[index]?.slice(2);
    const value = arguments_[index + 1];
    if (!arguments_[index].startsWith("--") || ![...mode.required, ...mode.optional].includes(key) || value === undefined
        || options[key] !== undefined) {
      throw new Error(`release candidate evidence argument ${arguments_[index]} is not accepted`);
    }
    options[key] = value;
  }
  const missing = mode.required.filter((key) => options[key] === undefined);
  if (missing.length > 0) throw new Error(`release candidate evidence needs --${missing.join(", --")}`);
  return { run: mode.run, options };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { run, options } = parse(process.argv.slice(2));
    run(options, process.env);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
