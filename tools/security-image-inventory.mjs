import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const digestPattern = /@sha256:[a-f0-9]{64}$/;
const policyFiles = {
  safe: ["zap-authenticated-policy.json"],
  active: ["zap-authenticated-policy.json", "openapi-fuzz-policy.json"],
  destructive: ["zap-authenticated-policy.json", "openapi-fuzz-policy.json", "resource-abuse-policy.json"],
};

function requirePinned(image, source) {
  if (!digestPattern.test(image)) {
    throw new Error(`${source} image ${image} must use an immutable sha256 digest`);
  }
  return image;
}

export function assessmentImages(profile, paths = {}) {
  const policies = policyFiles[profile];
  if (!policies) {
    throw new Error(`Unknown security assessment profile: ${profile}`);
  }
  const compose = paths.compose ?? join(repository, "deploy/compose.security.yaml");
  const policyDirectory = paths.policyDirectory ?? join(repository, "security");
  const infrastructure = [...readFileSync(compose, "utf8").matchAll(/^\s+image:\s+([^$\s]+)\s*$/gm)]
    .map((match) => match[1])
    .filter((image) => image.startsWith("postgres:") || image.startsWith("caddy:"))
    .map((image) => requirePinned(image, compose));
  const scanners = policies.map((file) => {
    const path = join(policyDirectory, file);
    return requirePinned(JSON.parse(readFileSync(path, "utf8")).image, path);
  });
  return [...new Set([...infrastructure, ...scanners])].sort();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const image of assessmentImages(process.argv[2])) {
    process.stdout.write(`${image}\n`);
  }
}
