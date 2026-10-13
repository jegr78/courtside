import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  branchFetchArguments, forwardPortVerdict, newestLineVerdict, releasableTypes, releaseBranchOf, releaseToolingPaths,
  remoteRefOf
} from "./release-line.mjs";

const releaseWorkflows = ["release-candidate.yml", "release-gates.yml", "release.yml", "release-plan-sync.yml"]
  .map((name) => `.github/workflows/${name}`);

// A tag push runs these from the tagged commit, so a release line must carry main's copies.
const tagRunDefinitions = [".github/workflows/release.yml", ".github/workflows/release-plan-sync.yml",
  ".github/actions/tool-dependencies"];

const commitPattern = /^[a-f0-9]{40}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const titlePattern = /^chore\(([^)]+)\): release (\S+)$/;
const pendingLabel = "autorelease: pending";

export function releaseTitleOf(version, branch = "main") {
  return `chore(${branch}): release ${version}`;
}

function rehearsalFlag(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false" || value === "" || value === undefined || value === null) return false;
  throw new Error(`rehearsal must be true or false, not ${JSON.stringify(value)}`);
}

function agreedVersion({ manifest, pomVersion, packageVersion }) {
  if (typeof manifest !== "string" || !versionPattern.test(manifest)) {
    throw new Error("the manifest records no release version");
  }
  for (const [file, recorded] of [["pom.xml", pomVersion], ["frontend/package.json", packageVersion]]) {
    if (recorded !== manifest) throw new Error(`${file} records ${recorded}, but the manifest records ${manifest}`);
  }
  return manifest;
}

function pendingRelease(pullRequests, version, commit, branch) {
  if (!Array.isArray(pullRequests) || pullRequests.length === 0) {
    throw new Error(`the manifest records ${version} without a pending release pull request`);
  }
  if (pullRequests.length > 1) {
    throw new Error(`more than one pending release pull request: ${pullRequests.map(({ number }) => `#${number}`).join(", ")}`);
  }
  const [pullRequest] = pullRequests;
  if (pullRequest.title !== releaseTitleOf(version, branch)) {
    const title = titlePattern.exec(pullRequest.title ?? "");
    const named = title === null ? JSON.stringify(pullRequest.title)
      : branch === "main" && title[1] === "main" ? title[2] : `${title[1]} ${title[2]}`;
    throw new Error(`release pull request #${pullRequest.number} names ${named}, but the manifest records ${version}`
      + (branch === "main" ? "" : ` for ${branch}`));
  }
  if (pullRequest.mergeCommitIsAncestor !== true) {
    throw new Error(`${commit} precedes the release pull request #${pullRequest.number} merged as ${pullRequest.mergeCommit}`);
  }
  return pullRequest.number;
}

function buildRunOf(run) {
  if (!Number.isSafeInteger(run?.runId) || run.runId < 1 || !Number.isSafeInteger(run?.runAttempt)
      || run.runAttempt < 1) {
    return null;
  }
  return { runId: run.runId, runAttempt: run.runAttempt };
}

export function selectReleaseCandidate(facts) {
  const rehearsal = rehearsalFlag(facts.rehearsal);
  const { event, commit } = facts;
  if (event !== "workflow_run" && event !== "workflow_dispatch") throw new Error(`unsupported event ${event}`);
  if (typeof commit !== "string" || !commitPattern.test(commit)) {
    throw new Error("the candidate commit must be a full 40-character sha");
  }
  const skip = (reason) => ({ release: false, reason, commit, version: "", tag: "", branch: "", rehearsal: false,
    pendingPullRequest: null, build: null });
  if (event === "workflow_run") {
    const build = facts.build ?? {};
    if (build.event !== "push" || build.headBranch !== "main" || build.headRepository !== facts.repository) {
      return skip("not-a-main-push");
    }
    if (build.conclusion !== "success") return skip("build-not-green");
    if (facts.manifest === facts.parentManifest) return skip("not-a-release-commit");
    if (facts.tagExists) return skip("already-tagged");
  }
  const version = agreedVersion(facts);
  const branch = releaseBranchOf(version);
  const selected = (reason, pendingPullRequest, build) => ({ release: true, reason, commit, version,
    tag: `v${version}`, branch, rehearsal: event === "workflow_dispatch" && rehearsal, pendingPullRequest, build });
  if (facts.missingTooling?.length > 0) {
    throw new Error(`${commit} lacks ${facts.missingTooling.join(", ")}, which the release workflows call at the `
      + `candidate; ${branch === "main" ? "the commit predates that tooling" : `port it to ${branch}`}`);
  }
  if (branch !== "main") {
    if (facts.releaseWorkflowDrift === undefined) throw new Error("the release workflow comparison did not run");
    if (facts.releaseWorkflowDrift.length > 0) {
      throw new Error(`${facts.releaseWorkflowDrift.join(", ")} differs from main's, and the tag runs the copy at the `
        + `candidate; port it to ${branch}`);
    }
  }
  if (event === "workflow_dispatch" && rehearsal) return selected("rehearsal", null, null);
  if (facts.newestLine === undefined) throw new Error("the newest-line check did not run");
  if (facts.newestLine.accepted !== true) throw new Error(facts.newestLine.detail);
  if (event === "workflow_run" && branch !== "main") {
    throw new Error(`${version} is released from ${branch}, not from main`);
  }
  if (event === "workflow_dispatch") {
    if (facts.ref !== "refs/heads/main") {
      throw new Error(`the candidate workflow at ${facts.ref} is not on main, so only a rehearsal may run it`);
    }
    if (facts.onBranch !== true) throw new Error(`${commit} is not on ${branch}`);
    if (facts.tagExists) throw new Error(`v${version} is already tagged`);
  }
  const pullRequest = pendingRelease(facts.pendingPullRequests, version, commit, branch);
  if (branch !== "main") {
    if (facts.forwardPort === undefined) throw new Error("the forward-port check did not run");
    if (facts.forwardPort.accepted !== true) {
      throw new Error(`${facts.forwardPort.detail}: ${facts.forwardPort.missing.join(", ")}`);
    }
  }
  const build = buildRunOf(event === "workflow_run" ? facts.build : facts.exactBuild);
  if (build === null) throw new Error(`no green build of ${commit} on ${branch}`);
  const reason = event === "workflow_run" ? "release-commit" : branch === "main" ? "re-run" : "patch-release";
  return selected(reason, pullRequest, build);
}

export function readCommitFacts(commit, git) {
  const json = (revision, path) => JSON.parse(git("show", `${revision}:${path}`));
  const parentManifest = (() => {
    try {
      return json(`${commit}^1`, ".release-please-manifest.json")["."] ?? null;
    } catch {
      return null;
    }
  })();
  const pom = git("show", `${commit}:pom.xml`);
  return {
    manifest: json(commit, ".release-please-manifest.json")["."] ?? null,
    parentManifest,
    pomVersion: /<artifactId>courtside<\/artifactId>\s*<version>([^<]+)<\/version>/.exec(pom)?.[1] ?? null,
    packageVersion: json(commit, "frontend/package.json").version ?? null
  };
}

export function pendingReleasePullRequests(pages) {
  return pages.flat()
    .filter((issue) => issue?.pull_request && typeof issue.pull_request.merged_at === "string")
    .map(({ number, title }) => ({ number, title }));
}

export function releasePullRequestOf(pull, mergeCommitIsAncestor, branch = "main") {
  if (pull?.base?.ref !== branch) return null;
  const mergeCommit = pull.merge_commit_sha ?? null;
  return { number: pull.number, title: pull.title, mergeCommit,
    mergeCommitIsAncestor: commitPattern.test(mergeCommit ?? "") && mergeCommitIsAncestor === true };
}

export function greenExactBuild(pages, repository, branch = "main") {
  const run = pages.flatMap((page) => page.workflow_runs ?? []).filter((candidate) => candidate.head_branch === branch
    && (candidate.event === "push" || candidate.event === "workflow_dispatch")
    && candidate.conclusion === "success"
    && candidate.head_repository?.full_name === repository)
    .toSorted((left, right) => right.id - left.id)[0];
  return run === undefined ? null : buildRunOf({ runId: run.id, runAttempt: run.run_attempt });
}

function command(executable, arguments_) {
  return execFileSync(executable, arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function succeeds(executable, arguments_) {
  try {
    command(executable, arguments_);
    return true;
  } catch {
    return false;
  }
}

function api(path) {
  return JSON.parse(command("gh", ["api", "--paginate", "--slurp", path]));
}

function repositoryOf(environment) {
  if (environment.GITHUB_REPOSITORY) return environment.GITHUB_REPOSITORY;
  const origin = command("git", ["remote", "get-url", "origin"]);
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(origin);
  if (!match) throw new Error("the repository cannot be read from origin; set GITHUB_REPOSITORY");
  return match[1];
}

function workflowRunBuild(environment) {
  const run = JSON.parse(readFileSync(environment.GITHUB_EVENT_PATH, "utf8")).workflow_run ?? {};
  return { headSha: run.head_sha, build: { event: run.event, headBranch: run.head_branch,
    headRepository: run.head_repository?.full_name, conclusion: run.conclusion, runId: run.id,
    runAttempt: run.run_attempt } };
}

export function gatherFacts(options, environment = process.env) {
  const git = (...arguments_) => command("git", arguments_);
  const { event, commit } = options;
  const rehearsal = rehearsalFlag(options.rehearsal);
  const repository = repositoryOf(environment);
  if (!commitPattern.test(commit ?? "")) throw new Error("the candidate commit must be a full 40-character sha");
  if (!succeeds("git", ["cat-file", "-e", `${commit}^{commit}`])) throw new Error(`${commit} is not in this checkout`);
  const facts = { event, ref: options.ref ?? environment.GITHUB_REF, rehearsal, commit, repository,
    ...readCommitFacts(commit, git), onBranch: false, tagExists: false, pendingPullRequests: [], exactBuild: null };
  if (event === "workflow_run") {
    const { headSha, build } = workflowRunBuild(environment);
    if (headSha !== commit) throw new Error(`the finished build ran ${headSha}, not ${commit}`);
    facts.build = build;
  }
  if (event === "workflow_dispatch" || facts.manifest !== facts.parentManifest) {
    facts.missingTooling = releaseToolingPaths(releaseWorkflows.map((path) => readFileSync(new URL(`../${path}`,
      import.meta.url), "utf8"))).filter((path) => !succeeds("git", ["cat-file", "-e", `${commit}:${path}`]));
    if (versionPattern.test(facts.manifest ?? "") && releaseBranchOf(facts.manifest) !== "main") {
      git(...branchFetchArguments("main"));
      facts.releaseWorkflowDrift = tagRunDefinitions.filter((path) =>
        !succeeds("git", ["diff", "--quiet", remoteRefOf("main"), commit, "--", path]));
    }
  }
  const releasing = event === "workflow_dispatch" ? !rehearsal : facts.manifest !== facts.parentManifest;
  if (!releasing) return facts;
  const branch = releaseBranchOf(facts.manifest);
  git(...branchFetchArguments(branch));
  facts.onBranch = succeeds("git", ["merge-base", "--is-ancestor", commit, remoteRefOf(branch)]);
  facts.tagExists = command("git", ["ls-remote", "--tags", "origin", `refs/tags/v${facts.manifest}`]) !== "";
  const label = encodeURIComponent(pendingLabel);
  facts.pendingPullRequests = pendingReleasePullRequests(
    api(`repos/${repository}/issues?state=closed&labels=${label}&per_page=100`))
    .map(({ number }) => {
      const pull = JSON.parse(command("gh", ["api", `repos/${repository}/pulls/${number}`]));
      const merged = pull.merge_commit_sha;
      return releasePullRequestOf(pull, commitPattern.test(merged ?? "")
        && succeeds("git", ["merge-base", "--is-ancestor", merged, commit]), branch);
    })
    .filter((pullRequest) => pullRequest !== null);
  if (event === "workflow_dispatch") {
    facts.exactBuild = greenExactBuild(
      api(`repos/${repository}/actions/workflows/build.yml/runs?head_sha=${commit}&status=success&per_page=100`),
      repository, branch);
  }
  facts.newestLine = newestLineVerdict(facts.manifest, JSON.parse(command(process.execPath,
    [fileURLToPath(new URL("./published-release-tags.mjs", import.meta.url))])));
  const merged = facts.pendingPullRequests.find((pullRequest) => pullRequest.mergeCommitIsAncestor);
  if (branch !== "main" && merged !== undefined) {
    git(...branchFetchArguments("main"));
    const previous = JSON.parse(git("show", `${merged.mergeCommit}^1:.release-please-manifest.json`))["."];
    git("fetch", "--no-tags", "origin", `+refs/tags/v${previous}:refs/tags/v${previous}`);
    const config = JSON.parse(readFileSync(new URL("../release-please-config.json", import.meta.url), "utf8"));
    facts.forwardPort = forwardPortVerdict({ git, baseRef: `${merged.mergeCommit}^1`, headRef: commit,
      mainRef: remoteRefOf("main"), releasable: releasableTypes(config) });
  }
  return facts;
}

const optionNames = ["event", "commit", "rehearsal", "ref", "github-output"];

function optionsOf(arguments_) {
  const options = { plan: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const name = arguments_[index];
    if (name === "--plan") {
      options.plan = true;
      continue;
    }
    const key = name.slice(2);
    if (!name.startsWith("--") || !optionNames.includes(key) || arguments_[index + 1] === undefined) {
      throw new Error("usage: release-candidate-selection --event <event> --commit <sha> [--rehearsal <bool>] "
        + "[--ref <ref>] [--github-output <file> | --plan]");
    }
    options[key] = arguments_[index + 1];
    index += 1;
  }
  if (!options.plan && !options["github-output"]) throw new Error("--github-output or --plan is required");
  return options;
}

function write(selection, options, environment) {
  if (options.plan) {
    process.stdout.write(`${JSON.stringify(selection)}\n`);
    return;
  }
  const outputs = { release: selection.release, reason: selection.reason, commit: selection.commit,
    version: selection.version, tag: selection.tag, branch: selection.branch, rehearsal: selection.rehearsal,
    "pending-pull-request": selection.pendingPullRequest ?? "",
    "build-run-id": selection.build?.runId ?? "", "build-run-attempt": selection.build?.runAttempt ?? "" };
  appendFileSync(options["github-output"],
    Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(""));
  if (environment.GITHUB_STEP_SUMMARY) {
    appendFileSync(environment.GITHUB_STEP_SUMMARY, selection.release
      ? `Release candidate ${selection.tag} at ${selection.commit}${selection.rehearsal ? " (rehearsal)" : ""}\n`
      : `No release candidate for ${selection.commit}: ${selection.reason}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = optionsOf(process.argv.slice(2));
    write(selectReleaseCandidate(gatherFacts(options)), options, process.env);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
