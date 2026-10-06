import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");
const digestPattern = /@sha256:[a-f0-9]{64}$/;
const policyFiles = {
  safe: ["zap-authenticated-policy.json"],
  active: ["zap-authenticated-policy.json", "openapi-fuzz-policy.json"],
  destructive: ["zap-authenticated-policy.json", "openapi-fuzz-policy.json", "resource-abuse-policy.json"],
};

function requirePinned(image, source) {
  if (typeof image !== "string" || /[\s$]/.test(image) || !digestPattern.test(image)) {
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
  const scannerImages = new Map([...new Set(Object.values(policyFiles).flat())].map((file) => {
    const path = join(policyDirectory, file);
    return [file, requirePinned(JSON.parse(readFileSync(path, "utf8")).image, path)];
  }));
  const scanners = policies.map((file) => scannerImages.get(file));
  const inactiveScanners = new Set([...scannerImages.values()].filter((image) => !scanners.includes(image)));
  const candidateImages = new Map([
    ["app", "${COURTSIDE_SECURITY_IMAGE:?required}"],
    ["seeder", "${COURTSIDE_SECURITY_FIXTURES_IMAGE:?required}"]
  ]);
  const services = yaml.load(readFileSync(compose, "utf8"))?.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    throw new Error("Assessment Compose must declare runtime services");
  }
  const infrastructure = Object.entries(services).flatMap(([service, configuration]) => {
    const image = configuration?.image;
    if (typeof image !== "string" || image.length === 0) {
      throw new Error("Assessment runtime image must use an immutable sha256 digest");
    }
    if (image.includes("$")) {
      if (candidateImages.get(service) !== image) throw new Error("Unsupported assessment candidate image variable");
      return [];
    }
    requirePinned(image, compose);
    return Array.isArray(configuration.profiles) && configuration.profiles.includes("assessment")
      && inactiveScanners.has(image) ? [] : [image];
  });
  return [...new Set([...infrastructure, ...scanners])].sort();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const image of assessmentImages(process.argv[2])) {
    process.stdout.write(`${image}\n`);
  }
}
