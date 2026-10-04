import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createSocket } from "node:dgram";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkoutRepository } from "./courtside.mjs";
import { emptyOriginNotice, gitHistory, modifiedUpgradeInputs, nightlyUpgradeOrigins }
  from "./courtside.upgrade-smoke.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const qualificationPath = "build/uat-smoke/qualification.json";
const runScopedProject = /^courtside-uat-gate-[a-z0-9-]+$/;
const runScopedImage = /^courtside:uat-gate-[a-z0-9-]+$/;
const candidatePath = "build/local-gates/candidate.json";

export const localGates = ["uat", "mail", "restore", "upgrade", "active-security"];

export function gatePlans(gate, context) {
  switch (gate) {
    case "uat": {
      const { instance } = context;
      if (!runScopedProject.test(instance?.project ?? "") || !runScopedImage.test(instance?.image ?? "")) {
        throw new Error("the uat gate needs a run-scoped UAT project and image");
      }
      return [{ label: "uat", arguments: ["tools/courtside.uat-smoke.mjs", "--confirm", instance.project],
        environment: {
          COURTSIDE_UAT_PROJECT: instance.project,
          COURTSIDE_UAT_LOCAL_IMAGE: instance.image,
          COURTSIDE_UAT_HTTP_PORT: String(instance.httpPort),
          COURTSIDE_UAT_HTTPS_PORT: String(instance.httpsPort),
          COURTSIDE_UAT_SHARED_PORT: String(instance.sharedPort),
          COURTSIDE_OPERATIONAL_LOG_PORT: String(instance.logPort)
        } }];
    }
    case "mail":
      return [{ label: "mail", arguments: ["tools/courtside.mail-smoke.mjs"],
        environment: { COURTSIDE_MAIL_SMOKE_LOGS: "build/deployment-mail/server-logs" } }];
    case "restore":
      return [{ label: "restore", arguments: ["tools/courtside.restore-smoke.mjs", "--confirm", "courtside-restore"],
        environment: { COURTSIDE_RESTORE_IMAGE: context.image } }];
    case "upgrade":
      if (context.origins?.length === 0 && typeof context.originNotice === "string") {
        return [{ label: "upgrade-notice", notice: context.originNotice }];
      }
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
      || !/^[0-9a-f]{40}$/.test(recorded?.commit ?? "") || !runScopedImage.test(recorded?.tag ?? "")) {
    throw new Error("no qualified gate image: run the uat gate first");
  }
  if (qualification.manifestDigest !== imageId) {
    throw new Error(`${qualificationPath} qualified another image than ${recorded.tag} (${imageId})`);
  }
  if (recorded.image !== imageId) {
    throw new Error(`${candidatePath} recorded another image than ${recorded.tag} (${imageId})`);
  }
  return { image: imageId, commit: recorded.commit, tag: recorded.tag };
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

export function qualifyCandidate(plans, tag, execute, remove) {
  try {
    runGatePlans(plans, execute);
  } catch (failure) {
    remove(tag);
    throw failure;
  }
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

function executePlan(plan) {
  if (plan.notice !== undefined) {
    process.stdout.write(`${plan.notice}\n`);
    return 0;
  }
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
  const recorded = readJson(candidatePath);
  const inspected = runScopedImage.test(recorded?.tag ?? "")
    ? run("docker", ["image", "inspect", "--format", "{{.Id}}", recorded.tag]) : { status: 1 };
  const imageId = inspected.status === 0 ? inspected.stdout.trim() : "";
  return qualifiedCandidate(imageId, readJson(qualificationPath), recorded);
}

function freePort(kind) {
  return new Promise((resolvePort, reject) => {
    const socket = kind === "udp" ? createSocket("udp4") : createServer();
    socket.once("error", reject);
    const done = () => {
      const { port } = socket.address();
      socket.close(() => resolvePort(port));
    };
    if (kind === "udp") socket.bind(0, "127.0.0.1", done);
    else socket.listen(0, "127.0.0.1", done);
  });
}

async function runScopedInstance() {
  const suffix = `${process.pid}-${Date.now().toString(36)}`;
  return {
    project: `courtside-uat-gate-${suffix}`,
    image: `courtside:uat-gate-${suffix}`,
    httpPort: await freePort("tcp"),
    httpsPort: await freePort("tcp"),
    sharedPort: await freePort("tcp"),
    logPort: await freePort("udp")
  };
}

function readJson(path) {
  const absolute = join(root, path);
  return existsSync(absolute) ? JSON.parse(readFileSync(absolute, "utf8")) : undefined;
}

function recordCandidate(commit, tag) {
  const inspected = run("docker", ["image", "inspect", "--format", "{{.Id}}", tag]);
  if (inspected.status !== 0) throw new Error(`the uat gate left no ${tag}`);
  const target = join(root, candidatePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ image: inspected.stdout.trim(), commit, tag }, null, 2)}\n`);
}

function forgetPreviousCandidate() {
  const previous = readJson(candidatePath);
  if (runScopedImage.test(previous?.tag ?? "")) run("docker", ["image", "rm", previous.tag]);
  rmSync(join(root, candidatePath), { force: true });
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
  if (gate === "uat") return { instance: await runScopedInstance() };
  if (gate === "mail") return {};
  const { image, commit } = candidateImage();
  const repository = checkoutRepository();
  if (!repository) throw new Error("Cannot name the repository: give this checkout an origin remote on GitHub");
  const origins = gate === "upgrade" ? await upgradeOrigins(repository, commit) : [];
  return {
    image,
    repository,
    commit,
    runId: `local-${Date.now()}`,
    origins,
    originNotice: origins.length === 0 && gate === "upgrade"
      ? emptyOriginNotice(modifiedUpgradeInputs("origin/main", commit, root)) : undefined
  };
}

async function main() {
  const gate = process.argv[2];
  if (process.argv.length !== 3) throw new Error(`usage: node tools/local-release-gates.mjs <${localGates.join("|")}>`);
  if (!localGates.includes(gate)) gatePlans(gate, {});
  const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const gateContext = await context(gate);
  const plans = gatePlans(gate, gateContext);
  if (gate === "uat") {
    forgetPreviousCandidate();
    qualifyCandidate(plans, gateContext.instance.image, executePlan, (tag) => run("docker", ["image", "rm", tag]));
    recordCandidate(head, gateContext.instance.image);
  } else {
    runGatePlans(plans, executePlan);
  }
  process.stdout.write(`Gate ${gate} passed\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Gate ${process.argv[2]} failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
