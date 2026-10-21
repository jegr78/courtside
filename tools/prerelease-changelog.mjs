import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RELEASE_HEADING = /^##\s+(?:\[)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)(?:\])?(?:\([^\n]*\))?(?:\s+\([^)]+\))?[ \t]*$/gm;
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

function entriesOf(body) {
  if (!body.startsWith("* ")) {
    return undefined;
  }
  return body.split(/\n(?=\* )/).map((entry) => entry.trimEnd());
}

function commitOf(entry) {
  return /\/commit\/([0-9a-f]{7,40})\)\)/.exec(entry)?.[1];
}

// A squash body that repeats a conventional header becomes a second entry for the same commit.
function namesPullRequest(entry) {
  return /\(\[#\d+\]\([^)\s]+\)\) \(\[[0-9a-f]{7,40}\]\(/.test(entry);
}

function withOneEntryPerCommit(sections) {
  const listed = sections.map((section) => ({ section, entries: entriesOf(section.body) }));
  const kept = new Map();
  for (const entry of listed.flatMap(({ entries }) => entries ?? [])) {
    const commit = commitOf(entry);
    if (commit && (!kept.has(commit) || (namesPullRequest(entry) && !namesPullRequest(kept.get(commit))))) {
      kept.set(commit, entry);
    }
  }
  return listed
    .map(({ section, entries }) => {
      if (!entries) {
        return section;
      }
      const body = entries.filter((entry) => {
        const commit = commitOf(entry);
        if (!commit || kept.get(commit) !== entry) {
          return !commit;
        }
        kept.delete(commit);
        return true;
      }).join("\n");
      return { ...section, body };
    })
    .filter((section) => section.body);
}

function mergeSections(candidateBody, cumulativeBody, releaseLine) {
  const candidate = sectionsOf(candidateBody, "generated candidate history")
    .map((section) => releaseLine === "0.1.0" && /BREAKING CHANGES/i.test(section.name)
      ? { ...section, name: "Notable changes" }
      : section);
  const cumulative = cumulativeBody.trim() ? sectionsOf(cumulativeBody, "cumulative release history") : [];
  const merged = new Map(cumulative.map((section) => [section.name, { ...section }]));

  for (const section of candidate) {
    const existing = merged.get(section.name);
    if (existing) {
      existing.body = [section.body, existing.body].filter(Boolean).join("\n");
    } else {
      merged.set(section.name, { ...section, order: cumulative.length + section.order });
    }
  }

  return renderSections([...merged.values()]);
}

function renderSections(sections) {
  return withOneEntryPerCommit(sections)
    .sort((left, right) => {
      const leftPriority = SECTION_ORDER.get(left.name) ?? SECTION_ORDER.size + left.order;
      const rightPriority = SECTION_ORDER.get(right.name) ?? SECTION_ORDER.size + right.order;
      return leftPriority - rightPriority;
    })
    .map((section) => `### ${section.name}\n\n${section.body}`)
    .join("\n\n");
}

function releaseDate(heading) {
  return /\((\d{4}-\d{2}-\d{2})\)\s*$/.exec(heading[0])?.[1];
}

function lineHeading(line, date) {
  return date ? `## ${line} (${date})` : `## ${line}`;
}

// A line this normalizer wrote has no compare link; Release Please may leave it as an older normalizer wrote it.
function withCleanNewestLine(changelog, newest, followingRelease) {
  const start = newest.index + newest[0].length;
  const end = followingRelease?.index ?? changelog.length;
  const body = changelog.slice(start, end).trim();
  const cleaned = renderSections(sectionsOf(body, "cumulative release history"));
  if (cleaned === body) {
    return changelog;
  }
  const suffix = followingRelease ? `\n\n${changelog.slice(end)}` : "\n";
  return `${changelog.slice(0, start)}\n\n${cleaned}${suffix}`;
}

export function normalizePrereleaseChangelog(changelog) {
  const headings = [...changelog.matchAll(RELEASE_HEADING)];
  const newest = headings[0];
  if (!newest) {
    return changelog;
  }
  const releaseLine = newest[1].split("-")[0];
  const candidates = headings.filter((heading) => heading[1].includes("-"));
  const graduation = newest[1] === releaseLine && headings[1]?.[1] === releaseLine;
  if (candidates.length === 0 && !graduation) {
    return newest[0].includes("[") ? changelog : withCleanNewestLine(changelog, newest, headings[1]);
  }
  if (candidates.length > 1 || (candidates.length === 1 && candidates[0] !== newest)) {
    throw new Error("changelog must contain exactly one generated candidate as its newest release");
  }

  const delta = newest;
  const deltaEnd = delta.index + delta[0].length;
  const cumulative = headings.slice(1).filter((heading) => heading[1] === releaseLine);
  if (cumulative.length === 0) {
    const followingRelease = headings[1];
    const body = mergeSections(changelog.slice(deltaEnd, followingRelease?.index), "", releaseLine);
    const suffix = changelog.slice(followingRelease?.index ?? changelog.length);
    return `${changelog.slice(0, delta.index)}${lineHeading(releaseLine, releaseDate(delta))}\n\n${body}\n\n${suffix}`;
  }
  if (cumulative.length !== 1) {
    throw new Error(`${delta[1]} needs exactly one matching cumulative heading ${releaseLine}`);
  }
  if (headings[1] !== cumulative[0]) {
    throw new Error("candidate delta must be directly followed by its cumulative release line");
  }

  const cumulativeEnd = cumulative[0].index + cumulative[0][0].length;
  const followingRelease = headings.find((heading) => heading.index > cumulative[0].index);
  const deltaBody = changelog.slice(deltaEnd, cumulative[0].index);
  const cumulativeBody = changelog.slice(cumulativeEnd, followingRelease?.index);
  const mergedBody = mergeSections(deltaBody, cumulativeBody, releaseLine);
  const suffix = changelog.slice(followingRelease?.index ?? changelog.length);
  const heading = graduation ? lineHeading(releaseLine, releaseDate(delta)) : cumulative[0][0];

  return `${changelog.slice(0, delta.index)}${heading}\n\n${mergedBody}\n\n${suffix}`;
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
