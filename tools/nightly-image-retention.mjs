import { pathToFileURL } from "node:url";

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const datedTagPattern = /^nightly-\d{8}-[a-f0-9]{7}$/;
const releaseCandidateTagPattern = /^release-candidate-[a-f0-9]{40}$/;
const attachmentTagPattern = /^sha256-([a-f0-9]{64})(?:\.(?:att|sbom|sig))?$/;
const oneDay = 86_400_000;
const releaseEvidenceWindow = 14 * oneDay;

function timestamp(value, field) {
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const parsed = new Date(value);
  const canonical = match === null ? "" : `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== canonical) {
    throw new Error(`${field} is invalid`);
  }
  return parsed;
}

function validateVersions(versions) {
  if (!Array.isArray(versions)) throw new Error("versions are invalid");
  const ids = new Set();
  const digests = new Set();
  const tags = new Set();
  for (const item of versions) {
    if (!Number.isSafeInteger(item?.id) || item.id < 1 || ids.has(item.id)) {
      throw new Error("version id is invalid or duplicated");
    }
    if (!digestPattern.test(item.digest ?? "") || digests.has(item.digest)) {
      throw new Error("version digest is invalid or duplicated");
    }
    if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== "string" || tag.length === 0)) {
      throw new Error(`version ${item.id} tags are invalid`);
    }
    if (item.tags.some((tag) => tags.has(tag)) || new Set(item.tags).size !== item.tags.length) {
      throw new Error(`version ${item.id} tags are duplicated`);
    }
    timestamp(item.updatedAt, `version ${item.id} updatedAt`);
    ids.add(item.id);
    digests.add(item.digest);
    item.tags.forEach((tag) => tags.add(tag));
  }
}

function sortedIds(values) {
  return [...values].sort((left, right) => left - right);
}

function manifestOf(manifests, digest) {
  const manifest = manifests[digest];
  if (manifest === null || typeof manifest !== "object" || !Array.isArray(manifest.children)
      || (manifest.subject !== undefined && manifest.subject !== null
        && !digestPattern.test(manifest.subject))) {
    throw new Error(`manifest ${digest} is unavailable`);
  }
  return manifest;
}

export function planNightlyImageRetention({ versions, manifests, now }) {
  validateVersions(versions);
  if (manifests === null || typeof manifests !== "object" || Array.isArray(manifests)) {
    throw new Error("manifests are invalid");
  }
  const observedAt = timestamp(now, "now");
  const keptDatedTags = versions.flatMap(({ tags, updatedAt }) => tags
    .filter((tag) => datedTagPattern.test(tag))
    .map((tag) => ({ tag, updatedAt: timestamp(updatedAt, "version updatedAt").valueOf() })))
    .toSorted((left, right) => right.updatedAt - left.updatedAt || right.tag.localeCompare(left.tag))
    .slice(0, 7)
    .map(({ tag }) => tag);
  const keptDated = new Set(keptDatedTags);
  const byDigest = new Map(versions.map((version) => [version.digest, version]));
  const releaseCandidateCutoff = observedAt.valueOf() - releaseEvidenceWindow;
  const keptDigests = new Set(versions.filter(({ tags, updatedAt }) => tags.some((tag) =>
    tag === "nightly" || tag === "nightly-candidate" || keptDated.has(tag)
      || (releaseCandidateTagPattern.test(tag)
        && timestamp(updatedAt, "version updatedAt").valueOf() >= releaseCandidateCutoff)
      || (!tag.startsWith("nightly") && !tag.startsWith("release-candidate-")
        && !attachmentTagPattern.test(tag))))
    .map(({ digest }) => digest));

  let changed = true;
  while (changed) {
    changed = false;
    for (const digest of [...keptDigests]) {
      const manifest = manifestOf(manifests, digest);
      for (const child of manifest.children) {
        if (!digestPattern.test(child) || !byDigest.has(child)) {
          throw new Error(`manifest ${digest} has an unknown child ${child}`);
        }
        if (!keptDigests.has(child)) {
          keptDigests.add(child);
          changed = true;
        }
      }
    }
    for (const version of versions) {
      const subject = manifestOf(manifests, version.digest).subject;
      const signsKeptDigest = version.tags.some((tag) => {
        const taggedSubject = attachmentTagPattern.exec(tag)?.[1];
        return taggedSubject !== undefined && keptDigests.has(`sha256:${taggedSubject}`);
      });
      if ((signsKeptDigest || (subject && keptDigests.has(subject))) && !keptDigests.has(version.digest)) {
        keptDigests.add(version.digest);
        changed = true;
      }
    }
  }

  const keepVersionIds = sortedIds(versions.filter(({ digest }) => keptDigests.has(digest)).map(({ id }) => id));
  const cutoff = observedAt.valueOf() - oneDay;
  const candidates = sortedIds(versions.filter(({ digest, updatedAt }) =>
    !keptDigests.has(digest) && timestamp(updatedAt, "version updatedAt").valueOf() < cutoff)
    .map(({ id }) => id));
  return { keptDatedTags, keepVersionIds, plannedDeletionCount: candidates.length,
    deleteVersionIds: candidates };
}

function argumentsOf(args) {
  const options = { apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply" && options.apply === false) {
      options.apply = true;
      continue;
    }
    if (!["--repository", "--package", "--now"].includes(argument) || options[argument.slice(2)] !== undefined
        || index + 1 >= args.length) {
      throw new Error("arguments are invalid");
    }
    options[argument.slice(2)] = args[index + 1];
    index += 1;
  }
  return options;
}

function githubHeaders(token) {
  return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28" };
}

async function responseJson(response, context) {
  if (!response.ok) throw new Error(`${context} returned ${response.status}`);
  return response.json();
}

async function packageVersions({ owner, ownerKind, packageName, token }) {
  const versions = [];
  for (let page = 1; ; page += 1) {
    const endpoint = `https://api.github.com/${ownerKind}/${encodeURIComponent(owner)}`
      + `/packages/container/${encodeURIComponent(packageName)}/versions?per_page=100&page=${page}`;
    const records = await responseJson(await fetch(endpoint, { headers: githubHeaders(token) }),
      "GitHub package versions");
    if (!Array.isArray(records)) throw new Error("GitHub package versions are invalid");
    versions.push(...records.map((record) => ({ id: record.id, digest: record.name,
      tags: record.metadata?.container?.tags ?? [], updatedAt: record.updated_at })));
    if (records.length < 100) return versions;
  }
}

async function registryBearer({ owner, packageName, actor, token }) {
  const endpoint = "https://ghcr.io/token?service=ghcr.io&scope="
    + encodeURIComponent(`repository:${owner}/${packageName}:pull`);
  const authorization = Buffer.from(`${actor}:${token}`, "utf8").toString("base64");
  const response = await responseJson(await fetch(endpoint,
    { headers: { Authorization: `Basic ${authorization}` } }), "GHCR token request");
  if (typeof response.token !== "string" || response.token.length === 0) {
    throw new Error("GHCR token response is invalid");
  }
  return response.token;
}

async function registryManifests({ owner, packageName, versions, bearer }) {
  const result = {};
  const accept = ["application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json"].join(", ");
  for (const { digest } of versions) {
    const endpoint = `https://ghcr.io/v2/${owner}/${packageName}/manifests/${digest}`;
    const manifest = await responseJson(await fetch(endpoint,
      { headers: { Accept: accept, Authorization: `Bearer ${bearer}` } }), `GHCR manifest ${digest}`);
    result[digest] = {
      children: (manifest.manifests ?? []).map(({ digest: child }) => child),
      subject: manifest.subject?.digest ?? null,
    };
  }
  return result;
}

function versionSnapshot(versions) {
  validateVersions(versions);
  return JSON.stringify(versions.map(({ id, digest, tags, updatedAt }) =>
    ({ id, digest, tags: [...tags].toSorted(), updatedAt })).toSorted((left, right) => left.id - right.id));
}

export async function applyDeletionPlan({ expectedVersions, deleteVersionIds, loadVersions, deleteVersion }) {
  let expected = [...expectedVersions];
  for (const id of deleteVersionIds) {
    const observed = await loadVersions();
    if (versionSnapshot(observed) !== versionSnapshot(expected)) {
      throw new Error("registry changed after retention planning");
    }
    await deleteVersion(id);
    expected = expected.filter((version) => version.id !== id);
  }
}

async function deleteVersions({ owner, ownerKind, packageName, token, versions, ids }) {
  const deleteVersion = async (id) => {
    const endpoint = `https://api.github.com/${ownerKind}/${encodeURIComponent(owner)}`
      + `/packages/container/${encodeURIComponent(packageName)}/versions/${id}`;
    const response = await fetch(endpoint, { method: "DELETE", headers: githubHeaders(token) });
    if (response.status !== 204) throw new Error(`deleting package version ${id} returned ${response.status}`);
  };
  await applyDeletionPlan({ expectedVersions: versions, deleteVersionIds: ids,
    loadVersions: () => packageVersions({ owner, ownerKind, packageName, token }), deleteVersion });
}

async function main(args) {
  const options = argumentsOf(args);
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("repository is invalid");
  }
  const [owner, repositoryName] = repository.split("/");
  const packageName = options.package ?? repositoryName;
  if (!/^[A-Za-z0-9_.-]+$/.test(packageName)) throw new Error("package is invalid");
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required");
  const actor = process.env.GITHUB_ACTOR ?? owner;
  const ownerRecord = await responseJson(await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}`,
    { headers: githubHeaders(token) }), "GitHub owner");
  const ownerKind = ownerRecord.type === "Organization" ? "orgs" : "users";
  const versions = await packageVersions({ owner, ownerKind, packageName, token });
  const bearer = await registryBearer({ owner, packageName, actor, token });
  const manifests = await registryManifests({ owner, packageName, versions, bearer });
  const plan = planNightlyImageRetention({ versions, manifests, now: options.now ?? new Date().toISOString() });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (options.apply) await deleteVersions({ owner, ownerKind, packageName, token,
    versions, ids: plan.deleteVersionIds });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
