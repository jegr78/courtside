import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;
const HEADING_PATTERN = /^##\s+\[?(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)\]?(?:\(|\s|$)/gm;

function releaseLine(tag) {
  const match = TAG_PATTERN.exec(tag);
  if (!match) {
    throw new Error(`release tag is invalid: ${tag}`);
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function cumulativeReleaseNotes(changelog, tag) {
  const line = releaseLine(tag);
  const releaseHeadings = [...changelog.matchAll(HEADING_PATTERN)];
  const headings = releaseHeadings
    .filter((match) => match[1].split("-")[0] === line);
  if (headings.length !== 1) {
    throw new Error(`changelog must contain exactly one ${line} release-line heading`);
  }
  if (headings[0][1] !== line) {
    throw new Error(`changelog must use the ${line} release-line heading`);
  }

  const start = headings[0].index;
  const followingHeading = releaseHeadings.find((heading) => heading.index > start);
  const notes = changelog.slice(start, followingHeading?.index).trimEnd();
  if (line === "0.1.0" && /^### .*BREAKING CHANGES/m.test(notes)) {
    throw new Error("the initial 0.1.0 release must not claim breaking changes");
  }
  return `${notes}\n`;
}

function parseArguments(arguments_) {
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!["--changelog", "--tag", "--output"].includes(name) || value === undefined
        || options.has(name)) {
      throw new Error("usage: release-notes.mjs --changelog <path> --tag <tag> --output <path>");
    }
    options.set(name, value);
  }
  if (options.size !== 3) {
    throw new Error("usage: release-notes.mjs --changelog <path> --tag <tag> --output <path>");
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArguments(process.argv.slice(2));
  const changelog = readFileSync(options.get("--changelog"), "utf8");
  writeFileSync(options.get("--output"), cumulativeReleaseNotes(changelog, options.get("--tag")));
}
