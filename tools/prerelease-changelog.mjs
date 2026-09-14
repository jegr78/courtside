import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RELEASE_HEADING = /^##\s+(?:\[)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)(?:\])?(?:\([^\n]*\))?(?:\s+\([^)]+\))?\s*$/gm;
const SECTION_HEADING = /^###\s+(.+?)\s*$/gm;
const SECTION_ORDER = new Map([
  ["Notable changes", 0],
  ["Features", 1],
  ["Bug fixes", 2],
  ["Performance", 3],
  ["Documentation", 4],
  ["Build and dependencies", 5]
]);

function sectionsOf(body, context) {
  const headings = [...body.matchAll(SECTION_HEADING)];
  const preamble = body.slice(0, headings[0]?.index).trim();
  if (preamble || headings.length === 0) {
    throw new Error(`${context} must contain only named changelog sections`);
  }
  const sections = headings.map((heading, index) => ({
    name: heading[1],
    body: body.slice(heading.index + heading[0].length, headings[index + 1]?.index).trim(),
    order: index
  }));
  if (new Set(sections.map((section) => section.name)).size !== sections.length) {
    throw new Error(`${context} must not contain duplicate section headings`);
  }
  return sections;
}

function mergeSections(candidateBody, cumulativeBody, releaseLine) {
  const candidate = sectionsOf(candidateBody, "generated candidate history")
    .map((section) => releaseLine === "0.1.0" && /BREAKING CHANGES/i.test(section.name)
      ? { ...section, name: "Notable changes" }
      : section);
  const cumulative = sectionsOf(cumulativeBody, "cumulative release history");
  const merged = new Map(cumulative.map((section) => [section.name, { ...section }]));

  for (const section of candidate) {
    const existing = merged.get(section.name);
    if (existing) {
      existing.body = [section.body, existing.body].filter(Boolean).join("\n\n");
    } else {
      merged.set(section.name, { ...section, order: cumulative.length + section.order });
    }
  }

  return [...merged.values()]
    .sort((left, right) => {
      const leftPriority = SECTION_ORDER.get(left.name) ?? SECTION_ORDER.size + left.order;
      const rightPriority = SECTION_ORDER.get(right.name) ?? SECTION_ORDER.size + right.order;
      return leftPriority - rightPriority;
    })
    .map((section) => `### ${section.name}\n\n${section.body}`)
    .join("\n\n");
}

export function normalizePrereleaseChangelog(changelog) {
  const headings = [...changelog.matchAll(RELEASE_HEADING)];
  const candidates = headings.filter((heading) => heading[1].includes("-"));
  if (candidates.length === 0) {
    return changelog;
  }
  if (candidates.length !== 1 || candidates[0] !== headings[0]) {
    throw new Error("changelog must contain exactly one generated candidate as its newest release");
  }

  const candidate = candidates[0];
  const releaseLine = candidate[1].split("-")[0];
  const cumulative = headings.filter((heading) => heading[1] === releaseLine);
  if (cumulative.length !== 1) {
    throw new Error(`candidate ${candidate[1]} needs exactly one matching cumulative heading ${releaseLine}`);
  }
  if (headings[1] !== cumulative[0]) {
    throw new Error("candidate delta must be directly followed by its cumulative release line");
  }

  const candidateEnd = candidate.index + candidate[0].length;
  const cumulativeEnd = cumulative[0].index + cumulative[0][0].length;
  const followingRelease = headings.find((heading) => heading.index > cumulative[0].index);
  const candidateBody = changelog.slice(candidateEnd, cumulative[0].index);
  const cumulativeBody = changelog.slice(cumulativeEnd, followingRelease?.index);
  const mergedBody = mergeSections(candidateBody, cumulativeBody, releaseLine);
  const suffix = changelog.slice(followingRelease?.index ?? changelog.length);

  return `${changelog.slice(0, candidate.index)}${cumulative[0][0]}\n\n${mergedBody}\n\n${suffix}`;
}

function parseArguments(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== "--changelog") {
    throw new Error("usage: prerelease-changelog.mjs --changelog <path>");
  }
  return arguments_[1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = parseArguments(process.argv.slice(2));
  const changelog = readFileSync(path, "utf8");
  const normalized = normalizePrereleaseChangelog(changelog);
  if (normalized !== changelog) {
    writeFileSync(path, normalized);
  }
}
