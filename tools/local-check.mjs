import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyChanges, parseNameStatus } from "./test-profile-classifier.mjs";

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

export function localCheckPlan(changes, { forceFull = false } = {}) {
  const classified = classifyChanges(changes, forceFull ? ["ci:full"] : []);
  return planTasks(classified);
}

function planTasks(classified) {
  const tasks = classified.profiles.includes("full")
    ? [fullTask]
    : [
        ...(classified.profiles.includes("backend") ? [backendTask] : []),
        ...(classified.profiles.includes("frontend") ? frontendTasks : [])
      ];
  return { ...classified, tasks: structuredClone(tasks) };
}

export function collectLocalChanges(git = runGit) {
  try {
    git(["fetch", "--quiet", "--no-tags", "origin", "main"]);
  } catch {
    return {
      baseCommit: null,
      headCommit: null,
      fallbackReason: "base-refresh-failed",
      changes: [{ status: "M", path: "tools/local-check-fallback" }]
    };
  }
  const baseCommit = git(["merge-base", "origin/main", "HEAD"]).trim();
  const headCommit = git(["rev-parse", "HEAD"]).trim();
  if (!/^[a-f0-9]{40}$/.test(baseCommit) || !/^[a-f0-9]{40}$/.test(headCommit)) {
    throw new Error("Git did not return trustworthy commit identities");
  }
  git(["diff", "--check", baseCommit, "--"]);
  const trackedEvidence = git(["diff", "--name-status", "-z", "--find-renames", baseCommit, "--"]);
  const untrackedEvidence = git(["ls-files", "--others", "--exclude-standard", "-z"]);
  const changes = [
    ...(trackedEvidence.length === 0 ? [] : parseNameStatus(trackedEvidence)),
    ...untrackedEvidence.split("\0").filter(Boolean).map((path) => ({ status: "A", path }))
  ];
  if (changes.length === 0) throw new Error("No local changes exist relative to origin/main");
  return { baseCommit, headCommit, fallbackReason: null, changes };
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
    for (const processPlan of localVerificationPlans(plan.tasks, runtime.platform, runtime.root)) {
      output.write(`Running local check: ${processPlan.label}\n`);
      execute(processPlan);
    }
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
    return protectedClassifier.classifyChanges(evidence.changes, forceFull ? ["ci:full"] : []);
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
