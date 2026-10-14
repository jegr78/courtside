import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const BACKEND_SHARDS = 2;

const SUREFIRE_DEFAULT_INCLUDES = [/^Test[^/]*\.java$/, /Test\.java$/, /Tests\.java$/, /TestCase\.java$/];

export function backendTestClasses(root) {
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"));
  return files
    .filter((path) => SUREFIRE_DEFAULT_INCLUDES.some((pattern) => pattern.test(path.split("/").at(-1))))
    .map((path) => ({ path, source: readFileSync(join(root, path), "utf8") }))
    .filter(({ path, source }) => !isAbstract(path, source))
    .map(({ path, source }) => classPath(path, source))
    .toSorted();
}

function isAbstract(path, source) {
  const name = path.split("/").at(-1).replace(/\.java$/, "");
  return new RegExp(`\\babstract\\s+(?:[a-z-]+\\s+)*class\\s+${name}\\b`).test(source);
}

// Surefire matches the compiled class, so a source filed under another directory goes by its package.
function classPath(path, source) {
  const declared = /^\s*package\s+([\w.]+)\s*;/m.exec(source)?.[1];
  const file = path.split("/").at(-1);
  return declared === undefined ? path : `${declared.replaceAll(".", "/")}/${file}`;
}

// Contiguous blocks keep a package's classes, which tend to share a Spring context, in one JVM.
export function backendShard(classes, current, total) {
  const size = Math.ceil(classes.length / total);
  return classes.slice((current - 1) * size, current * size);
}

export function parseShard(value) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value ?? "");
  const current = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || total !== BACKEND_SHARDS || current > total) {
    throw new Error(`${value} is not a backend shard of ${BACKEND_SHARDS}`);
  }
  return { current, total };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { current, total } = parseShard(process.argv[2]);
  const root = fileURLToPath(new URL("../src/test/java", import.meta.url));
  process.stdout.write(`${backendShard(backendTestClasses(root), current, total).join("\n")}\n`);
}
