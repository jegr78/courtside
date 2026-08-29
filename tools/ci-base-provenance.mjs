import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const shaPattern = /^[a-f0-9]{40}$/;

export function validateObservedBase(repository, base, head) {
  if (typeof repository !== "string" || !shaPattern.test(base) || !shaPattern.test(head)) {
    throw new Error("Observed commit identity is invalid");
  }
  const mergeBase = execFileSync("git", ["merge-base", base, head], {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 1024
  }).trim();
  if (mergeBase !== base) {
    throw new Error("Observed pull request base is not bound to the completed run");
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  validateObservedBase(process.cwd(), argument("--base"), argument("--head"));
}
