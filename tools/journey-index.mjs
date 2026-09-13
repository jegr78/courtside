import { relative } from "node:path";

const DEVICES = { desktop: "Desktop", iphone: "iPhone", android: "Android" };
const LANGUAGES = { de: "German", en: "English" };

function walkedSpecs(suite) {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(walkedSpecs)];
}

// A project name carries the two things the catalogue varies, so the index reads them from what
// actually ran instead of from a list somebody keeps beside the run.
export function deviceAndLanguage(projectName) {
  const [, device, language] = /^journey-([a-z]+)-([a-z]{2})$/.exec(projectName) ?? [];
  if (!device || !DEVICES[device] || !LANGUAGES[language]) {
    throw new Error(`Not a journey project: ${projectName}`);
  }
  return { device: DEVICES[device], language: LANGUAGES[language] };
}

export function journeyRows(report) {
  return (report.suites ?? []).flatMap(walkedSpecs).flatMap((spec) =>
    spec.tests.map((walked) => {
      const { device, language } = deviceAndLanguage(walked.projectName);
      const attempt = walked.results?.[walked.results.length - 1] ?? {};
      return {
        journey: spec.file.replace(/^journeys\//, "").replace(/\.spec\.ts$/, ""),
        title: spec.title,
        device,
        language,
        outcome: walked.status ?? "unknown",
        seconds: Math.round((attempt.duration ?? 0) / 100) / 10,
        attachments: (attempt.attachments ?? []).filter((attachment) => attachment.path)
      };
    }));
}

// The index sits in the run's own directory, so a link from it is the artefact's place in that
// directory rather than this machine's, which also keeps the home directory out of a pasted index.
function cell(row, kind, directory) {
  const found = row.attachments.find((attachment) => attachment.name === kind
    || (kind === "video" && attachment.contentType === "video/webm")
    || (kind === "trace" && attachment.name === "trace")
    || (kind === "screenshot" && attachment.contentType === "image/png"));
  return found ? `[${kind}](${encodeURI(relative(directory, found.path))})` : "—";
}

export function journeyIndex(report, startedAt, directory) {
  const rows = journeyRows(report);
  const failed = rows.filter((row) => row.outcome !== "expected").length;
  return [
    "# Journey run",
    "",
    `Started ${startedAt}. ${rows.length} runs, ${failed} of them not as expected.`,
    "",
    "| Journey | Device | Language | Outcome | Seconds | Video | Trace | Screenshot |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.journey} | ${row.device} | ${row.language} | ${row.outcome}`
      + ` | ${row.seconds} | ${cell(row, "video", directory)} | ${cell(row, "trace", directory)}`
      + ` | ${cell(row, "screenshot", directory)} |`),
    ""
  ].join("\n");
}
