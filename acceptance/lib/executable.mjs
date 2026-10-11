import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export function findExecutable(name, pathVariable = process.env.PATH ?? "") {
  for (const directory of pathVariable.split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, name);
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* not in this directory */ }
  }
  return null;
}
