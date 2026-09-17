import { fileURLToPath } from "node:url";
import { publishedTags } from "./courtside.upgrade-smoke.mjs";

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

export async function collectPublishedReleaseTags({ repository, token,
  apiUrl = "https://api.github.com", request = fetch }) {
  required(repository, "GitHub repository");
  required(token, "GitHub token");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GitHub repository is invalid");
  }
  const base = new URL(apiUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("GitHub API URL must be an HTTPS base URL");
  }
  const root = `${base.href.replace(/\/+$/, "")}/`;
  const releases = [];
  for (let page = 1; page <= 100; page += 1) {
    const endpoint = new URL(`repos/${repository}/releases`, root);
    endpoint.searchParams.set("per_page", "100");
    endpoint.searchParams.set("page", String(page));
    const response = await request(endpoint, { headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    } });
    if (response.status !== 200) throw new Error(`GitHub releases API returned HTTP ${response.status}`);
    const records = await response.json();
    if (!Array.isArray(records)) throw new Error("GitHub releases response must be an array");
    for (const release of records) {
      if (typeof release?.tag_name !== "string" || typeof release?.draft !== "boolean") {
        throw new Error("GitHub release metadata is malformed");
      }
    }
    releases.push(...records);
    if (records.length < 100) return publishedTags(releases);
  }
  throw new Error("GitHub release history exceeded 100 pages");
}

export async function execute(environment = process.env, request = fetch, output = process.stdout) {
  const tags = await collectPublishedReleaseTags({
    repository: environment.GITHUB_REPOSITORY,
    token: environment.GITHUB_TOKEN ?? environment.GH_TOKEN,
    apiUrl: environment.GITHUB_API_URL,
    request
  });
  output.write(`${JSON.stringify(tags)}\n`);
  return tags;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await execute();
