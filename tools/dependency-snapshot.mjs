import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const developmentScopes = new Set(["test", "provided", "system"]);
const runtimeScopes = new Set(["compile", "runtime"]);

export function parseDependencyList(text) {
  if (typeof text !== "string") throw new Error("dependency list is invalid");
  return text.split("\n").map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith(":"))
    .map((line) => {
      const fields = line.split(" ")[0].split(":");
      if (fields.length < 5 || fields.length > 6 || fields.some((field) => field.length === 0)) {
        throw new Error(`dependency "${line}" is not a coordinate`);
      }
      const [group, artifact] = fields;
      const scope = fields.at(-1);
      const version = fields.at(-2);
      if (!developmentScopes.has(scope) && !runtimeScopes.has(scope)) {
        throw new Error(`dependency "${line}" has an unknown scope`);
      }
      return { group, artifact, version, scope };
    });
}

export function packageUrl({ group, artifact, version }) {
  return `pkg:maven/${encodeURIComponent(group)}/${encodeURIComponent(artifact)}@${encodeURIComponent(version)}`;
}

export function buildSnapshot({ resolved, direct, sha, ref, runId, correlator, repository, scanned }) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("snapshot sha is invalid");
  if (!/^refs\/[A-Za-z0-9/_.-]+$/.test(ref ?? "")) throw new Error("snapshot ref is invalid");
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error("snapshot run is invalid");
  if (!/^[A-Za-z0-9 _./-]{1,200}$/.test(correlator ?? "")) throw new Error("snapshot correlator is invalid");
  if (resolved.length === 0) throw new Error("snapshot resolves no dependency");
  const declared = new Set(direct.map((entry) => `${entry.group}:${entry.artifact}`));
  return {
    version: 0,
    job: { id: `${runId}`, correlator },
    sha,
    ref,
    detector: {
      name: "courtside-maven-snapshot",
      version: "1.0.0",
      url: `https://github.com/${repository}/blob/main/tools/dependency-snapshot.mjs`
    },
    scanned,
    manifests: {
      "pom.xml": {
        name: "pom.xml",
        file: { source_location: "pom.xml" },
        resolved: Object.fromEntries(resolved.map((entry) => [`${entry.group}:${entry.artifact}`, {
          package_url: packageUrl(entry),
          relationship: declared.has(`${entry.group}:${entry.artifact}`) ? "direct" : "indirect",
          scope: developmentScopes.has(entry.scope) ? "development" : "runtime"
        }]))
      }
    }
  };
}

async function submit(snapshot, repository, token, send = fetch) {
  const response = await send(`https://api.github.com/repos/${repository}/dependency-graph/snapshots`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify(snapshot)
  });
  if (response.status !== 201) throw new Error(`GitHub API returned ${response.status}`);
  return response;
}

async function main(args) {
  const values = Object.fromEntries(args.reduce((pairs, value, index) => {
    if (index % 2 === 0) pairs.push([value, args[index + 1]]);
    return pairs;
  }, []));
  const repository = values["--repository"];
  const token = process.env.GH_TOKEN;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") || !token) {
    throw new Error("repository and GH_TOKEN are required");
  }
  const snapshot = buildSnapshot({
    resolved: parseDependencyList(readFileSync(values["--resolved"], "utf8")),
    direct: parseDependencyList(readFileSync(values["--direct"], "utf8")),
    sha: values["--sha"],
    ref: values["--ref"],
    runId: Number(values["--run-id"]),
    correlator: values["--correlator"],
    repository,
    scanned: new Date().toISOString()
  });
  await submit(snapshot, repository, token);
  process.stdout.write(`submitted ${Object.keys(snapshot.manifests["pom.xml"].resolved).length} dependencies\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
