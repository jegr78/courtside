import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const documentationTests = [
  "tools/docs-check.test.mjs",
  "tools/github-template-metadata.test.mjs",
  "tools/quality-strategy.test.mjs",
  "tools/post-merge-policy.test.mjs",
  "tools/test-profile-contract.test.mjs"
];

export function checkDocumentation(root, inventory = markdownFiles) {
  const files = inventory(root);
  const documents = new Map(files.map((path) => [path, readFileSync(join(root, path), "utf8")]));
  for (const [path, source] of documents) {
    const prose = validateMarkdown(path, source);
    validateLinks(root, path, prose, documents);
  }
}

function markdownFiles(root) {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"], {
    cwd: root, encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"]
  }).split("\n").filter(Boolean).sort();
}

function validateMarkdown(path, source) {
  if (source.includes("\r")) throw new Error(`${path} does not use LF line endings`);
  if (!source.endsWith("\n")) throw new Error(`${path} lacks a final newline`);
  let fence = null;
  const prose = source.split("\n").map((line) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1];
    if (fence === null && marker !== undefined) {
      fence = marker;
      return "";
    }
    if (fence !== null) {
      const closing = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/u)?.[1];
      if (closing?.[0] === fence[0] && closing.length >= fence.length) fence = null;
      return "";
    }
    return line;
  }).join("\n");
  if (fence !== null) throw new Error(`${path} has an unclosed code fence`);
  return prose.replace(/(`+)[\s\S]*?\1/gu, "");
}

function validateLinks(root, sourcePath, source, documents) {
  const definitions = new Map([...source.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)]
    .map((match) => [match[1].trim().toLowerCase(), match[2] ?? match[3]]));
  const withoutDefinitions = source.replace(/^\s{0,3}\[[^\]]+\]:.*$/gm, "");
  const targets = [];
  for (const match of withoutDefinitions.matchAll(/!?\[([^\]]+)\](?:\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)|\[([^\]]*)\])?/g)) {
    if (match[2] !== undefined || match[3] !== undefined) {
      targets.push(match[2] ?? match[3]);
      continue;
    }
    const reference = (match[4] || match[1]).trim().toLowerCase();
    const target = definitions.get(reference);
    if (target === undefined && match[4] === undefined) continue;
    if (target === undefined) throw new Error(`${sourcePath} uses an undefined link reference`);
    targets.push(target);
  }
  for (const target of targets) {
    if (/^(?:https?:|mailto:)/.test(target)) continue;
    const [rawPath, rawFragment] = target.split("#", 2);
    const decodedPath = decodeURIComponent(rawPath);
    const resolved = normalize(join(dirname(sourcePath), decodedPath || "."));
    if (resolved.startsWith("..") || resolve(root, resolved) === root && decodedPath !== "") {
      throw new Error(`${sourcePath} links outside the repository`);
    }
    const repositoryPath = decodedPath === "" ? sourcePath : resolved.replaceAll("\\", "/");
    const document = documents.get(repositoryPath);
    if (document === undefined && !existsSync(join(root, repositoryPath))) {
      throw new Error(`${sourcePath} links to ${repositoryPath}, which does not exist`);
    }
    if (rawFragment && document !== undefined && !headingAnchors(document).has(decodeURIComponent(rawFragment))) {
      throw new Error(`${sourcePath} links to missing anchor ${rawFragment} in ${repositoryPath}`);
    }
  }
}

function headingAnchors(source) {
  return new Set(source.split("\n").filter((line) => /^#{1,6}\s+/.test(line)).map((line) => line
    .replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-")));
}

function main() {
  if (process.argv.includes("--check")) {
    checkDocumentation(repository);
    execFileSync(process.execPath, ["--test", ...documentationTests],
      { cwd: repository, shell: false, stdio: "inherit" });
  }
  else throw new Error("Use --check");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
