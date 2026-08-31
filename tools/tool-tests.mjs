import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateToolManifest } from "./test-profile-classifier.mjs";

const frontend = fileURLToPath(new URL("../frontend", import.meta.url));
const repository = fileURLToPath(new URL("..", import.meta.url));
const manifestUrl = new URL("../ci/tool-profile-manifest.json", import.meta.url);

export function toolInventory(exec = execFileSync) {
  const output = exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "tools"], {
    cwd: repository,
    encoding: "utf8"
  });
  return output.split("\0").filter(Boolean);
}

export function declaredToolTests(manifest, trackedPaths) {
  validateToolManifest(manifest, trackedPaths);
  const tests = manifest.entries.filter((entry) => entry.test).map((entry) => entry.path).sort();
  if (tests.length < 1) throw new Error("Tool profile manifest declares no tests");
  return tests;
}

export function runToolTests(paths, spawn = spawnSync) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.some((path) => typeof path !== "string")) {
    throw new Error("Tool test paths are invalid");
  }
  const arguments_ = ["--test", ...paths.map((path) => `../${path}`)];
  const result = spawn(process.execPath, arguments_, { cwd: frontend, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return result.status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
  runToolTests(declaredToolTests(manifest, toolInventory()));
}
