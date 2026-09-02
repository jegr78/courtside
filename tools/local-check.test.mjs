import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  classifyProtectedChanges, collectLocalChanges, createVerificationWorktree, executeLocalCheck,
  localCheckPrerequisites, localVerificationPlans, planTasks, recoverVerificationWorktrees,
  registerVerificationSignalCleanup, renderLocalCheckPlan
} from "./local-check.mjs";
import { classifyChanges } from "./test-profile-classifier.mjs";

test("when loading the production runner, then no changed-worktree classifier executes eagerly", () => {
  // when
  const source = readFileSync(new URL("./local-check.mjs", import.meta.url), "utf8");

  // then
  assert.doesNotMatch(source, /from\s+["']\.\/test-profile-classifier\.mjs["']/);
});

test("given documentation changes, when planning the local check, then the bounded documentation check runs", () => {
  // given
  const changes = [{ status: "M", path: "docs/quality-strategy.md" }];

  // when
  const plan = localCheckPlan(changes);

  // then
  assert.deepEqual(plan.profiles, ["docs"]);
  assert.deepEqual(plan.tasks.map((task) => task.label), ["docs-check"]);
});

test("given backend changes, when planning the local check, then Java verification matches CI", () => {
  // given
  const changes = [{ status: "M", path: "src/main/java/org/courtside/CourtsideApplication.java" }];

  // when
  const plan = localCheckPlan(changes);

  // then
  assert.deepEqual(plan.profiles, ["backend"]);
  assert.deepEqual(plan.tasks, [{
    label: "backend",
    workingDirectory: "repository",
    executable: "maven",
    arguments: ["clean", "verify", "-Pjava-only"]
  }]);
});

test("given frontend changes, when planning the local check, then its tasks match the CI job", () => {
  // given
  const changes = [{ status: "M", path: "frontend/src/App.tsx" }];

  // when
  const plan = localCheckPlan(changes);

  // then
  assert.deepEqual(plan.profiles, ["frontend"]);
  assert.deepEqual(plan.tasks.map((task) => [task.label, task.executable, task.arguments]), [
    ["frontend-toolchain", "maven", [
      "com.github.eirslett:frontend-maven-plugin:install-node-and-npm",
      "com.github.eirslett:frontend-maven-plugin:npm@npm-ci"
    ]],
    ["frontend-lint", "npm", ["run", "lint"]],
    ["frontend-test", "npm", ["run", "test:frontend"]],
    ["frontend-build", "npm", ["run", "build"]],
    ["frontend-audit", "npm", ["audit", "--audit-level=high"]],
    ["frontend-package", "maven", ["package", "-DskipTests", "-Pjava-only"]],
    ["frontend-e2e", "npm", ["run", "test:e2e"]]
  ]);
});

test("given a tooling test changes, when planning locally, then only locked tooling verification runs", () => {
  // when
  const plan = localCheckPlan([{ status: "M", path: "tools/mail-check.test.mjs" }]);

  // then
  assert.deepEqual(plan.profiles, ["tooling"]);
  assert.deepEqual(plan.tasks.map((task) => task.label), ["frontend-toolchain", "tooling-test"]);
});

test("given reviewed GitHub metadata changes, when planning locally, then the declared validators run", () => {
  // when
  const template = localCheckPlan([{ status: "M", path: ".github/ISSUE_TEMPLATE/bug.md" }]);
  const dependabot = localCheckPlan([{ status: "M", path: ".github/dependabot.yml" }]);

  // then
  assert.deepEqual(template.profiles, ["docs"]);
  assert.deepEqual(template.tasks.map((task) => task.label), ["docs-check"]);
  assert.deepEqual(dependabot.profiles, ["tooling"]);
  assert.deepEqual(dependabot.tasks.map((task) => task.label), ["frontend-toolchain", "tooling-test"]);
});

test("given backend and frontend changes, when planning the local check, then both profiles run", () => {
  // given
  const changes = [
    { status: "M", path: "src/main/java/org/courtside/CourtsideApplication.java" },
    { status: "M", path: "frontend/src/App.tsx" }
  ];

  // when
  const plan = localCheckPlan(changes);

  // then
  assert.deepEqual(plan.profiles, ["backend", "frontend"]);
  assert.equal(plan.tasks[0].label, "backend");
  assert.equal(plan.tasks.at(-1).label, "frontend-e2e");
});

test("given added documentation, when planning the local check, then it uses the bounded docs task", () => {
  // when
  const added = localCheckPlan([{ status: "A", path: "docs/new.md" }]);

  // then
  assert.deepEqual(added.profiles, ["docs"]);
  assert.deepEqual(added.tasks.map((task) => task.label), ["docs-check"]);
});

test("given an added e2e specification, when planning locally, then the complete frontend path runs", () => {
  // when
  const plan = localCheckPlan([{ status: "A", path: "frontend/e2e/new-journey.spec.ts" }]);

  // then
  assert.deepEqual(plan.profiles, ["frontend"]);
  assert.deepEqual(plan.tasks.map((task) => task.label), [
    "frontend-toolchain", "frontend-lint", "frontend-test", "frontend-build", "frontend-audit",
    "frontend-package", "frontend-e2e"
  ]);
  assert.deepEqual(localCheckPlan([
    { status: "A", path: "frontend/e2e/global-setup.ts" }
  ]).profiles, ["full"]);
});

test("given destructive or unknown changes, when planning the local check, then it fails closed to full", () => {
  // when
  const deleted = localCheckPlan([{ status: "D", path: "docs/old.md" }]);
  const unknown = localCheckPlan([{ status: "M", path: "unclassified.txt" }]);

  // then
  assert.deepEqual(deleted.profiles, ["full"]);
  assert.deepEqual(unknown.profiles, ["full"]);
  assert.deepEqual(deleted.tasks.map((task) => task.label), ["full"]);
});

test("given a reduced change, when full is requested, then the local plan only escalates", () => {
  // given
  const changes = [{ status: "M", path: "docs/quality-strategy.md" }];

  // when
  const plan = localCheckPlan(changes, { forceFull: true });

  // then
  assert.deepEqual(plan.profiles, ["full"]);
  assert.equal(plan.reasons[0].code, "manual-full");
});

test("given committed changes, when collecting evidence, then the pinned commit diff is classified", () => {
  // given
  const calls = [];
  const git = (arguments_) => {
    calls.push(arguments_);
    if (arguments_[0] === "fetch") return "";
    if (arguments_[0] === "merge-base") return `${"a".repeat(40)}\n`;
    if (arguments_[0] === "rev-parse") return `${"b".repeat(40)}\n`;
    if (arguments_[0] === "status") return "";
    if (arguments_[0] === "diff" && arguments_.includes("--check")) return "";
    if (arguments_[0] === "diff" && arguments_.includes("--name-status")) {
      return "M\0src/main/java/org/courtside/CourtsideApplication.java\0";
    }
    if (arguments_[0] === "diff") return "tracked-content";
    throw new Error(`Unexpected git call: ${arguments_.join(" ")}`);
  };

  // when
  const evidence = collectLocalChanges(git);

  // then
  assert.equal(evidence.baseCommit, "a".repeat(40));
  assert.equal(evidence.headCommit, "b".repeat(40));
  assert.match(evidence.changeFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(evidence.changeEvidence,
    "M\0src/main/java/org/courtside/CourtsideApplication.java\0");
  assert.ok(calls.some((arguments_) => arguments_[0] === "diff" && arguments_.includes("--check")));
});

test("given an uncommitted working tree, when collecting evidence, then verification refuses an unstable source", () => {
  // given
  const git = (arguments_) => {
    if (arguments_[0] === "fetch") return "";
    if (arguments_[0] === "merge-base") return `${"a".repeat(40)}\n`;
    if (arguments_[0] === "rev-parse") return `${"b".repeat(40)}\n`;
    if (arguments_[0] === "status") return " M CLAUDE.md\0";
    throw new Error(`Unexpected git call: ${arguments_.join(" ")}`);
  };

  // when / then
  assert.throws(() => collectLocalChanges(git), /commit all changes/i);
});

test("given origin cannot be refreshed, when collecting evidence, then the caller receives a full fallback", () => {
  // given
  const git = (arguments_) => {
    if (arguments_[0] === "fetch") throw new Error("offline");
    if (arguments_[0] === "rev-parse") return `${"b".repeat(40)}\n`;
    if (arguments_[0] === "status") return "";
    if (arguments_[0] === "diff") return "";
    if (arguments_[0] === "ls-files") return "";
    throw new Error(`Unexpected git call: ${arguments_.join(" ")}`);
  };

  // when
  const evidence = collectLocalChanges(git);

  // then
  assert.equal(evidence.fallbackReason, "base-refresh-failed");
  assert.equal(evidence.baseCommit, null);
  assert.equal(evidence.changeEvidence, "");
  assert.match(evidence.changeFingerprint, /^[a-f0-9]{64}$/);
});

test("given a recorded head, when creating its verification worktree, then checkout and cleanup use that commit", () => {
  // given
  const calls = [];
  const git = (arguments_) => {
    calls.push(arguments_);
    return "";
  };

  // when
  const pinned = createVerificationWorktree({ headCommit: "b".repeat(40) }, git, "r".repeat(64));
  const path = pinned.path;
  pinned.release();

  // then
  assert.equal(pinned.path, path);
  assert.deepEqual(calls[0], ["worktree", "list", "--porcelain"]);
  assert.deepEqual(calls[1], ["worktree", "add", "--detach", path, "b".repeat(40)]);
  assert.deepEqual(calls[2], ["worktree", "remove", "--force", path]);
});

test("given registered and unregistered worktrees, when recovering, then only dead owned candidates are removed", () => {
  // given
  const stale = mkdtempSync(join(tmpdir(), "courtside-verification-"));
  const live = mkdtempSync(join(tmpdir(), "courtside-verification-"));
  const foreign = mkdtempSync(join(tmpdir(), "courtside-verification-"));
  const unregistered = mkdtempSync(join(tmpdir(), "courtside-verification-"));
  const wrongRepository = mkdtempSync(join(tmpdir(), "courtside-verification-"));
  const stalePath = realpathSync(stale);
  const livePath = realpathSync(live);
  const foreignPath = realpathSync(foreign);
  const unregisteredPath = realpathSync(unregistered);
  const wrongRepositoryPath = realpathSync(wrongRepository);
  const staleOwner = `${stalePath}.courtside-verification-owner.json`;
  const liveOwner = `${livePath}.courtside-verification-owner.json`;
  const unregisteredOwner = `${unregisteredPath}.courtside-verification-owner.json`;
  const wrongRepositoryOwner = `${wrongRepositoryPath}.courtside-verification-owner.json`;
  const repositoryId = "r".repeat(64);
  writeFileSync(staleOwner,
    `${JSON.stringify({ schemaVersion: 2, repositoryId, pid: 101 })}\n`);
  writeFileSync(liveOwner,
    `${JSON.stringify({ schemaVersion: 2, repositoryId, pid: 202 })}\n`);
  writeFileSync(unregisteredOwner,
    `${JSON.stringify({ schemaVersion: 2, repositoryId, pid: 303 })}\n`);
  writeFileSync(wrongRepositoryOwner,
    `${JSON.stringify({ schemaVersion: 2, repositoryId: "x".repeat(64), pid: 404 })}\n`);
  const calls = [];
  const git = (arguments_) => {
    calls.push(arguments_);
    if (arguments_[1] === "list") {
      return `worktree ${stalePath}\nHEAD a\n\nworktree ${livePath}\nHEAD b\n\nworktree ${foreignPath}\nHEAD c\n`;
    }
    return "";
  };

  try {
    // when
    recoverVerificationWorktrees(git, (pid) => pid === 202, repositoryId);

    // then
    assert.deepEqual(calls.filter((call) => call[1] === "remove"), [
      ["worktree", "remove", "--force", stalePath]
    ]);
    assert.equal(existsSync(stalePath), false);
    assert.equal(existsSync(staleOwner), false);
    assert.equal(existsSync(unregisteredPath), false);
    assert.equal(existsSync(unregisteredOwner), false);
    assert.doesNotThrow(() => readFileSync(liveOwner));
    assert.equal(existsSync(foreignPath), true);
    assert.equal(existsSync(wrongRepositoryPath), true);
    assert.equal(existsSync(wrongRepositoryOwner), true);
  } finally {
    rmSync(stale, { recursive: true, force: true });
    rmSync(live, { recursive: true, force: true });
    rmSync(foreign, { recursive: true, force: true });
    rmSync(unregistered, { recursive: true, force: true });
    rmSync(wrongRepository, { recursive: true, force: true });
    rmSync(staleOwner, { force: true });
    rmSync(liveOwner, { force: true });
    rmSync(unregisteredOwner, { force: true });
    rmSync(wrongRepositoryOwner, { force: true });
  }
});

test("given a verification signal, when handling it, then cleanup is idempotent and the signal is preserved", () => {
  // given
  const process_ = new EventEmitter();
  process_.pid = 303;
  const signals = [];
  process_.kill = (pid, signal) => signals.push([pid, signal]);
  let releases = 0;
  const unregister = registerVerificationSignalCleanup(() => releases++, process_);

  // when
  process_.emit("SIGINT");
  process_.emit("SIGINT");
  unregister();

  // then
  assert.equal(releases, 1);
  assert.deepEqual(signals, [[303, "SIGINT"]]);
  assert.equal(process_.listenerCount("SIGINT"), 0);
  assert.equal(process_.listenerCount("SIGTERM"), 0);
});

test("given supported platforms, when resolving tasks, then commands remain shell-free or fixed", () => {
  // given
  const tasks = localCheckPlan([{ status: "M", path: "frontend/src/App.tsx" }]).tasks;

  // when
  const posix = localVerificationPlans(tasks, "linux", "/repo");
  const windows = localVerificationPlans(tasks, "win32", "C:/repo");

  // then
  assert.equal(posix[0].command, "/repo/mvnw");
  assert.equal(posix[1].command, "/repo/frontend/node/node");
  assert.equal(posix[1].shell, false);
  assert.equal(windows[0].command, "cmd.exe");
  assert.match(windows[0].arguments.at(-1), /^mvnw\.cmd /);
  assert.equal(windows[1].command, "C:/repo/frontend/node/node.exe");
  assert.equal(windows[1].shell, false);

  const docs = localVerificationPlans(localCheckPlan([
    { status: "M", path: "docs/quality-strategy.md" }
  ]).tasks, "win32", "C:/repo");
  assert.equal(docs[0].command, "C:/repo/frontend/node/node.exe");
  assert.deepEqual(docs[0].arguments, ["tools/docs-check.mjs", "--check"]);
});

test("given selected tasks, when checking prerequisites, then docs avoid Java and Docker", () => {
  // when / then
  assert.deepEqual(localCheckPrerequisites(["docs-check"]), { java: false, docker: false });
  assert.deepEqual(localCheckPrerequisites(["frontend-toolchain", "tooling-test"]),
    { java: true, docker: false });
  assert.deepEqual(localCheckPrerequisites(["backend"]), { java: true, docker: true });
  assert.deepEqual(localCheckPrerequisites(["frontend-e2e"]), { java: true, docker: true });
  assert.deepEqual(localCheckPrerequisites(["full"]), { java: true, docker: true });
});

test("given a plan-only check, when executing it, then prerequisites and tasks do not run", async () => {
  // given
  const events = [];
  const git = gitFor([{ status: "M", path: "src/main/java/org/courtside/CourtsideApplication.java" }]);

  // when
  const record = await executeLocalCheck({ planOnly: true, forceFull: false }, {
    git,
    classify: async () => backendPlan(),
    output: { write: () => {} },
    beforeRun: () => events.push("before"),
    execute: () => events.push("execute"),
    writeResult: (candidate) => events.push(candidate.outcome)
  });

  // then
  assert.equal(record.outcome, "planned");
  assert.deepEqual(events, ["planned"]);
});

test("given a selected check, when every task passes, then the retained result is passed", async () => {
  // given
  const events = [];
  const records = [];
  const git = gitFor([{ status: "M", path: "src/main/java/org/courtside/CourtsideApplication.java" }]);

  // when
  const record = await executeLocalCheck({ planOnly: false, forceFull: false }, {
    git,
    classify: async () => backendPlan(),
    output: { write: () => {} },
    beforeRun: () => events.push("before"),
    createWorktree: () => ({ path: "/pinned", release: () => events.push("release") }),
    execute: (plan) => {
      assert.equal(plan.workingDirectory, "/pinned");
      events.push(plan.label);
    },
    writeResult: (candidate) => records.push(structuredClone(candidate))
  });

  // then
  assert.equal(record.outcome, "passed");
  assert.deepEqual(events, ["before", "backend", "release"]);
  assert.deepEqual(records.map((candidate) => candidate.outcome), ["running", "passed"]);
});

test("given a failing selected task, when executing it, then the retained result fails closed", async () => {
  // given
  const records = [];
  const git = gitFor([{ status: "M", path: "src/main/java/org/courtside/CourtsideApplication.java" }]);

  // when / then
  await assert.rejects(() => executeLocalCheck({ planOnly: false, forceFull: false }, {
    git,
    classify: async () => backendPlan(),
    output: { write: () => {} },
    createWorktree: () => ({ path: "/pinned", release: () => records.push({ outcome: "released" }) }),
    execute: () => { throw new Error("backend failed"); },
    writeResult: (candidate) => records.push(structuredClone(candidate))
  }), /backend failed/);
  assert.deepEqual(records.map((candidate) => candidate.outcome), ["running", "released", "failed"]);
  assert.equal(records.at(-1).failure, "backend failed");
});

test("given a protected base, when classifying, then its classifier runs from an isolated worktree", async () => {
  // given
  const calls = [];
  const evidence = {
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    fallbackReason: null,
    changeEvidence: "M\0docs/quality-strategy.md\0",
    changeFingerprint: "c".repeat(64)
  };
  const git = (arguments_) => calls.push(arguments_);
  const loadClassifier = async (url) => {
    calls.push(["load", url]);
    if (url.includes("local-check.mjs")) {
      return { planTasks: (classified) => ({ ...classified, tasks: [] }) };
    }
    return {
      parseNameStatus: (value) => {
        calls.push(["parse", value]);
        return [{ status: "M", path: "docs/quality-strategy.md" }];
      },
      classifyChanges: (changes, labels) => localCheckPlan(changes, { forceFull: labels.includes("ci:full") })
    };
  };

  // when
  const plan = await classifyProtectedChanges(evidence, true, git, loadClassifier);

  // then
  assert.deepEqual(plan.profiles, ["full"]);
  assert.deepEqual(calls[0].slice(0, 3), ["worktree", "add", "--detach"]);
  assert.equal(calls[0][4], "a".repeat(40));
  assert.equal(calls[1][0], "load");
  assert.match(calls[1][1], /tools\/test-profile-classifier\.mjs\?base=a{40}$/);
  assert.deepEqual(calls[2], ["parse", evidence.changeEvidence]);
  assert.equal(calls[3][0], "load");
  assert.match(calls[3][1], /tools\/local-check\.mjs\?base=a{40}$/);
  assert.deepEqual(calls[4].slice(0, 3), ["worktree", "remove", "--force"]);
});

test("given a planned local check, when rendering it, then the profiles tasks and evidence are all named", () => {
  // given
  const planned = {
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    fallbackReason: null,
    profiles: ["docs", "tooling"],
    tasks: ["docs-check", "tooling-test"]
  };
  const fallback = { ...planned, fallbackReason: "base-refresh-failed", profiles: ["full"], tasks: [] };

  // when
  const rendered = renderLocalCheckPlan(planned);
  const renderedFallback = renderLocalCheckPlan(fallback);

  // then
  assert.match(rendered, /^Local profiles: docs \+ tooling$/m);
  assert.match(rendered, /^Change evidence: a{40}\.\.b{40}$/m);
  assert.match(rendered, /^Tasks: docs-check, tooling-test$/m);
  assert.match(rendered, /^Result: .*build\/local-check\/result\.json$/m);
  assert.match(renderedFallback, /^Change evidence: full fallback: base-refresh-failed$/m);
  assert.match(renderedFallback, /^Tasks: diff-check only$/m);
});

test("given a protected base classifier, when classifying locally, then its answer decides the run", async () => {
  // given
  const evidence = {
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    fallbackReason: null,
    changeEvidence: "M\0docs/quality-strategy.md\0",
    changeFingerprint: "c".repeat(64)
  };
  const git = () => {};
  const loadClassifier = async (url) => url.includes("local-check.mjs")
    ? await import("./local-check.mjs")
    : {
      parseNameStatus: () => [{ status: "M", path: "docs/quality-strategy.md" }],
      classifyChanges: () => ({ schemaVersion: 1, profiles: ["tooling"], isFull: false, reasons: [] })
    };

  // when
  const plan = await classifyProtectedChanges(evidence, false, git, loadClassifier);

  // then
  assert.deepEqual(plan.profiles, ["tooling"]);
  assert.deepEqual(plan.tasks.map((task) => task.label), ["frontend-toolchain", "tooling-test"]);
});

test("given protected classification fails, when planning locally, then candidate full tasks cannot weaken fallback", async () => {
  // given
  const git = gitFor([{ status: "M", path: "docs/quality-strategy.md" }]);

  // when
  const record = await executeLocalCheck({ planOnly: true, forceFull: false }, {
    git,
    classify: async () => { throw new Error("protected classifier unavailable"); },
    output: { write: () => {} },
    writeResult: () => {}
  });

  // then
  assert.deepEqual(record.profiles, ["full"]);
  assert.deepEqual(record.tasks, ["full"]);
  const execution = localVerificationPlans([{
    label: "full", workingDirectory: "repository", executable: "maven",
    arguments: ["clean", "verify"]
  }], "linux", "/repo");
  assert.deepEqual(execution[0].arguments, ["clean", "verify"]);
});

test("given the live tree changes after pinning, when finishing, then the verified commit remains valid", async () => {
  // given
  const records = [];
  const events = [];
  const git = gitFor([{ status: "M", path: "src/main/java/org/courtside/CourtsideApplication.java" }]);

  // when
  const record = await executeLocalCheck({ planOnly: false, forceFull: false }, {
    git,
    classify: async () => localCheckPlan([
      { status: "M", path: "src/main/java/org/courtside/CourtsideApplication.java" }
    ]),
    output: { write: () => {} },
    createWorktree: () => ({ path: "/pinned", release: () => events.push("release") }),
    execute: () => events.push("execute"),
    writeResult: (candidate) => records.push(structuredClone(candidate))
  });

  // then
  assert.equal(record.outcome, "passed");
  assert.deepEqual(events, ["execute", "release"]);
  assert.deepEqual(records.map((candidate) => candidate.outcome), ["running", "passed"]);
});

function gitFor(changes, fingerprint = () => "c".repeat(64)) {
  return (arguments_) => {
    if (arguments_[0] === "fetch") return "";
    if (arguments_[0] === "merge-base") return `${"a".repeat(40)}\n`;
    if (arguments_[0] === "rev-parse") return `${"b".repeat(40)}\n`;
    if (arguments_[0] === "status") return "";
    if (arguments_[0] === "diff" && arguments_.includes("--check")) return "";
    if (arguments_[0] === "diff" && arguments_.includes("--name-status")) {
      return `${changes.flatMap((change) => [change.status, change.path]).join("\0")}\0`;
    }
    if (arguments_[0] === "diff") return fingerprint();
    if (arguments_[0] === "ls-files") return "";
    throw new Error(`Unexpected git call: ${arguments_.join(" ")}`);
  };
}

function backendPlan() {
  return localCheckPlan([
    { status: "M", path: "src/main/java/org/courtside/CourtsideApplication.java" }
  ]);
}

function localCheckPlan(changes, { forceFull = false } = {}) {
  return planTasks(classifyChanges(changes, forceFull ? ["ci:full"] : []));
}
