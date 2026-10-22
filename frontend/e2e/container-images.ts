import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved on use, because a jsdom test that imports the setup sees no file URL here.
const frontend = (): string => fileURLToPath(new URL("..", import.meta.url));

export const PINNED_BROWSER_IMAGE =
  "mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f";

// Qualifying against something a club does not run proves nothing about what it does, so every
// reference here is read from the deployment rather than repeated beside it.
function deployedImage(composeFile: string, pattern: RegExp, what: string): string {
  const compose = resolve(frontend(), "..", "deploy", composeFile);
  const found = pattern.exec(readFileSync(compose, "utf8"));
  if (!found) throw new Error(`${compose} names no ${what} image pinned by digest`);
  return found[0];
}

export function deployedPostgresImage(): string {
  return deployedImage("compose.yaml", /postgres(?::[\w.-]+)?@sha256:[a-f0-9]{64}/, "PostgreSQL");
}

// The relay a journey reads is the one the deployment's mail smoke test already runs against.
export function deployedMailSinkImage(): string {
  return deployedImage("compose.mail-smoke.yaml",
    /axllent\/mailpit(?::[\w.-]+)?@sha256:[a-f0-9]{64}/, "Mailpit");
}

export function deployedProxyImage(): string {
  return deployedImage("compose.caddy.yaml", /caddy(?::[\w.-]+)?@sha256:[a-f0-9]{64}/, "Caddy");
}

// Testcontainers starts its reaper before the first container, from the image its installed release names.
export function reaperImage(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.RYUK_CONTAINER_IMAGE) return environment.RYUK_CONTAINER_IMAGE;
  const entry = createRequire(resolve(frontend(), "package.json")).resolve("testcontainers");
  const reaper = readFileSync(resolve(dirname(entry), "reaper", "reaper.js"), "utf8");
  const image = /"(testcontainers\/ryuk:[\w.-]+)"/.exec(reaper)?.[1];
  if (!image) throw new Error("The installed Testcontainers names no reaper image");
  return image;
}

export function browserSetupImages(): string[] {
  return [reaperImage(), deployedPostgresImage(), deployedMailSinkImage(), deployedProxyImage(), PINNED_BROWSER_IMAGE];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const images = process.argv[2] === "--browser" ? [PINNED_BROWSER_IMAGE] : browserSetupImages();
  process.stdout.write(`${images.join("\n")}\n`);
}
