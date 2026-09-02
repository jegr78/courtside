import { readFileSync } from "node:fs";

const contractUrl = new URL("../ci/test-profile-contract.json", import.meta.url);

export function loadProfileContract() {
  const contract = JSON.parse(readFileSync(contractUrl, "utf8"));
  validateContract(contract);
  return contract;
}

export function ciJobsForProfiles(contract, profiles) {
  return coverageForProfiles(contract, profiles, "ciJobs", (value) => value);
}

export function localTasksForProfiles(contract, profiles) {
  const labels = coverageForProfiles(contract, profiles, "localTasks", (value) => value);
  return labels.map((label) => ({ label, ...structuredClone(contract.localTaskDefinitions[label]) }));
}

function coverageForProfiles(contract, profiles, field, transform) {
  validateProfiles(contract, profiles);
  const effective = profiles.includes("full") ? ["full"] : profiles;
  const selected = new Set(effective.flatMap((profile) => contract.profiles[profile][field]));
  const order = field === "ciJobs" ? contract.ciJobOrder : Object.keys(contract.localTaskDefinitions);
  return order.filter((value) => selected.has(value)).map(transform);
}

function validateProfiles(contract, profiles) {
  if (!Array.isArray(profiles) || profiles.length < 1 || new Set(profiles).size !== profiles.length
      || profiles.some((profile) => !Object.hasOwn(contract.profiles, profile))) {
    throw new Error("Test profile selection is invalid");
  }
}

export function validateContract(contract) {
  const rootFields = ["schemaVersion", "profileOrder", "ciJobOrder", "profiles",
    "localTaskDefinitions", "coverageDifferences"];
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)
      || contract.schemaVersion !== 1
      || Object.keys(contract).some((field) => !rootFields.includes(field))
      || JSON.stringify(contract.profileOrder) !== JSON.stringify(["docs", "backend", "frontend", "tooling", "full"])
      || JSON.stringify(contract.ciJobOrder) !== JSON.stringify(["docs", "backend", "frontend", "tooling", "security"])
      || Object.keys(contract.profiles ?? {}).length !== contract.profileOrder.length
      || Object.keys(contract.localTaskDefinitions ?? {}).length < 1
      || !Array.isArray(contract.coverageDifferences) || contract.coverageDifferences.length < 1) {
    throw new Error("Test profile contract is invalid");
  }
  const taskLabels = new Set(Object.keys(contract.localTaskDefinitions));
  for (const profile of contract.profileOrder) {
    const coverage = contract.profiles[profile];
    if (coverage === null || typeof coverage !== "object" || Array.isArray(coverage)
        || Object.keys(coverage).some((field) => !["ciJobs", "localTasks"].includes(field))
        || !Array.isArray(coverage.ciJobs) || !Array.isArray(coverage.localTasks)
        || new Set(coverage.ciJobs).size !== coverage.ciJobs.length
        || new Set(coverage.localTasks).size !== coverage.localTasks.length
        || coverage.ciJobs.some((job) => !contract.ciJobOrder.includes(job))
        || coverage.localTasks.some((task) => !taskLabels.has(task))) {
      throw new Error("Test profile coverage is invalid");
    }
  }
  if (JSON.stringify(contract.profiles.full.ciJobs) !== JSON.stringify(contract.ciJobOrder)
      || JSON.stringify(contract.profiles.full.localTasks) !== JSON.stringify(["docs-check", "full"])) {
    throw new Error("Full test profile coverage is incomplete");
  }
  for (const [label, task] of Object.entries(contract.localTaskDefinitions)) {
    if (task === null || typeof task !== "object" || Array.isArray(task)
        || Object.keys(task).some((field) => !["workingDirectory", "executable", "arguments"].includes(field))
        || !["repository", "frontend"].includes(task.workingDirectory)
        || !["maven", "node", "npm"].includes(task.executable)
        || !Array.isArray(task.arguments) || task.arguments.some((argument) => typeof argument !== "string")) {
      throw new Error(`Local task ${label} is invalid`);
    }
  }
  const full = contract.localTaskDefinitions.full;
  if (full.workingDirectory !== "repository" || full.executable !== "maven"
      || JSON.stringify(full.arguments) !== JSON.stringify(["clean", "verify"])) {
    throw new Error("Full local verification task is invalid");
  }
  for (const difference of contract.coverageDifferences) {
    if (difference === null || typeof difference !== "object" || Array.isArray(difference)
        || Object.keys(difference).length !== 3
        || typeof difference.scope !== "string" || difference.scope.length < 1
        || typeof difference.ci !== "string" || difference.ci.length < 1
        || typeof difference.local !== "string" || difference.local.length < 1) {
      throw new Error("Test profile coverage difference is invalid");
    }
  }
}
