import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyProtectedChanges, collectLocalChanges, executeLocalCheck, localCheckPlan, localVerificationPlans
} from "./local-check.mjs";

test("given documentation changes, when planning the local check, then no code suite is required", () => {
  // given
  const changes = [{ status: "M", path: "docs/quality-strategy.md" }];

  // when
  const plan = localCheckPlan(changes);

  // then
  assert.deepEqual(plan.profiles, ["docs"]);
  assert.deepEqual(plan.tasks, []);
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
    ["frontend-test", "npm", ["run", "test"]],
    ["frontend-build", "npm", ["run", "build"]],
    ["frontend-audit", "npm", ["audit", "--audit-level=high"]],
    ["frontend-package", "maven", ["package", "-DskipTests", "-Pjava-only"]],
    ["frontend-e2e", "npm", ["run", "test:e2e"]]
  ]);
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

test("given structural or unknown changes, when planning the local check, then it fails closed to full", () => {
  // when
  const added = localCheckPlan([{ status: "A", path: "docs/new.md" }]);
  const unknown = localCheckPlan([{ status: "M", path: "unclassified.txt" }]);

  // then
  assert.deepEqual(added.profiles, ["full"]);
  assert.deepEqual(unknown.profiles, ["full"]);
  assert.deepEqual(added.tasks, [{
    label: "full",
    workingDirectory: "repository",
    executable: "maven",
    arguments: ["clean", "verify"]
  }]);
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

test("given committed dirty and untracked changes, when collecting evidence, then every path is classified", () => {
  // given
  const calls = [];
  const git = (arguments_) => {
    calls.push(arguments_);
    if (arguments_[0] === "fetch") return "";
    if (arguments_[0] === "merge-base") return `${"a".repeat(40)}\n`;
    if (arguments_[0] === "rev-parse") return `${"b".repeat(40)}\n`;
    if (arguments_[0] === "diff" && arguments_.includes("--check")) return "";
    if (arguments_[0] === "diff") return "M\0src/main/java/org/courtside/CourtsideApplication.java\0";
    if (arguments_[0] === "ls-files") return "docs/new.md\0";
    throw new Error(`Unexpected git call: ${arguments_.join(" ")}`);
  };

  // when
  const evidence = collectLocalChanges(git);

  // then
  assert.equal(evidence.baseCommit, "a".repeat(40));
  assert.equal(evidence.headCommit, "b".repeat(40));
  assert.deepEqual(evidence.changes, [
    { status: "M", path: "src/main/java/org/courtside/CourtsideApplication.java" },
    { status: "A", path: "docs/new.md" }
  ]);
  assert.ok(calls.some((arguments_) => arguments_[0] === "diff" && arguments_.includes("--check")));
});

test("given origin cannot be refreshed, when collecting evidence, then the caller receives a full fallback", () => {
  // given
  const git = (arguments_) => {
    if (arguments_[0] === "fetch") throw new Error("offline");
    throw new Error("no other Git call is trusted after refresh failed");
  };

  // when
  const evidence = collectLocalChanges(git);

  // then
  assert.equal(evidence.fallbackReason, "base-refresh-failed");
  assert.deepEqual(evidence.changes, [{ status: "M", path: "tools/local-check-fallback" }]);
  assert.deepEqual(localCheckPlan(evidence.changes).profiles, ["full"]);
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
});

test("given a plan-only check, when executing it, then prerequisites and tasks do not run", async () => {
  // given
  const events = [];
  const git = gitFor([{ status: "M", path: "src/main/java/org/courtside/CourtsideApplication.java" }]);

  // when
  const record = await executeLocalCheck({ planOnly: true, forceFull: false }, {
    git,
    classify: async (evidence) => localCheckPlan(evidence.changes),
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
    classify: async (evidence) => localCheckPlan(evidence.changes),
    output: { write: () => {} },
    beforeRun: () => events.push("before"),
    execute: (plan) => events.push(plan.label),
    writeResult: (candidate) => records.push(structuredClone(candidate))
  });

  // then
  assert.equal(record.outcome, "passed");
  assert.deepEqual(events, ["before", "backend"]);
  assert.deepEqual(records.map((candidate) => candidate.outcome), ["running", "passed"]);
});

test("given a failing selected task, when executing it, then the retained result fails closed", async () => {
  // given
  const records = [];
  const git = gitFor([{ status: "M", path: "src/main/java/org/courtside/CourtsideApplication.java" }]);

  // when / then
  await assert.rejects(() => executeLocalCheck({ planOnly: false, forceFull: false }, {
    git,
    classify: async (evidence) => localCheckPlan(evidence.changes),
    output: { write: () => {} },
    execute: () => { throw new Error("backend failed"); },
    writeResult: (candidate) => records.push(structuredClone(candidate))
  }), /backend failed/);
  assert.deepEqual(records.map((candidate) => candidate.outcome), ["running", "failed"]);
  assert.equal(records.at(-1).failure, "backend failed");
});

test("given a protected base, when classifying, then its classifier runs from an isolated worktree", async () => {
  // given
  const calls = [];
  const evidence = {
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    fallbackReason: null,
    changes: [{ status: "M", path: "docs/quality-strategy.md" }]
  };
  const git = (arguments_) => calls.push(arguments_);
  const loadClassifier = async (url) => {
    calls.push(["load", url]);
    return { classifyChanges: (changes, labels) => localCheckPlan(changes, { forceFull: labels.includes("ci:full") }) };
  };

  // when
  const plan = await classifyProtectedChanges(evidence, true, git, loadClassifier);

  // then
  assert.deepEqual(plan.profiles, ["full"]);
  assert.deepEqual(calls[0].slice(0, 3), ["worktree", "add", "--detach"]);
  assert.equal(calls[0][4], "a".repeat(40));
  assert.equal(calls[1][0], "load");
  assert.match(calls[1][1], /tools\/test-profile-classifier\.mjs\?base=a{40}$/);
  assert.deepEqual(calls[2].slice(0, 3), ["worktree", "remove", "--force"]);
});

function gitFor(changes) {
  return (arguments_) => {
    if (arguments_[0] === "fetch") return "";
    if (arguments_[0] === "merge-base") return `${"a".repeat(40)}\n`;
    if (arguments_[0] === "rev-parse") return `${"b".repeat(40)}\n`;
    if (arguments_[0] === "diff" && arguments_.includes("--check")) return "";
    if (arguments_[0] === "diff") {
      return `${changes.flatMap((change) => [change.status, change.path]).join("\0")}\0`;
    }
    if (arguments_[0] === "ls-files") return "";
    throw new Error(`Unexpected git call: ${arguments_.join(" ")}`);
  };
}
