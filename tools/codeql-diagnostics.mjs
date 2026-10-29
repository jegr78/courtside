import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// SARIF reads a notification without a level as a warning; "none" and "note" are coverage and platform facts.
const reported = new Set(["error", "warning", undefined]);

export function extractionProblems(sarif) {
  const seen = new Map();
  for (const run of sarif.runs ?? []) {
    for (const invocation of run.invocations ?? []) {
      for (const notification of invocation.toolExecutionNotifications ?? []) {
        if (!reported.has(notification.level)) continue;
        const location = notification.locations?.[0]?.physicalLocation;
        const problem = {
          id: notification.descriptor?.id ?? "unknown",
          level: notification.level ?? "warning",
          file: location?.artifactLocation?.uri ?? null,
          line: location?.region?.startLine ?? null,
          message: notification.message?.text ?? ""
        };
        seen.set(JSON.stringify(problem), problem);
      }
    }
  }
  return [...seen.values()];
}

function notifiedFiles(sarif, suffix) {
  return (sarif.runs ?? []).flatMap((run) => (run.invocations ?? []).flatMap((invocation) =>
    (invocation.toolExecutionNotifications ?? []).filter((note) => note.descriptor?.id?.endsWith(suffix))
      .flatMap((note) => (note.locations ?? []).map((location) => ({
        language: note.descriptor.id.split("/")[0],
        file: location.physicalLocation?.artifactLocation?.uri
      })))));
}

export function unextractedFiles(sarif) {
  const key = ({ language, file }) => `${language}\u0000${file}`;
  const extracted = new Set(notifiedFiles(sarif, "/diagnostics/successfully-extracted-files").map(key));
  const missing = new Map(notifiedFiles(sarif, "/baseline/expected-extracted-files")
    .filter((entry) => entry.file && !extracted.has(key(entry))).map((entry) => [key(entry), entry]));
  return [...missing.values()];
}

const escapeData = (value) => String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const escapeProperty = (value) => escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");

export function annotation({ id, file, line, message }) {
  const properties = [file && `file=${escapeProperty(file)}`, line && `line=${line}`, `title=${escapeProperty(id)}`]
    .filter(Boolean).join(",");
  return `::warning ${properties}::${escapeData(message)}`;
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

function main() {
  const directory = option("--sarif");
  const files = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".sarif")) : [];
  if (files.length === 0) {
    process.stdout.write(`::error::CodeQL wrote no SARIF to ${directory}, so its analysis did not finish\n`);
    process.exitCode = 1;
    return;
  }
  const documents = files.map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")));
  const notifications = documents.flatMap((sarif) => (sarif.runs ?? []).flatMap((run) => (run.invocations ?? [])
    .flatMap((invocation) => invocation.toolExecutionNotifications ?? [])));
  if (notifications.length === 0) {
    process.stdout.write(`::warning::CodeQL's SARIF in ${directory} carries no tool diagnostics, so extraction problems cannot be read\n`);
  }
  const problems = documents.flatMap(extractionProblems);
  const unextracted = documents.flatMap(unextractedFiles);
  const counted = {};
  for (const note of notifications) counted[note.descriptor?.id ?? "unknown"] = (counted[note.descriptor?.id ?? "unknown"] ?? 0) + 1;
  const listed = (suffix) => Object.keys(counted).some((id) => id.endsWith(suffix));
  if (notifications.length > 0 && !(listed("/baseline/expected-extracted-files") && listed("/diagnostics/successfully-extracted-files"))) {
    process.stdout.write("::warning::CodeQL's SARIF lists no expected and extracted files, so unextracted files cannot be named\n");
  }
  for (const problem of problems) process.stdout.write(`${annotation(problem)}\n`);
  for (const { language, file } of unextracted) {
    process.stdout.write(`${annotation({ id: `${language}/unextracted-file`, file,
      message: "CodeQL expected to extract this file and did not, so no query read it" })}\n`);
  }
  writeFileSync(option("--output"),
    `${JSON.stringify({ schemaVersion: 1, sarif: files.sort(), problems, unextracted, notifications: counted }, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, notifications.length === 0
      ? "CodeQL's SARIF carries no tool diagnostics.\n"
      : problems.length === 0 && unextracted.length === 0 ? "CodeQL reported no extraction problem.\n"
      : ["## CodeQL extraction problems", "", "| Diagnostic | File | Line | Message |", "| --- | --- | --- | --- |",
        ...problems.map((problem) => `| ${problem.id} | ${problem.file ?? ""} | ${problem.line ?? ""} | `
          + `${problem.message.replaceAll("|", "\\|").replaceAll("\n", " ")} |`),
        ...unextracted.map(({ language, file }) => `| ${language}/unextracted-file | ${file} | | not extracted |`),
        ""].join("\n"));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
