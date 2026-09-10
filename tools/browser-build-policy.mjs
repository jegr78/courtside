import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { parse } = require("acorn");

const inventory = JSON.parse(readFileSync(
  new URL("../security/published-web-resources.json", import.meta.url), "utf8"));
const reviewedResources = inventory.buildResources.map(({ pattern, class: kind }) =>
  ({ expression: new RegExp(pattern), kind }));
const reviewedOrigins = new Set(inventory.reviewedOrigins.map(({ host }) => host));
const reviewedComments = new Set(inventory.reviewedComments.map(({ text }) => text));
const absentMetadata = new Set(inventory.absentMetadata.map((name) => name.toLowerCase()));
const forbiddenText = [...inventory.credentialPatterns, ...inventory.disclosureMarkers]
  .map(({ id, pattern }) => ({ id, expression: new RegExp(pattern) }));
const origin = /https?:\/\/([A-Za-z0-9.-]+(?::[0-9]+)?)/g;
const markup = /<!--([\s\S]*?)-->/g;
const styleComment = /\/\*([\s\S]*?)\*\//g;

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

export function browserBuildFileName(path) {
  return path.split(/[\\/]/).at(-1);
}

export function browserBuildResource(path, root) {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/$/, "");
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return relative(root, path).replaceAll("\\", "/");
}

export function browserBuildClass(resource) {
  return reviewedResources.find(({ expression }) => expression.test(resource))?.kind;
}

export function browserBuildComments(resource, source) {
  if (resource.endsWith(".js")) {
    const comments = [];
    for (const sourceType of ["module", "script"]) {
      try {
        parse(source, { ecmaVersion: "latest", sourceType, onComment: comments, allowHashBang: true });
        return comments.map(({ value }) => value.trim());
      } catch {
        comments.length = 0;
      }
    }
    throw new Error(`The browser build ships ${resource}, which no parser reads as JavaScript`);
  }
  const expression = resource.endsWith(".css") ? styleComment : markup;
  return [...source.matchAll(expression)].map(([, text]) => text.trim());
}

export function browserBuildOrigins(source) {
  return [...source.matchAll(origin)].map(([, host]) => host);
}

export function browserBuildInventoryGaps(directory) {
  const root = resolve(directory);
  const resources = filesBelow(root).map((path) => browserBuildResource(path, root));
  return inventory.buildResources
    .filter(({ pattern }) => !resources.some((resource) => new RegExp(pattern).test(resource)))
    .map(({ id }) => id);
}

export function verifyBrowserBuild(directory) {
  const root = resolve(directory);
  if (!existsSync(root) || !statSync(root).isDirectory() || !existsSync(resolve(root, "index.html"))) {
    throw new Error("The browser build has no index.html");
  }
  const files = filesBelow(root);
  const maps = files.filter((path) => path.endsWith(".map"));
  if (maps.length > 0) throw new Error("The browser build contains source maps");
  const metadata = files.filter((path) => absentMetadata.has(browserBuildFileName(path).toLowerCase())
    || absentMetadata.has(browserBuildResource(path, root).toLowerCase()));
  if (metadata.length > 0) throw new Error("The browser build contains an unreviewed metadata resource");
  for (const path of files) {
    const resource = browserBuildResource(path, root);
    const kind = browserBuildClass(resource);
    if (kind === undefined) throw new Error("The browser build contains an unreviewed public resource");
    const source = readFileSync(path, "utf8");
    const marker = forbiddenText.find(({ expression }) => expression.test(source));
    if (marker !== undefined) {
      throw new Error(`The browser build contains ${marker.id} material in ${resource}`);
    }
    if (kind === "font") continue;
    const unreviewedComment = browserBuildComments(resource, source)
      .find((text) => !reviewedComments.has(text));
    if (unreviewedComment !== undefined) {
      throw new Error(`The browser build ships an unreviewed comment in ${resource}`);
    }
    const unreviewedOrigin = browserBuildOrigins(source).find((host) => !reviewedOrigins.has(host));
    if (unreviewedOrigin !== undefined) {
      throw new Error(`The browser build names the unreviewed origin ${unreviewedOrigin} in ${resource}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error("Usage: browser-build-policy.mjs <build-directory>");
  verifyBrowserBuild(process.argv[2]);
}
