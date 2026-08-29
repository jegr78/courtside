import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateObservedBase } from "./ci-base-provenance.mjs";

function git(repository, ...arguments_) {
  return execFileSync("git", arguments_, {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Jane Doe",
      GIT_AUTHOR_EMAIL: "jane.doe@example.org",
      GIT_COMMITTER_NAME: "Jane Doe",
      GIT_COMMITTER_EMAIL: "jane.doe@example.org"
    }
  }).trim();
}

function commit(repository, content, message) {
  writeFileSync(join(repository, "change.txt"), content);
  git(repository, "add", "change.txt");
  git(repository, "commit", "-m", message);
  return git(repository, "rev-parse", "HEAD");
}

function repositoryHistory() {
  const repository = mkdtempSync(join(tmpdir(), "courtside-ci-base-"));
  git(repository, "init", "--initial-branch=main");
  const base = commit(repository, "base", "test: create base");
  git(repository, "switch", "-c", "feature");
  const head = commit(repository, "feature", "test: create feature head");
  git(repository, "switch", "main");
  const advancedBase = commit(repository, "advanced", "test: advance base");
  return { repository, base, head, advancedBase };
}

test("givenTheExactRunBase_whenValidatingProvenance_thenItIsAccepted", () => {
  // given
  const history = repositoryHistory();

  try {
    // when / then
    assert.doesNotThrow(() => validateObservedBase(history.repository, history.base, history.head));
  } finally {
    rmSync(history.repository, { recursive: true, force: true });
  }
});

test("givenTheDefaultBranchAdvancedAfterTheRun_whenValidatingProvenance_thenItFailsClosed", () => {
  // given
  const history = repositoryHistory();

  try {
    // when / then
    assert.throws(
      () => validateObservedBase(history.repository, history.advancedBase, history.head),
      /base is not bound to the completed run/
    );
  } finally {
    rmSync(history.repository, { recursive: true, force: true });
  }
});

test("givenMalformedCommitIdentity_whenValidatingProvenance_thenItIsRejectedBeforeGit", () => {
  // when / then
  assert.throws(() => validateObservedBase(".", "main", "head"), /commit identity is invalid/);
});
