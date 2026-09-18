import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync,
  writeFileSync } from "node:fs";
import { platform as hostPlatform, release as hostRelease } from "node:os";
import { delimiter, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const recipes = new Set(["standard", "full-self-hosted", "existing-infrastructure", "funnel"]);
const outcomes = new Set(["passed", "failed", "warning", "unknown"]);
const evidenceDetails = new Set(["controlled-fixture", "not-applicable", "not-observed", "provider-owned"]);
const sensitive = /(?:password|passwd|secret|credential|token|private[_-]?key)\s*[:=]/i;

function safeAbsolute(path, name) {
  if (typeof path !== "string" || !path.startsWith("/") || path === "/" || path.includes("/../")) {
    throw new Error(`${name} must be a bounded absolute path`);
  }
  return path.replace(/\/$/, "");
}

function safeNamespace(namespace) {
  if (!/^courtside-[a-z0-9]+(?:-[a-z0-9]+)+$/.test(namespace ?? "")) {
    throw new Error("qualification namespace must be a specific courtside-* slug");
  }
  return namespace;
}

function executable(name) {
  const candidate = (process.env.PATH ?? "").split(delimiter).filter(isAbsolute)
    .map((directory) => join(directory, name))
    .find((path) => existsSync(path) && (lstatSync(path).mode & 0o111));
  if (!candidate) throw new Error(`${name} is required on an absolute PATH entry`);
  return candidate;
}

function filesBelow(root, current = root) {
  const currentType = lstatSync(current);
  if (currentType.isSymbolicLink() || !currentType.isDirectory()) {
    throw new Error("deployment archive has no regular release root");
  }
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error("deployment archive extracted a symbolic link");
    if (entry.isDirectory()) return filesBelow(root, path);
    if (!entry.isFile()) throw new Error("deployment archive extracted a non-regular file");
    return [relative(root, path).replaceAll("\\", "/")];
  });
}

export function collectRuntimeIdentity({ architecture = process.arch,
  readOsRelease = () => existsSync("/etc/os-release") ? readFileSync("/etc/os-release", "utf8") : "",
  execute = undefined } = {}) {
  const run = execute ?? ((name) => {
    const docker = executable("docker");
    const args = name === "docker" ? ["version", "--format", "{{.Server.Version}}"]
      : ["compose", "version", "--short"];
    const result = spawnSync(docker, args, { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`qualification could not read ${name} version`);
    return result.stdout;
  });
  const osRelease = readOsRelease();
  const values = Object.fromEntries(osRelease.split("\n").map((line) => /^([A-Z_]+)=(.*)$/.exec(line))
    .filter(Boolean).map(([, key, value]) => [key, value.replace(/^"|"$/g, "")]));
  const os = values.PRETTY_NAME
    ?? ([values.NAME, values.VERSION_ID].filter(Boolean).join(" ") || `${hostPlatform()} ${hostRelease()}`);
  if (!os) throw new Error("qualification could not identify the operating system");
  const mappedArchitecture = architecture === "x64" ? "amd64" : architecture;
  return {
    platform: { os, architecture: mappedArchitecture },
    tools: { docker: run("docker").trim(), compose: run("compose").trim() },
  };
}

export function inspectDeploymentArchive({ archive, destination, expectedImage, selectedRecipes }) {
  if (!isAbsolute(archive) || !archive.endsWith(".zip") || !existsSync(archive)) {
    throw new Error("qualification archive must be an existing absolute zip path");
  }
  safeAbsolute(destination, "qualification destination");
  if (existsSync(destination)) throw new Error("qualification destination must not exist");
  if (!Array.isArray(selectedRecipes) || selectedRecipes.length === 0
      || selectedRecipes.some((recipe) => !recipes.has(recipe))) {
    throw new Error("qualification needs supported selected recipes");
  }
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  const snapshot = join(destination, "candidate.zip");
  try {
    copyFileSync(archive, snapshot);
    const unzip = executable("unzip");
    const listing = spawnSync(unzip, ["-Z1", snapshot], { encoding: "utf8" });
    if (listing.status !== 0) throw new Error(`deployment archive could not be listed: ${listing.stderr.trim()}`);
    const entries = listing.stdout.split("\n").filter(Boolean);
    const prefixes = new Set(entries.map((entry) => entry.split("/", 1)[0]));
    if (entries.length === 0 || prefixes.size !== 1) throw new Error("deployment archive has no single release root");
    const prefix = [...prefixes][0];
    if (!/^courtside-deployment-[A-Za-z0-9.+-]+$/.test(prefix)
        || entries.some((entry) => entry.startsWith("/") || entry.includes("\\")
          || entry.split("/").some((segment) => segment === ".." || segment === "" && entry !== `${prefix}/`))) {
      throw new Error("deployment archive contains an unsafe path");
    }
    if (new Set(entries).size !== entries.length) throw new Error("deployment archive contains duplicate paths");
    const extracted = spawnSync(unzip, ["-q", snapshot, "-d", destination], { encoding: "utf8" });
    if (extracted.status !== 0) throw new Error(`deployment archive could not be extracted: ${extracted.stderr.trim()}`);
    const root = join(destination, prefix);
    const allFiles = filesBelow(root);
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    validateManifest(manifest, selectedRecipes[0]);
    if (manifest.image !== expectedImage) throw new Error("deployment archive does not name the expected image");
    for (const recipe of selectedRecipes) {
      if (!manifest.recipes.includes(recipe)) throw new Error(`deployment archive omits recipe ${recipe}`);
    }
    const actual = allFiles.filter((path) => path !== "manifest.json").sort();
    const declared = Object.keys(manifest.files ?? {}).sort();
    if (JSON.stringify(actual) !== JSON.stringify(declared)) {
      throw new Error("deployment archive contents differ from its manifest");
    }
    for (const [path, digest] of Object.entries(manifest.files)) {
      if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`deployment manifest has an invalid digest for ${path}`);
      const measured = createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
      if (measured !== digest) throw new Error(`deployment archive checksum failed for ${path}`);
    }
    const archiveDigest = createHash("sha256").update(readFileSync(snapshot)).digest("hex");
    unlinkSync(snapshot);
    const chosen = [...new Set(selectedRecipes)].sort();
    return {
      root,
      manifest,
      archiveDigest,
      recipes: chosen,
      evidence: {
        schemaVersion: 1,
        archive: { version: manifest.version, revision: manifest.revision, digest: archiveDigest },
        image: manifest.image,
        recipes: chosen,
        fileCount: declared.length,
        outcome: "passed",
      },
    };
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

const renderEnvironment = {
  COURTSIDE_SOURCE_URL: "https://example.org/courtside",
  COURTSIDE_DOMAIN: "courts.example.org",
  POSTGRES_PASSWORD: "qualification-placeholder",
  COURTSIDE_MAIL_DOMAIN: "courts.example.org",
  COURTSIDE_MAIL_HOSTNAME: "mail.courts.example.org",
  COURTSIDE_MAIL_PASSWORD: "qualification-placeholder",
  COURTSIDE_MAIL_REPLY_TO: "board@example.org",
  COURTSIDE_MAIL_RELOAD_PASSWORD: "qualification-placeholder",
  COURTSIDE_MAIL_ADMIN_PASSWORD: "qualification-placeholder",
  COURTSIDE_MAIL_SETUP_PASSWORD: "qualification-placeholder",
  COURTSIDE_MAIL_DKIM_SELECTOR: "qualification",
  COURTSIDE_MAIL_RELAY_HOST: "smtp.example.org",
  COURTSIDE_MAIL_RELAY_USERNAME: "courts@example.org",
  COURTSIDE_DATABASE_URL: "jdbc:postgresql://database.example.org:5432/courtside",
  COURTSIDE_DATABASE_USERNAME: "courtside",
  COURTSIDE_DATABASE_PASSWORD: "qualification-placeholder",
  COURTSIDE_ACCEPTANCE_MAIL_CERTIFICATES: "/srv/courtside-acceptance-mail",
  COURTSIDE_ACCEPTANCE_MAIL_USER: "1000:1000",
  COURTSIDE_DB_TLS_AUTHORITY: "/srv/courtside/database-authority",
  COURTSIDE_DB_TLS_CERTIFICATE: "/srv/courtside/database-tls/server.crt",
  COURTSIDE_DB_TLS_KEY: "/srv/courtside/database-tls/server.key",
  COURTSIDE_DB_OWNER_USERNAME: "club_owner",
  COURTSIDE_DB_OWNER_PASSWORD_FILE: "/srv/courtside/database-owner-password",
  COURTSIDE_DB_MIGRATION_PASSWORD_FILE: "/srv/courtside/database-migration-password",
  COURTSIDE_DB_RUNTIME_PASSWORD_FILE: "/srv/courtside/database-runtime-password",
};

export function renderDeploymentRecipes({ root, selectedRecipes, image, execute = spawnSync }) {
  safeAbsolute(root, "deployment archive root");
  const digest = image?.split("@sha256:", 2)[1];
  if (!/^[0-9a-f]{64}$/.test(digest ?? "")) throw new Error("recipe rendering needs a digest-pinned image");
  const bash = executable("bash");
  const docker = executable("docker");
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...renderEnvironment,
    COURTSIDE_IMAGE_DIGEST: digest };
  for (const recipe of selectedRecipes) {
    if (!recipes.has(recipe)) throw new Error(`unsupported qualification recipe ${recipe}`);
    const resolved = execute(bash, [join(root, "recipe.sh"), "files", recipe], { encoding: "utf8", env });
    if (resolved.status !== 0) throw new Error(`candidate recipe ${recipe} did not resolve: ${resolved.stderr.trim()}`);
    const files = resolved.stdout.split("\n").filter(Boolean);
    if (files.length === 0 || files.some((file) => isAbsolute(file) || file.includes(".."))) {
      throw new Error(`candidate recipe ${recipe} resolved an unsafe file list`);
    }
    const rendered = execute(docker, ["compose", "--project-directory", root, "--env-file", "/dev/null",
      ...files.flatMap((file) => ["-f", join(root, file)]), "--profile", "*", "config", "--quiet"],
    { encoding: "utf8", env });
    if (rendered.status !== 0) throw new Error(`candidate recipe ${recipe} did not render: ${rendered.stderr.trim()}`);
  }
  return [...selectedRecipes];
}

function validateManifest(manifest, recipe) {
  if (manifest?.schema !== 1 || !/^[0-9a-f]{40}$/.test(manifest.revision ?? "")
      || !/@sha256:[0-9a-f]{64}$/.test(manifest.image ?? "")) {
    throw new Error("qualification needs a valid deployment manifest");
  }
  if (!manifest.recipes?.includes(recipe)) throw new Error(`manifest does not carry recipe ${recipe}`);
}

export function qualificationPlan({ recipe, namespace, archiveRoot, installationRoot, manifest }) {
  if (!recipes.has(recipe)) throw new Error(`unsupported qualification recipe ${recipe}`);
  safeNamespace(namespace);
  const archive = safeAbsolute(archiveRoot, "archive root");
  const installation = safeAbsolute(installationRoot, "installation root");
  validateManifest(manifest, recipe);
  const launcher = `${archive}/courtside --directory ${installation}`;
  const scoped = (id, command, ownership = "courtside") => ({ id, ownership, command });
  return [
    scoped("clean-target", `docker ps -a --filter label=com.docker.compose.project=${namespace}`),
    scoped("archive-integrity", `sha256sum ${archive}/manifest.json`),
    scoped("compose-render", `COMPOSE_PROJECT_NAME=${namespace} ${archive}/recipe.sh files ${recipe}`),
    scoped("install", `${launcher} init --answers ${installation}/answers.conf --yes`),
    scoped("bootstrap", `${launcher} status`),
    scoped("mail-handover", `${launcher} mail-check`,
      recipe === "full-self-hosted" ? "courtside" : "operator"),
    scoped("restart", `docker compose -p ${namespace} restart app`),
    scoped("backup", `${launcher} backup --retain 2`),
    scoped("restore", `${launcher} restore-check --recovery ${installation}/backups/<verified-recovery>`),
    scoped("update", `${launcher} update --archive ${installation}/qualification-next-release.zip --yes`),
    scoped("repeat", `${launcher} up`),
    scoped("failure-recovery", `${launcher} status`),
  ];
}

function validateResult(result) {
  if (!/^[a-z][a-z0-9-]+$/.test(result?.id ?? "")) throw new Error("result id is invalid");
  if (!new Set(["courtside", "operator"]).has(result.ownership)) throw new Error("result ownership is invalid");
  if (!outcomes.has(result.outcome)) throw new Error("result outcome is invalid");
  if (!Number.isInteger(result.durationMs) || result.durationMs < 0) throw new Error("result duration is invalid");
  if (result.ownership === "courtside" && ["warning", "unknown"].includes(result.outcome)) {
    throw new Error(`Courtside-owned result ${result.id} is ${result.outcome}`);
  }
  if (sensitive.test(JSON.stringify(result))) throw new Error(`result ${result.id} contains a sensitive value`);
  if (result.detail !== undefined && !evidenceDetails.has(result.detail)) {
    throw new Error(`result ${result.id} has a non-standard detail that could disclose a target`);
  }
  const allowed = new Set(["id", "ownership", "outcome", "detail", "durationMs"]);
  for (const key of Object.keys(result)) {
    if (!allowed.has(key)) throw new Error(`result ${result.id} carries unsupported evidence field ${key}`);
  }
  return { ...result };
}

export function createQualificationEvidence({ manifest, recipe, namespace, platform, dockerVersion,
  composeVersion, results }) {
  if (!recipes.has(recipe)) throw new Error(`unsupported qualification recipe ${recipe}`);
  safeNamespace(namespace);
  validateManifest(manifest, recipe);
  if (!/^[0-9a-f]{64}$/.test(manifest.archiveSha256 ?? "")) {
    throw new Error("qualification evidence needs the archive digest");
  }
  if (!/^\d+\.\d+/.test(dockerVersion ?? "") || !/^\d+\.\d+/.test(composeVersion ?? "")) {
    throw new Error("qualification needs Docker and Compose versions");
  }
  if (!platform || typeof platform.os !== "string" || typeof platform.architecture !== "string") {
    throw new Error("qualification needs an OS and architecture");
  }
  const checked = results.map(validateResult);
  if (checked.length === 0) throw new Error("qualification has no results");
  const failed = checked.some(({ outcome }) => outcome === "failed");
  const uncertain = checked.some(({ outcome }) => outcome === "warning" || outcome === "unknown");
  return {
    schemaVersion: 1,
    archive: { version: manifest.version, revision: manifest.revision, digest: manifest.archiveSha256 },
    image: manifest.image,
    recipe,
    namespace,
    platform: { os: platform.os, architecture: platform.architecture },
    tools: { docker: dockerVersion, compose: composeVersion },
    results: checked,
    outcome: failed ? "failed" : uncertain ? "passed-with-unknowns" : "passed",
  };
}

export function changedRecipes(paths, catalog) {
  const names = catalog.map(({ name }) => name).sort();
  const selected = new Set();
  for (const path of paths) {
    const recipe = /^deploy\/recipes\/([a-z][a-z-]+)\.recipe$/.exec(path)?.[1];
    if (recipe) {
      if (names.includes(recipe)) selected.add(recipe);
      continue;
    }
    const relative = path.startsWith("deploy/") ? path.slice("deploy/".length) : null;
    if (relative?.startsWith("compose.")) {
      for (const entry of catalog) if (entry.files.includes(relative)) selected.add(entry.name);
      continue;
    }
    if (relative !== null || path.startsWith("tools/deployment-") || path.startsWith(".github/workflows/")) {
      names.forEach((name) => selected.add(name));
    }
  }
  return [...selected].sort();
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`deployment-qualification needs --${name}`);
  return process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--inspect-archive")) {
    const runtime = collectRuntimeIdentity();
    const inspected = inspectDeploymentArchive({
      archive: option("archive"),
      destination: option("destination"),
      expectedImage: option("image"),
      selectedRecipes: option("recipes").split(",").filter(Boolean),
    });
    const renderedRecipes = renderDeploymentRecipes({ root: inspected.root,
      selectedRecipes: inspected.recipes, image: inspected.manifest.image });
    const evidence = { ...inspected.evidence, ...runtime, renderedRecipes };
    writeFileSync(option("output"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  } else if (process.argv.includes("--record")) {
    const input = JSON.parse(readFileSync(option("input"), "utf8"));
    writeFileSync(option("output"), `${JSON.stringify(createQualificationEvidence(input), null, 2)}\n`,
      { mode: 0o600 });
  } else if (process.argv.includes("--plan")) {
    const input = JSON.parse(readFileSync(option("input"), "utf8"));
    process.stdout.write(`${JSON.stringify(qualificationPlan(input), null, 2)}\n`);
  } else {
    throw new Error("Use --inspect-archive, --plan or --record");
  }
}
