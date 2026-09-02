import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadProfileContract, localTasksForProfiles } from "./test-profile-contract.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultFile = join(repository, "build", "local-check", "result.json");
const verificationOwnerFile = ".courtside-verification-owner.json";
const protectedFullTask = {
  label: "full",
  workingDirectory: "repository",
  executable: "maven",
  arguments: ["clean", "verify"]
};

export function planTasks(classified) {
  const tasks = classified.localTasks
    ?? classified.tasks
    ?? (classified.profiles.includes("full") ? [protectedFullTask]
      : localTasksForProfiles(loadProfileContract(), classified.profiles));
  return { ...classified, tasks: structuredClone(tasks) };
}

export function collectLocalChanges(git = runGit) {
  let baseCommit;
  let fallbackReason = null;
  try {
    git(["fetch", "--quiet", "--no-tags", "origin", "main"]);
    baseCommit = git(["merge-base", "origin/main", "HEAD"]).trim();
  } catch {
    baseCommit = null;
    fallbackReason = "base-refresh-failed";
  }
  return collectLocalState(git, baseCommit, fallbackReason);
}

function collectLocalState(git, baseCommit, fallbackReason) {
  const headCommit = git(["rev-parse", "HEAD"]).trim();
  if ((baseCommit !== null && !/^[a-f0-9]{40}$/.test(baseCommit))
      || !/^[a-f0-9]{40}$/.test(headCommit)) {
    throw new Error("Git did not return trustworthy commit identities");
  }
  if (git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).length > 0) {
    throw new Error("Commit all changes before running the final local verification");
  }
  const comparison = baseCommit ?? "HEAD";
  git(["diff", "--check", comparison, headCommit, "--"]);
  const changeEvidence = git(["diff", "--name-status", "-z", "--find-renames",
    comparison, headCommit, "--"]);
  if (changeEvidence.length === 0 && fallbackReason === null) {
    throw new Error("No local changes exist relative to origin/main");
  }
  const fingerprint = createHash("sha256")
    .update(baseCommit ?? "")
    .update("\0")
    .update(headCommit)
    .update("\0")
    .update(changeEvidence)
    .update("\0")
    .update(git(["diff", "--binary", "--full-index", comparison, headCommit, "--"]));
  return {
    baseCommit,
    headCommit,
    fallbackReason,
    changeEvidence,
    changeFingerprint: fingerprint.digest("hex")
  };
}

export function localVerificationPlans(tasks, platform = process.platform, root = repository,
    hostNode = null) {
  const frontend = join(root, "frontend");
  const npmCli = join(frontend, "node", "node_modules", "npm", "bin", "npm-cli.js");
  const node = join(frontend, "node", platform === "win32" ? "node.exe" : "node");
  return tasks.map((task) => {
    if (task.executable === "node") {
      return {
        label: task.label,
        command: hostNode ?? node,
        arguments: task.arguments,
        workingDirectory: root,
        shell: false
      };
    }
    if (task.executable === "npm") {
      return {
        label: task.label,
        command: node,
        arguments: [npmCli, ...task.arguments],
        workingDirectory: frontend,
        shell: false
      };
    }
    if (platform === "win32") {
      return {
        label: task.label,
        command: "cmd.exe",
        arguments: ["/d", "/s", "/c", ["mvnw.cmd", ...task.arguments].join(" ")],
        workingDirectory: root,
        shell: false
      };
    }
    return {
      label: task.label,
      command: join(root, "mvnw"),
      arguments: task.arguments,
      workingDirectory: root,
      shell: false
    };
  });
}

export function localCheckPrerequisites(tasks) {
  const java = tasks.some((task) => task !== "docs-check");
  const docker = tasks.some((task) => ["backend", "frontend-e2e", "full"].includes(task));
  return { java, docker };
}

export async function executeLocalCheck(options, runtime = {}) {
  const evidence = collectLocalChanges(runtime.git ?? runGit);
  let classified;
  try {
    const classify = runtime.classify ?? classifyProtectedChanges;
    classified = await classify(evidence, options.forceFull, runtime.git ?? runGit);
  } catch {
    evidence.fallbackReason ??= "protected-classifier-failed";
    classified = fullClassification(evidence.fallbackReason);
  }
  const plan = planTasks(classified);
  const persist = runtime.writeResult ?? writeResult;
  const record = {
    schemaVersion: 1,
    baseCommit: evidence.baseCommit,
    headCommit: evidence.headCommit,
    fallbackReason: evidence.fallbackReason,
    changeFingerprint: evidence.changeFingerprint,
    profiles: plan.profiles,
    reasons: plan.reasons,
    tasks: plan.tasks.map((task) => task.label),
    outcome: options.planOnly ? "planned" : "running"
  };
  persist(record);
  const output = runtime.output ?? process.stdout;
  output.write(`${renderLocalCheckPlan(record)}\n`);
  if (options.planOnly) return record;
  const execute = runtime.execute ?? runProcess;
  try {
    runtime.beforeRun?.(record);
    const createWorktree = runtime.createWorktree ?? ((candidate) =>
      createVerificationWorktree(candidate, runtime.git ?? runGit));
    const pinned = createWorktree(evidence);
    const unregisterSignalCleanup = (runtime.registerSignalCleanup
      ?? registerVerificationSignalCleanup)(pinned.release);
    let taskFailure;
    try {
      for (const processPlan of localVerificationPlans(plan.tasks, runtime.platform, pinned.path,
        runtime.hostNode ?? process.execPath)) {
        output.write(`Running local check: ${processPlan.label}\n`);
        execute(processPlan);
      }
    } catch (failure) {
      taskFailure = failure;
    }
    try {
      pinned.release();
    } catch (cleanupFailure) {
      if (taskFailure !== undefined) {
        throw new AggregateError([taskFailure, cleanupFailure],
          `${taskFailure.message}; verification worktree cleanup failed: ${cleanupFailure.message}`);
      }
      throw cleanupFailure;
    } finally {
      unregisterSignalCleanup();
    }
    if (taskFailure !== undefined) throw taskFailure;
    record.outcome = "passed";
    persist(record);
    return record;
  } catch (failure) {
    record.outcome = "failed";
    record.failure = failure.message;
    persist(record);
    throw failure;
  }
}

export function createVerificationWorktree(evidence, git = runGit,
    repositoryId = verificationRepositoryId(git)) {
  recoverVerificationWorktrees(git, processIsAlive, repositoryId);
  const worktree = mkdtempSync(join(tmpdir(), "courtside-verification-"));
  const ownerFile = `${realpathSync(worktree)}${verificationOwnerFile}`;
  let attached = false;
  let released = false;
  try {
    writeFileSync(ownerFile, `${JSON.stringify({ schemaVersion: 2, repositoryId, pid: process.pid })}\n`,
      { mode: 0o600 });
    git(["worktree", "add", "--detach", worktree, evidence.headCommit]);
    attached = true;
  } catch (failure) {
    let retained = false;
    if (attached) {
      try {
        git(["worktree", "remove", "--force", worktree]);
      } catch {
        retained = true;
      }
    }
    if (!retained) {
      rmSync(worktree, { recursive: true, force: true });
      rmSync(ownerFile, { force: true });
    }
    throw failure;
  }
  return {
    path: worktree,
    release: () => {
      if (released) return;
      released = true;
      let cleanupFailure;
      try {
        if (attached) git(["worktree", "remove", "--force", worktree]);
      } catch (failure) {
        cleanupFailure = failure;
      } finally {
        if (cleanupFailure === undefined) {
          rmSync(worktree, { recursive: true, force: true });
          rmSync(ownerFile, { force: true });
        }
      }
      if (cleanupFailure !== undefined) throw cleanupFailure;
    }
  };
}

export function recoverVerificationWorktrees(git = runGit, isProcessAlive = processIsAlive,
    repositoryId = verificationRepositoryId(git)) {
  const temporaryRoot = realpathSync(tmpdir());
  const listing = git(["worktree", "list", "--porcelain"]);
  const registered = new Set(String(listing ?? "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length))));
  const ownerFiles = readdirSync(temporaryRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile()
      && entry.name.startsWith("courtside-verification-")
      && entry.name.endsWith(verificationOwnerFile));
  for (const ownerEntry of ownerFiles) {
    const ownerPath = join(temporaryRoot, ownerEntry.name);
    const candidatePath = ownerPath.slice(0, -verificationOwnerFile.length);
    if (dirname(candidatePath) !== temporaryRoot
        || !/^courtside-verification-[A-Za-z0-9_-]+$/.test(ownerEntry.name
          .slice(0, -verificationOwnerFile.length))) continue;
    let owner;
    try {
      owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    } catch {
      continue;
    }
    if (owner.schemaVersion !== 2 || owner.repositoryId !== repositoryId
        || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || isProcessAlive(owner.pid)) continue;
    let candidateExists = false;
    try {
      const candidate = lstatSync(candidatePath);
      if (!candidate.isDirectory() || candidate.isSymbolicLink()) continue;
      candidateExists = true;
    } catch {
      candidateExists = false;
    }
    if (registered.has(candidatePath)) git(["worktree", "remove", "--force", candidatePath]);
    if (candidateExists) rmSync(candidatePath, { recursive: true, force: true });
    rmSync(ownerPath, { force: true });
  }
}

function verificationRepositoryId(git) {
  const commonDirectory = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  if (commonDirectory.length === 0) throw new Error("Git did not identify its common directory");
  return createHash("sha256").update(realpathSync(commonDirectory)).digest("hex");
}

export function registerVerificationSignalCleanup(release, process_ = process) {
  let handling = false;
  const handlers = new Map();
  const unregister = () => {
    for (const [signal, handler] of handlers) process_.removeListener(signal, handler);
    handlers.clear();
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (handling) return;
      handling = true;
      try {
        release();
      } finally {
        unregister();
        process_.kill(process_.pid, signal);
      }
    };
    handlers.set(signal, handler);
    process_.once(signal, handler);
  }
  return unregister;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (failure) {
    return failure.code === "EPERM";
  }
}

export async function classifyProtectedChanges(evidence, forceFull, git = runGit,
    loadClassifier = (url) => import(url)) {
  if (evidence.baseCommit === null) {
    return fullClassification(evidence.fallbackReason ?? "missing-base-commit");
  }
  const worktree = mkdtempSync(join(tmpdir(), "courtside-local-check-"));
  let attached = false;
  try {
    git(["worktree", "add", "--detach", worktree, evidence.baseCommit]);
    attached = true;
    const classifierUrl = pathToFileURL(join(worktree, "tools", "test-profile-classifier.mjs"));
    const protectedClassifier = await loadClassifier(`${classifierUrl.href}?base=${evidence.baseCommit}`);
    const changes = protectedClassifier.parseNameStatus(evidence.changeEvidence);
    const classified = protectedClassifier.classifyChanges(changes, forceFull ? ["ci:full"] : []);
    const protectedLocalCheckUrl = pathToFileURL(join(worktree, "tools", "local-check.mjs"));
    const protectedLocalCheck = await loadClassifier(
      `${protectedLocalCheckUrl.href}?base=${evidence.baseCommit}`);
    return protectedLocalCheck.planTasks(classified);
  } finally {
    let cleanupFailure;
    try {
      if (attached) git(["worktree", "remove", "--force", worktree]);
    } catch (failure) {
      cleanupFailure = failure;
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
    if (cleanupFailure) throw cleanupFailure;
  }
}

function fullClassification(reason) {
  return {
    schemaVersion: 1,
    profiles: ["full"],
    localTasks: [structuredClone(protectedFullTask)],
    isFull: true,
    reasons: [{ code: reason, path: null, profile: "full", status: null }]
  };
}

export function renderLocalCheckPlan(record) {
  const source = record.fallbackReason === null
    ? `${record.baseCommit}..${record.headCommit}`
    : `full fallback: ${record.fallbackReason}`;
  return [
    `Local profiles: ${record.profiles.join(" + ")}`,
    `Change evidence: ${source}`,
    `Tasks: ${record.tasks.length === 0 ? "diff-check only" : record.tasks.join(", ")}`,
    `Result: ${resultFile}`
  ].join("\n");
}

function runGit(arguments_) {
  return execFileSync("git", arguments_, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: false
  });
}

function runProcess(plan) {
  execFileSync(plan.command, plan.arguments, {
    cwd: plan.workingDirectory,
    env: process.env,
    shell: false,
    stdio: "inherit"
  });
}

function writeResult(record) {
  mkdirSync(dirname(resultFile), { recursive: true });
  writeFileSync(resultFile, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}
