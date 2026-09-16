import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const YAML = createRequire(new URL("../frontend/package.json", import.meta.url))("yaml");

const overlays = ["database-identities", "database-tls", "database-tls-local", "app-tls"];
const roots = ["recipe.sh", "README.md", "container-contract.md"];

export function recipeNames(deploy) {
  return readdirSync(join(deploy, "recipes")).filter((entry) => entry.endsWith(".recipe"))
    .map((entry) => entry.slice(0, -".recipe".length)).sort();
}

function combinations(names) {
  const selections = [];
  for (const name of names) {
    for (let mask = 0; mask < 1 << overlays.length; mask += 1) {
      const selected = overlays.filter((_, index) => mask & (1 << index));
      selections.push([name, ...selected.flatMap((overlay) => ["--overlay", overlay])]);
      selections.push([name, ...selected.flatMap((overlay) => ["--overlay", overlay]), "--synthetic-mail"]);
    }
  }
  return selections;
}

export function emittedComposeFiles(deploy) {
  const resolver = join(deploy, "recipe.sh");
  const emitted = new Set();
  let accepted = 0;
  for (const selection of combinations(recipeNames(deploy))) {
    const result = spawnSync("/bin/bash", [resolver, "files", ...selection], { encoding: "utf8" });
    if (result.status !== 0) continue;
    accepted += 1;
    for (const file of result.stdout.split("\n").filter(Boolean)) emitted.add(file);
  }
  if (accepted === 0) throw new Error("the resolver accepted no combination, so nothing was derived");
  return [...emitted].sort();
}

function volumeSource(entry) {
  if (typeof entry === "object" && entry !== null) return entry.type === "bind" ? entry.source : undefined;
  if (typeof entry !== "string") return undefined;
  let depth = 0;
  for (let index = 0; index < entry.length; index += 1) {
    if (entry.startsWith("${", index)) depth += 1;
    else if (entry[index] === "}" && depth > 0) depth -= 1;
    else if (entry[index] === ":" && depth === 0) return entry.slice(0, index);
  }
  return undefined;
}

function shippedPath(source) {
  const defaulted = /^\$\{[A-Za-z_][A-Za-z0-9_]*:-(.+)\}$/.exec(source ?? "");
  const candidate = defaulted ? defaulted[1] : source ?? "";
  return candidate.startsWith("./") ? candidate.slice(2) : undefined;
}

export function boundPaths(deploy, composeFiles) {
  const bound = new Set();
  for (const file of composeFiles) {
    const model = YAML.parse(readFileSync(join(deploy, file), "utf8"), { logLevel: "silent" }) ?? {};
    for (const service of Object.values(model.services ?? {})) {
      for (const volume of service?.volumes ?? []) {
        const path = shippedPath(volumeSource(volume));
        if (path) bound.add(path);
      }
    }
  }
  return [...bound].sort();
}

function expand(deploy, path) {
  const absolute = join(deploy, path);
  if (!existsSync(absolute)) throw new Error(`the deployment names ${path}, which does not exist`);
  if (!statSync(absolute).isDirectory()) return [path];
  return readdirSync(absolute).flatMap((entry) => expand(deploy, posix.join(path, entry))).sort();
}

export function archiveEntries(deploy) {
  const composeFiles = emittedComposeFiles(deploy);
  const recipes = recipeNames(deploy).map((name) => `recipes/${name}.recipe`);
  const named = [...composeFiles, ...boundPaths(deploy, composeFiles), ...recipes, ...roots];
  const paths = [...new Set(named.flatMap((path) => expand(deploy, path)))].sort();
  return paths.map((path) => ({
    path,
    mode: statSync(join(deploy, path)).mode & 0o111 ? 0o755 : 0o644,
    content: readFileSync(join(deploy, path)),
  }));
}

// Matching the name inside ${...} would read every reference as an assignment, so it is dropped first.
const reference = /\$\{[^}]*\}/g;
const secretAssignment = /\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|CREDENTIAL)[A-Z0-9_]*)[ \t]*[:=][ \t]*(\S+)/g;

export function refuseSecrets(entries) {
  for (const entry of entries) {
    if (basename(entry.path) === ".env" || basename(entry.path).startsWith(".env.")) {
      throw new Error(`${entry.path} is an environment file, and a release archive carries none`);
    }
    const text = entry.content.toString("utf8").replace(reference, "$$REF");
    if (text.includes("-----BEGIN") && text.includes("PRIVATE KEY-----")) {
      throw new Error(`${entry.path} carries a private key`);
    }
    for (const [, name, value] of text.matchAll(secretAssignment)) {
      // A _FILE variable names a path, and a reference, Compose tag or empty value carries nothing.
      if (name.endsWith("_FILE") || /^[$!]/.test(value) || ["null", '""', "''"].includes(value)) continue;
      throw new Error(`${entry.path} assigns a credential: ${name}`);
    }
  }
  return entries;
}

function digestOf(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function manifestOf({ version, revision, image, repository, ref, entries }) {
  if (!/^[0-9a-f]{40}$/.test(revision ?? "")) throw new Error("the archive needs a full source revision");
  if (!/@sha256:[0-9a-f]{64}$/.test(image ?? "")) {
    throw new Error("the archive needs an image a digest pins, not a floating tag");
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("the archive needs its repository");
  if (!/^refs\/tags\/[\w.+-]+$/.test(ref ?? "")) throw new Error("the archive needs the release tag");
  return {
    schema: 1,
    version,
    revision,
    image,
    signer: `https://github.com/${repository}/.github/workflows/release.yml@${ref}`,
    recipes: entries.filter((entry) => entry.path.startsWith("recipes/"))
      .map((entry) => basename(entry.path, ".recipe")),
    files: Object.fromEntries(entries.map((entry) => [entry.path, digestOf(entry.content)])),
  };
}

function zipOf(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const size = entry.content.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    // A fixed 1980-01-01 stamp is what lets two builds of one release produce equal bytes.
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc32(entry.content), 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, entry.content);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x0314, 4);
    local.copy(header, 6, 4, 30);
    header.writeUInt32LE(((0o100000 | entry.mode) << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + size;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function buildArchive({ deploy, version, revision, image, repository, ref }) {
  const entries = refuseSecrets(archiveEntries(deploy));
  const manifest = manifestOf({ version, revision, image, repository, ref, entries });
  const prefix = `courtside-deployment-${version}`;
  const carried = [...entries, { path: "manifest.json", mode: 0o644,
    content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") }]
    .sort((left, right) => left.path.localeCompare(right.path, "en"))
    .map((entry) => ({ ...entry, path: posix.join(prefix, entry.path) }));
  const zip = zipOf(carried);
  return { zip, manifest, sha256: digestOf(zip), name: `${prefix}.zip` };
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`deployment-archive needs --${name}`);
  }
  return process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const deploy = fileURLToPath(new URL("../deploy/", import.meta.url));
  const version = option("version").replace(/^v/, "");
  const built = buildArchive({
    deploy,
    version,
    revision: option("revision"),
    image: option("image"),
    repository: option("repository"),
    ref: option("ref"),
  });
  const output = join(option("output"), built.name);
  writeFileSync(output, built.zip);
  writeFileSync(`${output}.sha256`, `${built.sha256}  ${built.name}\n`);
  process.stdout.write(`${built.name} ${built.sha256} ${Object.keys(built.manifest.files).length} files\n`);
}
