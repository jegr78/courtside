import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, delimiter, isAbsolute, join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const YAML = createRequire(new URL("../frontend/package.json", import.meta.url))("yaml");

const roots = ["recipe.sh", ".env.example", "README.md", "container-contract.md"];

export function recipeNames(deploy) {
  return readdirSync(join(deploy, "recipes")).filter((entry) => entry.endsWith(".recipe"))
    .map((entry) => entry.slice(0, -".recipe".length)).sort();
}

export function overlayNames(deploy) {
  const declared = /^readonly overlay_order="([^"]+)"/m
    .exec(readFileSync(join(deploy, "recipe.sh"), "utf8"));
  if (!declared) throw new Error("recipe.sh declares no overlay order, so nothing can be enumerated");
  return declared[1].split(/\s+/).filter(Boolean);
}

function combinations(names, overlays) {
  const selections = [];
  for (const name of names) {
    for (let mask = 0; mask < 1 << overlays.length; mask += 1) {
      const selected = overlays.filter((_, index) => mask & (1 << index));
      const chosen = selected.flatMap((overlay) => ["--overlay", overlay]);
      selections.push([name, ...chosen], [name, ...chosen, "--synthetic-mail"]);
    }
  }
  return selections;
}

export function executable(name) {
  const found = (process.env.PATH ?? "").split(delimiter).filter(isAbsolute)
    .map((directory) => join(directory, name))
    .find((candidate) => existsSync(candidate) && statSync(candidate).mode & 0o111);
  if (!found) throw new Error(`${name} is not on PATH, and the deployment archive is resolved with it`);
  return found;
}

export function emittedComposeFiles(deploy) {
  const resolver = join(deploy, "recipe.sh");
  const shell = executable("bash");
  const emitted = new Set();
  let accepted = 0;
  for (const selection of combinations(recipeNames(deploy), overlayNames(deploy))) {
    const result = spawnSync(shell, [resolver, "files", ...selection], { encoding: "utf8" });
    if (result.status !== 0) continue;
    accepted += 1;
    for (const file of result.stdout.split("\n").filter(Boolean)) emitted.add(file);
  }
  if (accepted === 0) throw new Error("the resolver accepted no combination, so nothing was derived");
  return [...emitted].sort();
}

const reference = "\u0000REF\u0000";

function substituted(text) {
  // Innermost first, so ${A:-${B:-x}} yields x; a reference with no value to offer becomes a marker.
  let previous;
  let current = text;
  do {
    previous = current;
    current = current.replace(/\$\{([^${}]*)\}/g, (_, inner) => {
      const offered = /^[A-Za-z_][A-Za-z0-9_]*:?[-+](.*)$/s.exec(inner);
      return offered ? offered[1] : reference;
    });
  } while (current !== previous);
  return current;
}

function volumeSource(entry) {
  if (typeof entry === "object" && entry !== null) {
    return entry.type === "bind" ? { source: entry.source, declared: true } : undefined;
  }
  if (typeof entry !== "string") return undefined;
  let depth = 0;
  for (let index = 0; index < entry.length; index += 1) {
    if (entry.startsWith("${", index)) depth += 1;
    else if (entry[index] === "}" && depth > 0) depth -= 1;
    else if (entry[index] === ":" && depth === 0) return { source: entry.slice(0, index) };
  }
  return undefined;
}

function shippedPath(file, bound) {
  if (typeof bound?.source !== "string") return undefined;
  const source = substituted(bound.source);
  if (source.includes(reference) || source.startsWith("/") || source.startsWith("~")) return undefined;
  // Compose reads a short-form source as a path only when it starts with a dot.
  if (!bound.declared && !source.startsWith(".")) return undefined;
  const path = posix.normalize(source);
  if (path === ".") throw new Error(`${file} binds the whole deployment directory`);
  if (path === ".." || path.startsWith("../")) {
    throw new Error(`${file} binds ${bound.source}, which climbs out of the deployment`);
  }
  return path;
}

function listed(value) {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value])
    .map((item) => (typeof item === "object" && item !== null ? item.path : item));
}

const unfollowed = ["extends", "include", "build"];

export function boundPaths(deploy, composeFiles) {
  const bound = new Set();
  const follow = (file, source, declared = true) => {
    const path = shippedPath(file, { source, declared });
    if (path) bound.add(path);
  };
  for (const file of composeFiles) {
    const model = YAML.parse(readFileSync(join(deploy, file), "utf8"), { logLevel: "silent" }) ?? {};
    if (model.include !== undefined) throw new Error(`${file} uses include, which the archive cannot follow`);
    for (const kind of ["secrets", "configs"]) {
      for (const item of Object.values(model[kind] ?? {})) follow(file, item?.file);
    }
    for (const volume of Object.values(model.volumes ?? {})) {
      if (/\bbind\b/.test(volume?.driver_opts?.o ?? "")) follow(file, volume.driver_opts.device);
    }
    for (const service of Object.values(model.services ?? {})) {
      for (const key of unfollowed) {
        if (service?.[key] !== undefined) throw new Error(`${file} uses ${key}, which the archive cannot follow`);
      }
      for (const key of ["env_file", "label_file"]) {
        for (const source of listed(service?.[key])) follow(file, source);
      }
      for (const volume of service?.volumes ?? []) {
        const entry = volumeSource(volume);
        if (entry) follow(file, entry.source, entry.declared ?? false);
      }
    }
  }
  return [...bound].sort();
}

function resolvedWithin(deploy, path) {
  const absolute = join(deploy, path);
  if (!existsSync(absolute)) throw new Error(`the deployment names ${path}, which does not exist`);
  // A symlink is read through its target, so the target is what has to lie inside the deployment.
  const resolved = realpathSync(absolute);
  if (!resolved.startsWith(realpathSync(deploy) + sep)) {
    throw new Error(`${path} resolves to ${resolved}, which is outside the deployment`);
  }
  return resolved;
}

function expand(deploy, path) {
  const resolved = resolvedWithin(deploy, path);
  if (!statSync(resolved).isDirectory()) return [{ path, resolved }];
  return readdirSync(resolved).flatMap((entry) => expand(deploy, posix.join(path, entry)));
}

export function archiveEntries(deploy) {
  const composeFiles = emittedComposeFiles(deploy);
  const recipes = recipeNames(deploy).map((name) => `recipes/${name}.recipe`);
  const declared = [...composeFiles, ...boundPaths(deploy, composeFiles), ...recipes, ...roots];
  const found = new Map(declared.flatMap((path) => expand(deploy, path))
    .map((file) => [file.path, file.resolved]));
  return [...found.keys()].sort().map((path) => {
    const content = readFileSync(found.get(path));
    return { path, mode: statSync(found.get(path)).mode & 0o111 ? 0o755 : 0o644, content };
  });
}

const signal = "(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|CREDENTIAL|SALT"
  + "|(?:API|PRIVATE|SECRET|ACCESS|SIGNING|ENCRYPTION|MASTER|AUTH)[_.-]?KEY)";
const secretName = `[A-Za-z0-9_.-]*${signal}(?:[_-]?(?:VALUE|HASH)|S)?`;
const assignment = new RegExp(`(?<![-/\\w.])["']?(${secretName})["']?[ \\t]*[:=][ \\t]*(\\S+)`, "gi");
const directive = new RegExp(`^[ \\t]*(${secretName})[ \\t]+(\\S+)`, "gim");
const privateKey = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/;
const urlCredential = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:([^\s@]+)@/gi;

export function refuseSecrets(entries) {
  for (const entry of entries) {
    const name = basename(entry.path);
    if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) {
      throw new Error(`${entry.path} is a filled-in environment file, and a release archive carries none`);
    }
    const text = substituted(entry.content.toString("utf8"));
    if (privateKey.test(text)) throw new Error(`${entry.path} carries a private key`);
    for (const [, secret] of text.matchAll(urlCredential)) {
      if (!carriesNothing("", secret)) throw new Error(`${entry.path} puts a credential in a URL`);
    }
    const rules = name.startsWith("Caddyfile") ? [assignment, directive] : [assignment];
    for (const rule of rules) {
      for (const [, assigned, value] of text.matchAll(rule)) {
        if (!carriesNothing(assigned, value)) {
          throw new Error(`${entry.path} assigns a credential: ${assigned}`);
        }
      }
    }
  }
}

const empty = new Set(["", "null", "[", "[]", "{", "{}", "|", ">"]);

function carriesNothing(name, value) {
  const bare = value.replace(/[,;)\]}]+$/, "").replace(/^["']+/, "").replace(/["']+$/, "");
  if (/_FILE$/i.test(name) || empty.has(bare) || bare === reference) return true;
  // A lowercase path of two or more segments names a file; a random value almost never has that shape.
  if (/^\/[a-z0-9._-]+(?:\/[a-z0-9._-]+)+$/.test(bare)) return true;
  return /^\$[A-Za-z_]\w*$/.test(bare) || bare.startsWith("$(") || /^!(?:reset|override)$/.test(bare)
    || bare.startsWith('{"')
    || /^\{\{[a-z]+\}\}$/.test(bare) || /^%\{env:[A-Za-z_]\w*\}%$/.test(bare);
}

function byPath(left, right) {
  // Code-unit order, because a locale comparison would tie the published bytes to an ICU version.
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function digestOf(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function manifestOf({ version, revision, image, repository, ref, entries }) {
  if (!/^[0-9a-f]{40}$/.test(revision ?? "")) throw new Error("the archive needs a full source revision");
  if (!/@sha256:[0-9a-f]{64}$/.test(image ?? "")) {
    throw new Error("the archive needs an image a digest pins, not a floating tag");
  }
  if (!/^[\w.+-]+$/.test(version ?? "")) throw new Error("the archive needs a plain version");
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
  const entries = archiveEntries(deploy);
  refuseSecrets(entries);
  const manifest = manifestOf({ version, revision, image, repository, ref, entries });
  const prefix = `courtside-deployment-${version}`;
  const carried = [...entries, { path: "manifest.json", mode: 0o644,
    content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") }]
    .sort(byPath)
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
