import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { browserBuildFileName, browserBuildResource, verifyBrowserBuild } from "./browser-build-policy.mjs";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(repository, "frontend");

test("given browser build paths from either platform, when reading their filename, then metadata names stay detectable", () => {
  assert.equal(browserBuildFileName("C:\\build\\public\\robots.txt"), "robots.txt");
  assert.equal(browserBuildFileName("/build/public/robots.txt"), "robots.txt");
  assert.equal(browserBuildResource("C:\\build\\public\\assets\\app.js", "C:\\build\\public"),
    "assets/app.js");
});

function browserBuild(files = {}) {
  const directory = mkdtempSync(join(tmpdir(), "courtside-browser-build-"));
  for (const [name, content] of Object.entries({ "index.html": "<script src='/assets/app.js'></script>",
    "assets/app.js": "console.log('Courtside')", ...files })) {
    const path = join(directory, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return directory;
}

test("given a production browser build, when inspecting its files, then debug and private material is absent", (context) => {
  // given
  const builds = [];
  context.after(() => builds.forEach((directory) => rmSync(directory, { recursive: true, force: true })));
  const build = (files) => {
    const directory = browserBuild(files);
    builds.push(directory);
    return directory;
  };
  const clean = build();

  // when / then
  verifyBrowserBuild(clean);
  assert.throws(() => verifyBrowserBuild(build({ "assets/app.js.map": "{}" })), /source maps/);
  assert.throws(() => verifyBrowserBuild(build({
    "assets/app.js": "//# sourceMappingURL=app.js.map"
  })), /debug, host-path or secret/);
  assert.throws(() => verifyBrowserBuild(build({
    "assets/secret.js": "-----BEGIN PRIVATE KEY-----"
  })), /debug, host-path or secret/);
  assert.throws(() => verifyBrowserBuild(build({
    "assets/secret.js": "-----BEGIN EC PRIVATE KEY-----"
  })), /debug, host-path or secret/);
  assert.throws(() => verifyBrowserBuild(build({
    "assets/secret.js": "-----BEGIN OPENSSH PRIVATE KEY-----"
  })), /debug, host-path or secret/);
  assert.throws(() => verifyBrowserBuild(build({
    "robots.txt": "Disallow: /admin"
  })), /unreviewed public resource/);
  assert.throws(() => verifyBrowserBuild(build({
    ".well-known/security.txt": "Contact: mailto:security@example.org"
  })), /unreviewed public resource/);
  assert.throws(() => verifyBrowserBuild(build({
    "release-environment.json": "{\"environment\":\"production\"}"
  })), /unreviewed public resource/);
});

test("given production browser sources, when building the web root, then metadata and debug artifacts stay absent", async (context) => {
  // given
  const output = mkdtempSync(join(tmpdir(), "courtside-production-browser-build-"));
  context.after(() => rmSync(output, { recursive: true, force: true }));
  const vite = await import(pathToFileURL(join(frontend, "node_modules/vite/dist/node/index.js")).href);
  const loaded = await vite.loadConfigFromFile(
    { command: "build", mode: "production" }, join(frontend, "vite.config.ts"));
  assert.notEqual(loaded, null);

  // when
  await vite.build({ ...loaded.config, configFile: false, root: frontend, logLevel: "error",
    build: { ...loaded.config.build, outDir: output, emptyOutDir: true } });

  // then
  verifyBrowserBuild(output);
});
