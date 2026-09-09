import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const forbiddenMetadata = new Set([
  "ads.txt", "clientaccesspolicy.xml", "crossdomain.xml", "humans.txt", "robots.txt",
  "security.txt", "sitemap.xml"
]);
const forbiddenText = /[#@]\s*sourceMappingURL=|-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|\b(?:TODO|FIXME|XXX)\b|(?:file:\/\/\/(?:Users|home|workspace)\/|[A-Za-z]:\\Users\\)|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{20,}\b/;

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

function isReviewedResource(path) {
  if (["font-licenses.txt", "icon.svg", "index.html", "sw.js"].includes(path)) return true;
  if (/^workbox-[A-Za-z0-9_-]+\.js$/.test(path)) return true;
  return /^assets\/[A-Za-z0-9._-]+\.(?:css|js|woff2)$/.test(path);
}

export function verifyBrowserBuild(directory) {
  const root = resolve(directory);
  if (!existsSync(root) || !statSync(root).isDirectory() || !existsSync(resolve(root, "index.html"))) {
    throw new Error("The browser build has no index.html");
  }
  const files = filesBelow(root);
  const maps = files.filter((path) => path.endsWith(".map"));
  if (maps.length > 0) throw new Error("The browser build contains source maps");
  const resources = files.map((path) => browserBuildResource(path, root));
  const unreviewed = resources.filter((path) => !isReviewedResource(path));
  if (unreviewed.length > 0) throw new Error("The browser build contains an unreviewed public resource");
  const metadata = files.filter((path) => forbiddenMetadata.has(browserBuildFileName(path).toLowerCase()));
  if (metadata.length > 0) throw new Error("The browser build contains an unreviewed metadata resource");
  for (const path of files) {
    if (forbiddenText.test(readFileSync(path, "utf8"))) {
      throw new Error("The browser build contains debug, host-path or secret material");
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error("Usage: browser-build-policy.mjs <build-directory>");
  verifyBrowserBuild(process.argv[2]);
}
