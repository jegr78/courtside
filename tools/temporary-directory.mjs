import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

const created = [];

after(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});

export function temporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  created.push(directory);
  return directory;
}
