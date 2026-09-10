import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
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
const inlineScript = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const inlineStyle = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const commentOpener = "<!--";
const javascriptType = /^(?:module|text\/javascript|application\/javascript|text\/ecmascript)$/i;
const scriptType = /\stype\s*=\s*["']?([^"'>\s]+)/i;

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error("Usage: browser-build-policy.mjs <build-directory>");
  verifyBrowserBuild(process.argv[2]);
}
