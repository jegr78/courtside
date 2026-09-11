import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function stagedFixtureClasses(root = repository) {
  return join(root, "build", "fixtures", "classes");
}

export function stageFixtureClasses(root = repository) {
  const compiled = join(root, "target", "fixtures-classes");
  if (!existsSync(compiled)) {
    throw new Error("Package the application before its fixture classes can be staged");
  }
  const staged = stagedFixtureClasses(root);
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(dirname(staged), { recursive: true });
  cpSync(compiled, staged, { recursive: true });
  return staged;
}

export function fixtureImagePlan(tag, base) {
  return {
    command: "docker",
    args: ["build", "-t", tag, "--build-arg", `BASE_IMAGE=${base}`, "-f", "Dockerfile.fixtures", "."]
  };
}
