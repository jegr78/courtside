import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { annotation, extractionProblems, unextractedFiles } from "./codeql-diagnostics.mjs";

const recorded = JSON.parse(readFileSync(new URL("./codeql-diagnostics.fixture.json", import.meta.url), "utf8"));
const tool = new URL("./codeql-diagnostics.mjs", import.meta.url).pathname;

test("given CodeQL 2.27.3 diagnostics for a file it could not parse, when they are read, then each failure names the file and line", () => {
  // when
  const problems = extractionProblems(recorded);

  // then
  assert.ok(problems.length > 0, "the recorded run failed to extract src/broken.ts");
  assert.ok(problems.every((problem) => problem.file === "src/broken.ts"), "only the broken file is reported");
  assert.deepEqual([...new Set(problems.map((problem) => problem.id))].sort(),
    ["js/diagnostics/extraction-errors", "js/parse-error"]);
  assert.ok(problems.some((problem) => problem.line === 2 && /Expression expected/.test(problem.message)));
  assert.equal(new Set(problems.map((problem) => JSON.stringify(problem))).size, problems.length, "a repeated notification is reported once");
});

test("given only coverage baselines and platform notes, when they are read, then nothing is reported", () => {
  // given
  const quiet = structuredClone(recorded);
  const notes = quiet.runs[0].invocations[0].toolExecutionNotifications;
  quiet.runs[0].invocations[0].toolExecutionNotifications = notes.filter((note) => note.level === "none");

  // when / then
  assert.ok(quiet.runs[0].invocations[0].toolExecutionNotifications.length > 0);
  assert.deepEqual(extractionProblems(quiet), []);
});

test("given a message with workflow command characters, when it becomes an annotation, then it cannot end or forge the command", () => {
  // when
  const line = annotation({ id: "js/parse-error", file: "src/a,b:c.ts", line: 3, message: "50% done\n::error::forged" });

  // then
  assert.equal(line, "::warning file=src/a%2Cb%3Ac.ts,line=3,title=js/parse-error::50%25 done%0A::error::forged");
});

test("given a SARIF directory from the security job, when the tool runs, then the run log and the evidence name the file", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "codeql-diagnostics-"));
  mkdirSync(join(directory, "codeql"));
  writeFileSync(join(directory, "codeql", "javascript.sarif"), JSON.stringify(recorded));
  writeFileSync(join(directory, "summary.md"), "");

  // when
  const result = spawnSync(process.execPath, [tool, "--sarif", join(directory, "codeql"),
    "--output", join(directory, "codeql-diagnostics.json")], { encoding: "utf8",
    env: { ...process.env, GITHUB_STEP_SUMMARY: join(directory, "summary.md") } });

  // then
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^::warning file=src\/broken\.ts,line=2,title=js\/parse-error::/m);
  const evidence = JSON.parse(readFileSync(join(directory, "codeql-diagnostics.json"), "utf8"));
  assert.equal(evidence.problems[0].file, "src/broken.ts");
  assert.match(readFileSync(join(directory, "summary.md"), "utf8"), /src\/broken\.ts/);
});

test("given no SARIF from the analysis, when the tool runs, then the run says so instead of passing silently", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "codeql-diagnostics-empty-"));

  // when
  const result = spawnSync(process.execPath, [tool, "--sarif", join(directory, "missing"),
    "--output", join(directory, "codeql-diagnostics.json")], { encoding: "utf8" });

  // then
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^::error::CodeQL wrote no SARIF/m, "the missing analysis is named in the run");
});

test("given SARIF without tool diagnostics, when the tool runs, then the run says it cannot see extraction problems", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "codeql-diagnostics-bare-"));
  mkdirSync(join(directory, "codeql"));
  writeFileSync(join(directory, "codeql", "java.sarif"), JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }));

  // when
  const result = spawnSync(process.execPath, [tool, "--sarif", join(directory, "codeql"),
    "--output", join(directory, "codeql-diagnostics.json")], { encoding: "utf8" });

  // then
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^::warning::CodeQL's SARIF .* carries no tool diagnostics/m,
    "an empty diagnostic list must not read as a clean extraction");
});

test("given a run that extracted every file it expected, when coverage is compared, then no file is missing", () => {
  // when / then
  assert.deepEqual(unextractedFiles(recorded), [], "a file with parse errors still counts as extracted");
});

test("given a file CodeQL expected but did not extract, when coverage is compared, then that file is named", () => {
  // given
  const partial = structuredClone(recorded);
  const invocation = partial.runs[0].invocations[0];
  invocation.toolExecutionNotifications = invocation.toolExecutionNotifications.filter((note) =>
    !(note.descriptor.id === "js/diagnostics/successfully-extracted-files"
      && note.locations[0].physicalLocation.artifactLocation.uri === "src/valid.ts"));

  // when
  const missing = unextractedFiles(partial);

  // then
  assert.deepEqual(missing, [{ language: "js", file: "src/valid.ts" }],
    "the recorded run minus one successful extraction is the shape of 'scanned 451 out of 452'");
});

test("given a SARIF directory where a file was not extracted, when the tool runs, then the run names that file", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "codeql-diagnostics-coverage-"));
  mkdirSync(join(directory, "codeql"));
  const partial = structuredClone(recorded);
  const invocation = partial.runs[0].invocations[0];
  invocation.toolExecutionNotifications = invocation.toolExecutionNotifications.filter((note) =>
    note.descriptor.id !== "js/diagnostics/successfully-extracted-files"
      || note.locations[0].physicalLocation.artifactLocation.uri !== "src/valid.ts");
  writeFileSync(join(directory, "codeql", "javascript.sarif"), JSON.stringify(partial));

  // when
  const result = spawnSync(process.execPath, [tool, "--sarif", join(directory, "codeql"),
    "--output", join(directory, "codeql-diagnostics.json")], { encoding: "utf8" });

  // then
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^::warning file=src\/valid\.ts,title=js\/unextracted-file::CodeQL expected to extract this file and did not/m);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "codeql-diagnostics.json"), "utf8")).unextracted,
    [{ language: "js", file: "src/valid.ts" }]);
});

test("given SARIF without the expected or extracted file lists, when the tool runs, then the run says it cannot name unextracted files", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "codeql-diagnostics-unlisted-"));
  mkdirSync(join(directory, "codeql"));
  const unlisted = structuredClone(recorded);
  const invocation = unlisted.runs[0].invocations[0];
  invocation.toolExecutionNotifications = invocation.toolExecutionNotifications.filter((note) =>
    !/extracted-files$/.test(note.descriptor.id));
  writeFileSync(join(directory, "codeql", "javascript.sarif"), JSON.stringify(unlisted));

  // when
  const result = spawnSync(process.execPath, [tool, "--sarif", join(directory, "codeql"),
    "--output", join(directory, "codeql-diagnostics.json")], { encoding: "utf8" });

  // then
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^::warning::CodeQL's SARIF lists no expected and extracted files, so unextracted files cannot be named/m,
    "an empty comparison must not read as complete coverage");
  const evidence = JSON.parse(readFileSync(join(directory, "codeql-diagnostics.json"), "utf8"));
  assert.equal(evidence.notifications["js/diagnostics/extraction-errors"], 3, "the evidence counts what the SARIF carried");
  assert.equal(evidence.notifications["js/baseline/expected-extracted-files"], undefined);
});

test("given the files git tracks, when the hosted SARIF lists only extracted files, then the tracked source it lacks is named", () => {
  // given
  const tracked = ["src/broken.ts", "src/valid.ts", "src/Missing.java", "README.md"];
  const hosted = structuredClone(recorded);
  const invocation = hosted.runs[0].invocations[0];
  invocation.toolExecutionNotifications = invocation.toolExecutionNotifications.filter((note) =>
    !note.descriptor.id.endsWith("/baseline/expected-extracted-files"));

  // when
  const missing = unextractedFiles(hosted, tracked);

  // then
  assert.deepEqual(missing, [{ language: "java", file: "src/Missing.java" }],
    "the hosted SARIF carries only successfully extracted files, so git supplies what CodeQL expected");
});

test("given a repository checkout, when the tool runs with it, then a tracked source file CodeQL did not extract is named", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "codeql-diagnostics-repository-"));
  const checkout = join(directory, "checkout");
  mkdirSync(join(checkout, "src"), { recursive: true });
  for (const file of ["broken.ts", "valid.ts", "Skipped.java"]) writeFileSync(join(checkout, "src", file), "");
  const git = (args) => execFileSync("git", args, { cwd: checkout, env: { ...process.env, GIT_AUTHOR_NAME: "Jane Doe",
    GIT_AUTHOR_EMAIL: "jane@example.org", GIT_COMMITTER_NAME: "Jane Doe", GIT_COMMITTER_EMAIL: "jane@example.org" } });
  git(["init", "-q"]);
  git(["add", "."]);
  mkdirSync(join(directory, "codeql"));
  writeFileSync(join(directory, "codeql", "javascript.sarif"), JSON.stringify(recorded));

  // when
  const result = spawnSync(process.execPath, [tool, "--sarif", join(directory, "codeql"),
    "--output", join(directory, "codeql-diagnostics.json"), "--repository", checkout], { encoding: "utf8" });

  // then
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^::warning file=src\/Skipped\.java,title=java\/unextracted-file::/m);
  assert.doesNotMatch(result.stdout, /lists no expected and extracted files/, "git supplied the expected list");
});
