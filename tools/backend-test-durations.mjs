import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// One surefire report per class; its testsuite element names the class and its total seconds.
export function suiteDuration(report) {
  const suite = /<testsuite\b[^>]*>/.exec(report)?.[0];
  const name = suite && /\sname="([^"]+)"/.exec(suite)?.[1];
  const time = suite && /\stime="([\d.,]+)"/.exec(suite)?.[1];
  if (!name || !time) return undefined;
  return { name: `${name.replaceAll(".", "/")}.java`, seconds: Math.round(Number(time.replaceAll(",", "")) * 10) / 10 };
}

export function durationsOf(directories) {
  const durations = {};
  for (const directory of directories) {
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/^TEST-.+\.xml$/.test(entry.name)) continue;
      const duration = suiteDuration(readFileSync(join(entry.parentPath, entry.name), "utf8"));
      if (duration) durations[duration.name] = duration.seconds;
    }
  }
  return Object.fromEntries(Object.entries(durations).toSorted(([left], [right]) => (left < right ? -1 : 1)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(durationsOf(process.argv.slice(2)), null, 2)}\n`);
}
