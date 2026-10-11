import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function claimRunDirectory(path) {
  if (existsSync(join(path, "results.json"))) throw new Error(`${path} already holds results; give this run its own directory`);
  mkdirSync(path, { recursive: true });
}

export function harnessCommit(root = new URL("..", import.meta.url)) {
  const stamp = new URL("source.json", root);
  if (existsSync(stamp)) return JSON.parse(readFileSync(stamp, "utf8")).commit;
  const git = fileURLToPath(new URL("../.git/", root));
  if (!existsSync(join(git, "HEAD"))) return "unknown";
  const head = readFileSync(join(git, "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) return head;
  const ref = join(git, head.slice(5));
  if (existsSync(ref)) return readFileSync(ref, "utf8").trim();
  const packed = existsSync(join(git, "packed-refs")) ? readFileSync(join(git, "packed-refs"), "utf8") : "";
  return packed.split("\n").find((line) => line.endsWith(` ${head.slice(5)}`))?.split(" ")[0] ?? "unknown";
}
