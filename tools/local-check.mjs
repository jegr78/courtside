import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultFile = join(repository, "build", "local-check", "result.json");

const backendTask = {
  label: "backend",
  workingDirectory: "repository",
  executable: "maven",
  arguments: ["clean", "verify", "-Pjava-only"]
};

const frontendTasks = [
  {
    label: "frontend-toolchain",
    workingDirectory: "repository",
    executable: "maven",
    arguments: [
      "com.github.eirslett:frontend-maven-plugin:install-node-and-npm",
      "com.github.eirslett:frontend-maven-plugin:npm@npm-ci"
    ]
  },
  { label: "frontend-lint", workingDirectory: "frontend", executable: "npm", arguments: ["run", "lint"] },
  { label: "frontend-test", workingDirectory: "frontend", executable: "npm", arguments: ["run", "test"] },
  { label: "frontend-build", workingDirectory: "frontend", executable: "npm", arguments: ["run", "build"] },
  {
    label: "frontend-audit",
    workingDirectory: "frontend",
    executable: "npm",
    arguments: ["audit", "--audit-level=high"]
  },
  {
    label: "frontend-package",
    workingDirectory: "repository",
    executable: "maven",
    arguments: ["package", "-DskipTests", "-Pjava-only"]
  },
  { label: "frontend-e2e", workingDirectory: "frontend", executable: "npm", arguments: ["run", "test:e2e"] }
];

const fullTask = {
  label: "full",
  workingDirectory: "repository",
  executable: "maven",
  arguments: ["clean", "verify"]
};

export function planTasks(classified) {
  const tasks = classified.profiles.includes("full")
    ? [fullTask]
    : [
        ...(classified.profiles.includes("backend") ? [backendTask] : []),
        ...(classified.profiles.includes("frontend") ? frontendTasks : [])
      ];
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
  const comparison = baseCommit ?? "HEAD";
  git(["diff", "--check", comparison, "--"]);
  const trackedEvidence = git(["diff", "--name-status", "-z", "--find-renames", comparison, "--"]);
  const untrackedEvidence = git(["ls-files", "--others", "--exclude-standard", "-z"]);
  const untrackedPaths = untrackedEvidence.split("\0").filter(Boolean);
  const changeEvidence = `${trackedEvidence}${untrackedPaths.map((path) => `A\0${path}\0`).join("")}`;
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
    .update(git(["diff", "--binary", "--full-index", comparison, "--"]));
  for (const path of untrackedPaths) {
    fingerprint.update("\0").update(path).update("\0")
      .update(git(["hash-object", "--no-filters", "--", path]).trim());
  }
  return {
    baseCommit,
    headCommit,
    fallbackReason,
    changeEvidence,
    changeFingerprint: fingerprint.digest("hex")
  };
}

export function localVerificationPlans(tasks, platform = process.platform, root = repository) {
  const frontend = join(root, "frontend");
  const npmCli = join(frontend, "node", "node_modules", "npm", "bin", "npm-cli.js");
  const node = join(frontend, "node", platform === "win32" ? "node.exe" : "node");
  return tasks.map((task) => {
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
    requireUnchangedEvidence(evidence, collectLocalState(runtime.git ?? runGit,
      evidence.baseCommit, evidence.fallbackReason));
    runtime.beforeRun?.(record);
    for (const processPlan of localVerificationPlans(plan.tasks, runtime.platform, runtime.root)) {
      output.write(`Running local check: ${processPlan.label}\n`);
      execute(processPlan);
    }
    requireUnchangedEvidence(evidence, collectLocalState(runtime.git ?? runGit,
      evidence.baseCommit, evidence.fallbackReason));
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
    return protectedClassifier.classifyChanges(changes, forceFull ? ["ci:full"] : []);
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

function requireUnchangedEvidence(expected, actual) {
  if (expected.baseCommit !== actual.baseCommit || expected.headCommit !== actual.headCommit
      || expected.changeFingerprint !== actual.changeFingerprint) {
    throw new Error("The working tree changed during local verification; run the check again");
  }
}

function fullClassification(reason) {
  return {
    schemaVersion: 1,
    profiles: ["full"],
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
