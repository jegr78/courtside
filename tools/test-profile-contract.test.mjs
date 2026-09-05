import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ciJobsForProfiles, loadProfileContract, localTasksForProfiles,
  validateContract } from "./test-profile-contract.mjs";

test("given the repository toolchain contract, when CI and Maven install Node, then both use the exact versions", () => {
  // given
  const toolchain = JSON.parse(readFileSync(new URL("../ci/node-toolchain.json", import.meta.url), "utf8"));
  const pom = readFileSync(new URL("../pom.xml", import.meta.url), "utf8");

  // when / then
  assert.match(toolchain.node, /^\d+\.\d+\.\d+$/);
  assert.match(toolchain.npm, /^\d+\.\d+\.\d+$/);
  assert.match(pom, new RegExp(`<node\\.version>v${toolchain.node.replaceAll(".", "\\.")}<\\/node\\.version>`));
  assert.match(pom, new RegExp(`<npm\\.version>${toolchain.npm.replaceAll(".", "\\.")}<\\/npm\\.version>`));
});

test("given combined reduced profiles, when resolving coverage, then jobs and tasks form stable unions", () => {
  // given
  const contract = loadProfileContract();

  // when
  const jobs = ciJobsForProfiles(contract, ["backend", "frontend"]);
  const tasks = localTasksForProfiles(contract, ["backend", "frontend"]);

  // then
  assert.deepEqual(jobs, ["backend", "frontend", "tooling", "security"]);
  assert.equal(tasks[0].label, "backend");
  assert.equal(tasks.at(-1).label, "tooling-test");
  assert.equal(new Set(tasks.map((task) => task.label)).size, tasks.length);
});

test("given a tree the tool policies read, when its profile is selected, then the tooling job runs", () => {
  // given — tests under tools/ read docs/, src/ and frontend/, and a path selects exactly one
  // reduced profile, so the profile has to carry the job or the policy never runs for the change
  const contract = loadProfileContract();

  // when / then
  for (const profile of ["docs", "backend", "frontend"]) {
    assert.ok(ciJobsForProfiles(contract, [profile]).includes("tooling"),
      `${profile} does not run the tooling job`);
    assert.ok(localTasksForProfiles(contract, [profile]).some((task) => task.label === "tooling-test"),
      `${profile} does not run the tooling tests locally`);
  }
});

test("given incomplete full coverage, when validating the contract, then no plan can use it", () => {
  // given
  const partialJobs = structuredClone(loadProfileContract());
  partialJobs.profiles.full.ciJobs = ["backend"];
  const reducedTopology = structuredClone(loadProfileContract());
  reducedTopology.ciJobOrder = ["backend"];
  reducedTopology.profiles.full.ciJobs = ["backend"];
  const emptyTasks = structuredClone(loadProfileContract());
  emptyTasks.profiles.full.localTasks = [];
  const weakenedCommand = structuredClone(loadProfileContract());
  weakenedCommand.localTaskDefinitions.full.arguments = ["verify"];
  const openDifference = structuredClone(loadProfileContract());
  openDifference.coverageDifferences[0].unknown = "value";

  // when / then
  assert.throws(() => validateContract(partialJobs), /full test profile coverage is incomplete/i);
  assert.throws(() => validateContract(reducedTopology), /contract is invalid/i);
  assert.throws(() => validateContract(emptyTasks), /coverage is invalid/i);
  assert.throws(() => validateContract(weakenedCommand), /full local verification task is invalid/i);
  assert.throws(() => validateContract(openDifference), /coverage difference is invalid/i);
});

test("given a profile that runs nothing, when validating the contract, then the empty coverage is refused", () => {
  // given
  const contract = loadProfileContract();
  const withoutJobs = structuredClone(contract);
  const withoutTasks = structuredClone(contract);
  withoutJobs.profiles.docs.ciJobs = [];
  withoutTasks.profiles.docs.localTasks = [];

  // when / then
  assert.throws(() => validateContract(withoutJobs), /coverage is invalid/i);
  assert.throws(() => validateContract(withoutTasks), /coverage is invalid/i);
});

test("given any full profile, when resolving coverage, then only full coverage remains", () => {
  // given
  const contract = loadProfileContract();

  // when
  const jobs = ciJobsForProfiles(contract, ["backend", "full"]);
  const tasks = localTasksForProfiles(contract, ["frontend", "full"]);

  // then
  assert.deepEqual(jobs, ["docs", "backend", "frontend", "tooling", "security"]);
  assert.deepEqual(tasks.map((task) => task.label), ["docs-check", "full"]);
});
