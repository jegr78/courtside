import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { posix, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { parse } = require("acorn");

const inventory = JSON.parse(readFileSync(
  new URL("../security/published-web-resources.json", import.meta.url), "utf8"));
const reviewedResources = inventory.buildResources.map(({ id, pattern, class: kind }) =>
  ({ id, expression: new RegExp(pattern), kind }));
const reviewedOrigins = new Set(inventory.reviewedOrigins.map(({ host }) => host));
const reviewedComments = new Set(inventory.reviewedComments.map(({ text }) => text));
const absentMetadata = new Set(inventory.absentMetadata.map((name) => name.toLowerCase()));
const forbiddenText = [...inventory.credentialPatterns, ...inventory.disclosureMarkers]
  .map(({ id, pattern }) => ({ id, expression: new RegExp(pattern) }));
const origin = /(?:https?|wss?):\/\/[^\s"'`)\\<>,;\]}]+/gi;
const schemeless = /(?:^|[^:/A-Za-z0-9.])(\/\/[A-Za-z0-9][A-Za-z0-9.@:_-]*)/g;
const escapedSlash = /\\\//g;
const numericEntity = /&#([0-9]{1,7});/g;
const styleComment = /\/\*([\s\S]*?)\*\//g;
const inlineScript = /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;
const inlineStyle = /<style\b[^>]*>([\s\S]*?)<\/style\b[^>]*>/gi;
const commentOpener = "<!--";
const javascriptType = /^(?:module|text\/javascript|application\/javascript|text\/ecmascript)$/i;
const scriptType = /\stype\s*=\s*["']?([^"'>\s]+)/i;
const moduleEntry = /<script\b[^>]*\btype\s*=\s*["']?module["']?[^>]*\bsrc\s*=\s*["']?\/?([^"'>\s]+)/gi;
const precacheEntry = /\{\s*url\s*:\s*"([^"]+)"/g;
const administrationMarker = /^admin-/;
const localeBundleKey = "app.name";

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

function scriptComments(resource, source) {
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

function styleComments(source) {
  return [...source.matchAll(styleComment)].map(([, text]) => text.trim());
}

export function browserBuildMarkupComments(source) {
  const comments = [];
  let cursor = source.indexOf(commentOpener);
  while (cursor >= 0) {
    const body = cursor + commentOpener.length;
    const remainder = source.slice(body);
    // A parser closes a comment on "-->" and on "--!>", and "<!-->" and "<!--->" are already closed.
    const terminator = /^-?>/.exec(remainder) ?? /--!?>/.exec(remainder);
    if (terminator === null) {
      comments.push(remainder.trim());
      return comments;
    }
    const end = body + terminator.index + terminator[0].length;
    comments.push(source.slice(body, end - terminator[0].length).trim());
    cursor = source.indexOf(commentOpener, end);
  }
  return comments;
}

export function browserBuildComments(resource, source) {
  if (resource.endsWith(".js")) return scriptComments(resource, source);
  if (resource.endsWith(".css")) return styleComments(source);
  const embedded = [
    ...[...source.matchAll(inlineScript)]
      .filter(([, attributes]) => isJavaScript(attributes))
      .flatMap(([, , body]) => scriptComments(resource, body)),
    ...[...source.matchAll(inlineStyle)].flatMap(([, body]) => styleComments(body))
  ];
  return [...browserBuildMarkupComments(source), ...embedded];
}

function isJavaScript(attributes) {
  const declared = scriptType.exec(attributes);
  return declared === null || javascriptType.test(declared[1]);
}

function hostOf(reference) {
  try {
    return new URL(reference).hostname;
  } catch {
    return null;
  }
}

export function browserBuildReadableText(source) {
  return source.replaceAll(escapedSlash, "/")
    .replaceAll(numericEntity, (whole, code) => String.fromCodePoint(Number(code)));
}

export function browserBuildOrigins(source) {
  const text = browserBuildReadableText(source);
  return [
    ...[...text.matchAll(origin)].map(([reference]) => hostOf(reference)),
    ...[...text.matchAll(schemeless)].map(([, authority]) => hostOf(`https:${authority}`))
  ].filter((host) => host !== null && host !== "");
}

export function browserBuildInventoryGaps(directory) {
  const root = resolve(directory);
  const resources = filesBelow(root).map((path) => browserBuildResource(path, root));
  return reviewedResources
    .filter(({ expression }) => !resources.some((resource) => expression.test(resource)))
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

function scriptTree(source) {
  return parse(source, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true });
}

function nodesOf(tree) {
  const nodes = [];
  const pending = [tree];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...node);
    } else if (node !== null && typeof node === "object") {
      if (typeof node.type === "string") nodes.push(node);
      pending.push(...Object.values(node));
    }
  }
  return nodes;
}

function stringValue(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}

function chunkReading(resource, source) {
  const nodes = nodesOf(scriptTree(source));
  const staticImports = nodes
    .filter(({ type, source: from }) => ["ImportDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration"]
      .includes(type) && from?.type === "Literal")
    .map(({ source: from }) => posix.join(posix.dirname(resource), from.value));
  const administration = nodes.map(stringValue)
    .filter((value) => value !== undefined && administrationMarker.test(value));
  const localeBundles = nodes.filter(({ type, properties }) => type === "ObjectExpression"
    && properties.some(({ key }) => key && stringValue(key) === localeBundleKey)).length;
  return { staticImports, administration, localeBundles };
}

// The entry chunk and every chunk it imports statically are what a member downloads before the first paint.
export function verifyMemberSurface(directory) {
  const root = resolve(directory);
  const shell = readFileSync(resolve(root, "index.html"), "utf8");
  const entries = [...shell.matchAll(moduleEntry)].map(([, path]) => path);
  if (entries.length !== 1) throw new Error("The browser build has no module entry script");
  const chunks = new Map(filesBelow(root)
    .map((path) => browserBuildResource(path, root))
    .filter((resource) => resource.startsWith("assets/") && resource.endsWith(".js"))
    .map((resource) => [resource, chunkReading(resource, readFileSync(resolve(root, resource), "utf8"))]));
  const memberSurface = new Set();
  const pending = [entries[0]];
  while (pending.length > 0) {
    const resource = pending.pop();
    if (memberSurface.has(resource)) continue;
    const chunk = chunks.get(resource);
    if (chunk === undefined) throw new Error(`The member entry imports ${resource}, which the build does not ship`);
    memberSurface.add(resource);
    pending.push(...chunk.staticImports);
  }
  for (const resource of memberSurface) {
    const [marker] = chunks.get(resource).administration;
    if (marker !== undefined) {
      throw new Error(`The member entry carries the administration surface: ${marker} in ${resource}`);
    }
  }
  const entryLocales = [...memberSurface].reduce((sum, resource) => sum + chunks.get(resource).localeBundles, 0);
  if (entryLocales !== 1) {
    throw new Error(`The member entry carries ${entryLocales} locale bundles instead of the default one`);
  }
  const deferred = [...chunks.keys()].filter((resource) => !memberSurface.has(resource));
  const administration = deferred.filter((resource) => chunks.get(resource).administration.length > 0);
  if (administration.length === 0) throw new Error("The browser build no longer identifies its administration surface");
  const locales = deferred.filter((resource) => chunks.get(resource).localeBundles > 0);
  if (locales.length === 0) throw new Error("The browser build ships no locale bundle outside the member entry");
  const worker = resolve(root, "sw.js");
  const precached = new Set(existsSync(worker)
    ? [...readFileSync(worker, "utf8").matchAll(precacheEntry)].map(([, url]) => url) : []);
  if (precached.size === 0) throw new Error("The browser build has no precache manifest");
  const cachedAdministration = administration.find((resource) => precached.has(resource));
  if (cachedAdministration !== undefined) {
    throw new Error(`The precache holds the administration surface in ${cachedAdministration}`);
  }
  const missing = [...memberSurface, ...locales].find((resource) => !precached.has(resource));
  if (missing !== undefined) throw new Error(`The precache misses ${missing}, which the member surface needs offline`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error("Usage: browser-build-policy.mjs <build-directory>");
  verifyBrowserBuild(process.argv[2]);
  verifyMemberSurface(process.argv[2]);
}
