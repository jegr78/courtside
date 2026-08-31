import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const toolchainUrl = new URL("../ci/node-toolchain.json", import.meta.url);
const exactVersion = /^\d+\.\d+\.\d+$/;

export function validateNodeToolchain(candidate) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)
      || Object.keys(candidate).sort().join() !== ["node", "npm"].sort().join()
      || typeof candidate.node !== "string" || !exactVersion.test(candidate.node)
      || typeof candidate.npm !== "string" || !exactVersion.test(candidate.npm)) {
    throw new Error("Node toolchain contract is invalid");
  }
  return candidate;
}

export function writeGitHubOutputs(toolchain, outputPath) {
  validateNodeToolchain(toolchain);
  if (typeof outputPath !== "string" || outputPath.length < 1) throw new Error("GitHub output path is invalid");
  appendFileSync(outputPath, `node=${toolchain.node}\nnpm=${toolchain.npm}\n`, { encoding: "utf8" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== "--github-output") {
    throw new Error("Usage: node tools/node-toolchain.mjs --github-output <path>");
  }
  const toolchain = validateNodeToolchain(JSON.parse(readFileSync(toolchainUrl, "utf8")));
  writeGitHubOutputs(toolchain, process.argv[3]);
}
