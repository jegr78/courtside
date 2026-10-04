import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkoutRepository } from "./courtside.mjs";
import { gitHistory, nightlyUpgradeOrigins } from "./courtside.upgrade-smoke.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const qualificationPath = "build/uat-smoke/qualification.json";
const candidateTag = "courtside:uat-local";
const candidatePath = "build/local-gates/candidate.json";

export const localGates = ["uat", "mail", "restore", "upgrade", "active-security"];

export function gatePlans(gate, context) {
  switch (gate) {
    case "uat":
      return [{ label: "uat", arguments: ["tools/courtside.uat-smoke.mjs", "--confirm", "courtside-uat"],
        environment: {} }];
    case "mail":
      return [{ label: "mail", arguments: ["tools/courtside.mail-smoke.mjs"],
        environment: { COURTSIDE_MAIL_SMOKE_LOGS: "build/deployment-mail/server-logs" } }];
    case "restore":
      return [{ label: "restore", arguments: ["tools/courtside.restore-smoke.mjs", "--confirm", "courtside-restore"],
        environment: { COURTSIDE_RESTORE_IMAGE: context.image } }];
    case "upgrade":
      if (!Array.isArray(context.origins) || context.origins.length === 0) {
        throw new Error("no upgrade origin: no retained nightly shares this commit's migrations");
      }
      return context.origins.map((origin) => ({
        label: `upgrade-${origin.ref}`,
        arguments: ["tools/courtside.upgrade-smoke.mjs", "--confirm", "courtside-upgrade"],
        environment: {
          COURTSIDE_UPGRADE_CANDIDATE_IMAGE: context.image,
          COURTSIDE_UPGRADE_ORIGIN: origin.ref,
          COURTSIDE_UPGRADE_ORIGIN_IMAGE: origin.image,
          GITHUB_REPOSITORY: context.repository
        }
      }));
    case "active-security": {
      const { image, runId, commit } = context;
      const evidence = `build/security-gate/${runId}`;
      return [
        { label: "security-images", arguments: ["tools/security-image-inventory.mjs", "active"], environment: {},
          pull: true },
        { label: "security-start", arguments: ["tools/courtside.mjs", "security", runId, image], environment: {} },
        { label: "security-run", arguments: ["tools/courtside.mjs", "security-run", runId, "active",
          "--qualification", qualificationPath, "--authorize", `authorize-active-${runId}`], environment: {} },
        { label: "security-report", arguments: ["tools/courtside.mjs", "security-report", runId, "--attempt", "1"],
          environment: {}, output: `${evidence}/manifest.json`, always: true },
        { label: "security-gate", arguments: ["tools/security-assessment-gate.mjs",
          "--manifest", `${evidence}/manifest.json`, "--profile", "active", "--subject", image,
          "--source-commit", commit, "--output", `${evidence}/active-security-summary.json`],
        environment: {}, always: true },
        { label: "security-cleanup", arguments: ["tools/courtside.mjs", "security-cleanup", runId], environment: {},
          always: true }
      ];
    }
    default:
      throw new Error(`unknown gate ${gate}; choose one of ${localGates.join(", ")}`);
  }
}

export function qualifiedCandidate(imageId, qualification, recorded) {
  if (!/^sha256:[0-9a-f]{64}$/.test(imageId ?? "") || qualification?.status !== "passed"
      || !/^[0-9a-f]{40}$/.test(recorded?.commit ?? "")) {
    throw new Error(`no qualified ${candidateTag}: run the uat gate first`);
  }
  if (qualification.manifestDigest !== imageId) {
    throw new Error(`${qualificationPath} qualified another image than ${candidateTag} (${imageId})`);
  }
  if (recorded.image !== imageId) {
    throw new Error(`${candidatePath} recorded another image than ${candidateTag} (${imageId})`);
  }
  return { image: imageId, commit: recorded.commit };
}

export function runGatePlans(plans, execute) {
  const failures = [];
  for (const plan of plans) {
    if (failures.length > 0 && !plan.always) continue;
    process.stdout.write(`Running gate step: ${plan.label}\n`);
    if (execute(plan) !== 0) failures.push(plan.label);
  }
  if (failures.length > 0) throw new Error(`${failures.join(", ")} failed`);
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

function executePlan(plan) {
  const environment = { ...process.env, ...plan.environment };
  if (plan.pull) {
    const inventory = run(process.execPath, plan.arguments, { env: environment, stdio: ["ignore", "pipe", "inherit"] });
    if (inventory.status !== 0) return inventory.status;
    for (const reference of inventory.stdout.split("\n").filter(Boolean)) {
      const pulled = run("docker", ["pull", reference], { stdio: "inherit" });
      if (pulled.status !== 0) return pulled.status;
    }
    return 0;
  }
  if (plan.output) {
    const target = join(root, plan.output);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const descriptor = openSync(target, "w", 0o600);
    try {
      return run(process.execPath, plan.arguments, { env: environment, stdio: ["ignore", descriptor, "inherit"] })
        .status;
    } finally {
      closeSync(descriptor);
    }
  }
  return run(process.execPath, plan.arguments, { env: environment, stdio: "inherit" }).status;
}

function candidateImage() {
  const inspected = run("docker", ["image", "inspect", "--format", "{{.Id}}", candidateTag]);
  const imageId = inspected.status === 0 ? inspected.stdout.trim() : "";
  return qualifiedCandidate(imageId, readJson(qualificationPath), readJson(candidatePath));
}

function readJson(path) {
  const absolute = join(root, path);
  return existsSync(absolute) ? JSON.parse(readFileSync(absolute, "utf8")) : undefined;
}

function recordCandidate(commit) {
  const inspected = run("docker", ["image", "inspect", "--format", "{{.Id}}", candidateTag]);
  if (inspected.status !== 0) throw new Error(`the uat gate left no ${candidateTag}`);
  const target = join(root, candidatePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ image: inspected.stdout.trim(), commit }, null, 2)}\n`);
}

async function upgradeOrigins(repository, commit) {
  const name = repository.toLowerCase();
  const tokenResponse = await fetch(`https://ghcr.io/token?scope=repository:${name}:pull`);
  if (!tokenResponse.ok) throw new Error(`GHCR refused an anonymous pull token: ${tokenResponse.status}`);
  const { token } = await tokenResponse.json();
  const tagsResponse = await fetch(`https://ghcr.io/v2/${name}/tags/list?n=10000`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!tagsResponse.ok) throw new Error(`GHCR refused the tag list: ${tagsResponse.status}`);
  const { tags } = await tagsResponse.json();
  return nightlyUpgradeOrigins(name, tags ?? [], gitHistory(commit, root));
}

async function context(gate) {
  if (gate === "uat" || gate === "mail") return {};
  const { image, commit } = candidateImage();
  const repository = checkoutRepository();
  if (!repository) throw new Error("Cannot name the repository: give this checkout an origin remote on GitHub");
  return {
    image,
    repository,
    commit,
    runId: `local-${Date.now()}`,
    origins: gate === "upgrade" ? await upgradeOrigins(repository, commit) : []
  };
}

async function main() {
  const gate = process.argv[2];
  if (process.argv.length !== 3) throw new Error(`usage: node tools/local-release-gates.mjs <${localGates.join("|")}>`);
  if (!localGates.includes(gate)) gatePlans(gate, {});
  const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const plans = gatePlans(gate, await context(gate));
  if (gate === "uat") rmSync(join(root, candidatePath), { force: true });
  runGatePlans(plans, executePlan);
  if (gate === "uat") recordCandidate(head);
  process.stdout.write(`Gate ${gate} passed\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Gate ${process.argv[2]} failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
