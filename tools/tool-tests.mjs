import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

export function shiftedClockEnvironment(offsetDays, environment = process.env) {
  if (!Number.isInteger(offsetDays) || offsetDays === 0) throw new Error("Clock offset in days is invalid");
  const preload = `--import=${pathToFileURL(fileURLToPath(new URL("shift-clock.mjs", import.meta.url))).href}`;
  return {
    ...environment,
    COURTSIDE_CLOCK_OFFSET_DAYS: String(offsetDays),
    NODE_OPTIONS: [environment.NODE_OPTIONS, preload].filter(Boolean).join(" ")
  };
}

export function assertShiftedClock(environment, offsetDays, spawn = spawnSync) {
  const probe = spawn(process.execPath, ["-e", "process.stdout.write(String(Date.now()))"],
    { encoding: "utf8", env: environment });
  const observed = Number(probe.stdout);
  // performance keeps the real epoch when this process itself runs under a shifted Date
  const expected = performance.timeOrigin + performance.now() + offsetDays * 86_400_000;
  if (!Number.isFinite(observed) || Math.abs(observed - expected) > 600_000) {
    throw new Error("The shifted clock did not reach the child process");
  }
}

export function runToolTests(paths, spawn = spawnSync, offsetDays = 0,
  report = (text) => process.stderr.write(text)) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.some((path) => typeof path !== "string")) {
    throw new Error("Tool test paths are invalid");
  }
  const arguments_ = ["--test", ...paths.map((path) => `../${path}`)];
  const temporary = mkdtempSync(join(tmpdir(), "courtside-tool-tests-"));
  try {
    const caller = offsetDays === 0 ? process.env : shiftedClockEnvironment(offsetDays);
    const env = { ...caller, TMPDIR: temporary, TEMP: temporary, TMP: temporary };
    if (offsetDays !== 0) assertShiftedClock(env, offsetDays);
    const result = spawn(process.execPath, arguments_, { cwd: frontend, stdio: "inherit", env });
    if (result.error) throw result.error;
    const leftovers = readdirSync(temporary).sort();
    if (leftovers.length > 0) {
      report(`Tool tests left ${leftovers.length} entries in their temporary directory:\n${leftovers.join("\n")}\n`);
    }
    if (result.status !== 0) return result.status ?? 1;
    return leftovers.length > 0 ? 1 : 0;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
  const offsetArgument = process.argv.find((argument) => argument.startsWith("--clock-offset-days="));
  const offsetDays = offsetArgument === undefined ? 0 : Number(offsetArgument.slice("--clock-offset-days=".length));
  if (!Number.isInteger(offsetDays)) throw new Error("Clock offset in days is invalid");
  process.exitCode = runToolTests(declaredToolTests(manifest, toolInventory()), spawnSync, offsetDays);
}
