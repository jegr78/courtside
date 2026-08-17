import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

function newestModification(path: string): { path: string; modified: number } {
  if (!statSync(path).isDirectory()) {
    return { path, modified: statSync(path).mtimeMs };
  }
  return readdirSync(path, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
    .reduce((newest, file) => {
      const modified = statSync(file).mtimeMs;
      return modified > newest.modified ? { path: file, modified } : newest;
    }, { path, modified: 0 });
}

// A build older than its sources serves code nobody wrote, and every conclusion drawn from the run
// is then about something else entirely.
export function requireBuiltAfterItsSources(artifact: string, sources: string, remedy: string): void {
  const built = newestModification(artifact).modified;
  const source = newestModification(sources);
  if (built >= source.modified) return;
  throw new Error(
    `${artifact} is older than ${source.path}. Run '${remedy}' — this suite would otherwise `
    + "test a stale build and report results that belong to code you have already changed.");
}
