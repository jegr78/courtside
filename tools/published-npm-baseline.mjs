import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseVersion, precedence } from "./courtside.upgrade-smoke.mjs";
import { collectPublishedReleaseTags } from "./published-release-tags.mjs";

const run = promisify(execFile);

function releaseBuild(record) {
  return record?.sources?.find((source) => source.scope === "release-build");
}

function npmCompleted(record) {
  return releaseBuild(record)?.evidenceSources?.some((source) => source.scanner === "npm" && source.status === "completed") === true;
}

export async function choosePublishedBaseline({ subject, tags, isStrictAncestor, readRecord, commitOf, maxReleases = 20 }) {
  if (!/^[a-f0-9]{40}$/.test(subject ?? "")) throw new Error("subject must be an immutable commit SHA");
  const ordered = tags.map(parseVersion).filter(Boolean).sort((left, right) => precedence(right, left)).map((version) => version.tag);
  const inspected = [];
  for (const tag of ordered) {
    if (inspected.length === maxReleases) break;
    if (!await isStrictAncestor(tag)) {
      inspected.push({ tag, outcome: "not-an-ancestor" });
      continue;
    }
    const record = await readRecord(tag);
    if (!record) {
      inspected.push({ tag, outcome: "no-security-record" });
      continue;
    }
    if (releaseBuild(record)?.subject !== await commitOf(tag)) {
      inspected.push({ tag, outcome: "record-subject-mismatch" });
      continue;
    }
    if (!npmCompleted(record)) {
      inspected.push({ tag, outcome: "npm-audit-not-completed" });
      continue;
    }
    inspected.push({ tag, outcome: "chosen" });
    return { release: tag, inspected };
  }
  return { release: null, reason: "no-published-ancestor-with-completed-npm-audit", inspected };
}

export async function writePublishedBaseline({ directory, choice, show }) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const files = choice.release
    ? await Promise.all(["package.json", "package-lock.json"].map(async (name) => [name, await show(choice.release, `frontend/${name}`)]))
    : [];
  for (const [name, content] of files) writeFileSync(join(directory, name), content, { mode: 0o600 });
  writeFileSync(join(directory, "baseline.json"), `${JSON.stringify(choice, null, 2)}\n`, { mode: 0o600 });
}

function git(args, cwd) {
  return run("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export async function strictAncestor(tag, subject, cwd) {
  const { stdout } = await git(["rev-parse", `${tag}^{commit}`], cwd);
  if (stdout.trim() === subject) return false;
  try {
    await git(["merge-base", "--is-ancestor", `${tag}^{commit}`, subject], cwd);
    return true;
  } catch (failure) {
    if (failure.code === 1) return false;
    throw failure;
  }
}

export async function securityRecord({ repository, token, apiUrl, tag, request }) {
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
  const root = `${new URL(apiUrl).href.replace(/\/+$/, "")}/`;
  const release = await request(new URL(`repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, root), { headers });
  if (release.status !== 200) throw new Error(`GitHub release ${tag} returned HTTP ${release.status}`);
  const asset = (await release.json()).assets?.find((candidate) => candidate.name === "security-record.json");
  if (!asset) return null;
  const download = await request(new URL(`repos/${repository}/releases/assets/${asset.id}`, root),
    { headers: { ...headers, Accept: "application/octet-stream" } });
  if (download.status !== 200) throw new Error(`GitHub release asset for ${tag} returned HTTP ${download.status}`);
  return JSON.parse(await download.text());
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!["--subject", "--directory"].includes(args[index]) || !args[index + 1]) {
      throw new Error("Usage: published-npm-baseline.mjs --subject <commit> --directory <path>");
    }
    values[args[index].slice(2)] = args[index + 1];
  }
  if (!values.subject || !values.directory) throw new Error("Usage: published-npm-baseline.mjs --subject <commit> --directory <path>");
  return values;
}

export async function execute(args, environment = process.env, request = fetch, cwd = process.cwd(), output = process.stdout) {
  const { subject, directory } = parseArguments(args);
  const repository = environment.GITHUB_REPOSITORY;
  const token = environment.GITHUB_TOKEN ?? environment.GH_TOKEN;
  const apiUrl = environment.GITHUB_API_URL ?? "https://api.github.com";
  const show = async (tag, path) => (await git(["show", `${tag}:${path}`], cwd)).stdout;
  let choice;
  try {
    const tags = await collectPublishedReleaseTags({ repository, token, apiUrl, request });
    choice = await choosePublishedBaseline({
      subject, tags,
      isStrictAncestor: (tag) => strictAncestor(tag, subject, cwd),
      commitOf: async (tag) => (await git(["rev-parse", `${tag}^{commit}`], cwd)).stdout.trim(),
      readRecord: (tag) => securityRecord({ repository, token, apiUrl, tag, request })
    });
    await writePublishedBaseline({ directory, choice, show });
  } catch (failure) {
    choice = { release: null, reason: "baseline-unavailable", detail: failure.message.slice(0, 300), inspected: choice?.inspected ?? [] };
    await writePublishedBaseline({ directory, choice, show });
  }
  output.write(`npm baseline: ${choice.release ?? `none (${choice.reason}${choice.detail ? `: ${choice.detail}` : ""})`}\n`);
  return choice;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await execute(process.argv.slice(2));
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = 1;
  }
}
