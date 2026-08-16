import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function parseChangedLines(diff) {
  const changed = new Map();
  let file;
  let line = 0;
  for (const entry of diff.split("\n")) {
    if (entry.startsWith("+++ b/")) {
      file = entry.slice(6);
      continue;
    }
    const hunk = entry.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!file || entry.startsWith("---")) {
      continue;
    }
    if (entry.startsWith("+") && !entry.startsWith("+++")) {
      if (!changed.has(file)) {
        changed.set(file, new Set());
      }
      changed.get(file).add(line);
      line++;
    } else if (!entry.startsWith("-")) {
      line++;
    }
  }
  return changed;
}

export function parseJacoco(xml) {
  const covered = new Map();
  for (const packageMatch of xml.matchAll(/<package name="([^"]+)">([\s\S]*?)<\/package>/g)) {
    const packageName = packageMatch[1];
    for (const sourceMatch of packageMatch[2].matchAll(/<sourcefile name="([^"]+)">([\s\S]*?)<\/sourcefile>/g)) {
      const file = `src/main/java/${packageName}/${sourceMatch[1]}`;
      const lines = new Map();
      for (const lineMatch of sourceMatch[2].matchAll(/<line nr="(\d+)" mi="(\d+)" ci="(\d+)"/g)) {
        lines.set(Number(lineMatch[1]), Number(lineMatch[3]) > 0);
      }
      covered.set(file, lines);
    }
  }
  return covered;
}

export function parseLcov(lcov) {
  const covered = new Map();
  let file;
  for (const entry of lcov.split("\n")) {
    if (entry.startsWith("SF:")) {
      const source = entry.slice(3).replaceAll("\\", "/");
      const marker = source.lastIndexOf("/frontend/src/");
      file = marker >= 0 ? source.slice(marker + 1) : source.replace(/^\.\//, "");
      covered.set(file, new Map());
    } else if (file && entry.startsWith("DA:")) {
      const [line, hits] = entry.slice(3).split(",").map(Number);
      covered.get(file).set(line, hits > 0);
    } else if (entry === "end_of_record") {
      file = undefined;
    }
  }
  return covered;
}

export function summarize(changed, coverage, criticalPaths) {
  const rows = [];
  for (const [file, changedLines] of changed) {
    const measured = coverage.get(file);
    if (!measured) {
      continue;
    }
    const executable = [...changedLines].filter(line => measured.has(line));
    if (executable.length === 0) {
      continue;
    }
    const uncovered = executable.filter(line => !measured.get(line));
    rows.push({
      file,
      critical: criticalPaths.some(path => file.startsWith(path)),
      executable: executable.length,
      uncovered
    });
  }
  return rows;
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing ${name}`);
  }
  return process.argv[index + 1];
}

function main() {
  const base = option("--base");
  const java = parseJacoco(readFileSync(option("--java"), "utf8"));
  const frontend = parseLcov(readFileSync(option("--frontend"), "utf8"));
  const critical = JSON.parse(readFileSync(resolve("quality/critical-coverage.json"), "utf8")).paths;
  const diff = execFileSync("git", ["diff", "--unified=0", `${base}...HEAD`, "--",
    "src/main/java", "frontend/src"], { encoding: "utf8" });
  const rows = summarize(parseChangedLines(diff), new Map([...java, ...frontend]), critical);
  const lines = ["# Changed coverage", "", "Coverage is diagnostic evidence; this report does not enforce a percentage.", ""];
  if (rows.length === 0) {
    lines.push("No changed executable lines were present in the collected reports.");
  } else {
    lines.push("| Surface | Critical | Executable changed lines | Uncovered changed lines |", "|---|---:|---:|---|");
    for (const row of rows) {
      lines.push(`| \`${row.file}\` | ${row.critical ? "yes" : "no"} | ${row.executable} | ${row.uncovered.join(", ") || "none"} |`);
    }
  }
  const output = option("--output");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${lines.join("\n")}\n`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
