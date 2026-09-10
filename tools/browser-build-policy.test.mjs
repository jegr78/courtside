import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { browserBuildFileName, browserBuildOrigins, browserBuildResource, verifyBrowserBuild } from "./browser-build-policy.mjs";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(repository, "frontend");
const inventory = JSON.parse(readFileSync(join(repository, "security/published-web-resources.json"), "utf8"));

test("given browser build paths from either platform, when reading their filename, then metadata names stay detectable", () => {
  assert.equal(browserBuildFileName("C:\\build\\public\\robots.txt"), "robots.txt");
  assert.equal(browserBuildFileName("/build/public/robots.txt"), "robots.txt");
  assert.equal(browserBuildResource("C:\\build\\public\\assets\\app.js", "C:\\build\\public"),
    "assets/app.js");
});

function temporaryBuild(context) {
  const builds = [];
  context.after(() => builds.forEach((directory) => rmSync(directory, { recursive: true, force: true })));
  return (files) => {
    const directory = browserBuild(files);
    builds.push(directory);
    return directory;
  };
}

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

test("given a production browser build, when inspecting its files, then only inventoried resources ship", (context) => {
  // given
  const build = temporaryBuild(context);
  const clean = build();

  // when / then
  verifyBrowserBuild(clean);
  assert.throws(() => verifyBrowserBuild(build({ "assets/app.js.map": "{}" })), /source maps/);
  assert.throws(() => verifyBrowserBuild(build({
    "robots.txt": "Disallow: /admin"
  })), /unreviewed metadata resource/);
  assert.throws(() => verifyBrowserBuild(build({
    ".well-known/security.txt": "Contact: mailto:security@example.org"
  })), /unreviewed metadata resource/);
  assert.throws(() => verifyBrowserBuild(build({
    "release-environment.json": "{\"environment\":\"production\"}"
  })), /unreviewed public resource/);
  assert.throws(() => verifyBrowserBuild(build({
    "assets/app.mjs": "console.log('Courtside')"
  })), /unreviewed public resource/);
});

test("given every declared credential and disclosure pattern, when its specimen ships, then the build is refused", (context) => {
  // given
  const build = temporaryBuild(context);
  const declared = [...inventory.credentialPatterns, ...inventory.disclosureMarkers];
  assert.ok(declared.length > 0);

  // when / then
  for (const { id, specimen } of declared) {
    assert.throws(() => verifyBrowserBuild(build({ "assets/planted.js": specimen })),
      new RegExp(`contains ${id} material in assets/planted.js`),
      `${id} no longer recognises the specimen its justification names`);
  }
});

test("given shipped markup, styles and scripts, when reading their comments, then an unreviewed one is refused", (context) => {
  // given
  const build = temporaryBuild(context);
  assert.deepEqual(inventory.reviewedComments, [],
    "the production build ships no comment, so every comment found is a new decision");

  // when / then
  assert.throws(() => verifyBrowserBuild(build({
    "assets/app.js": "/*! Courtside build 2026-09-10 */\nconsole.log('Courtside')"
  })), /unreviewed comment in assets\/app\.js/);
  assert.throws(() => verifyBrowserBuild(build({
    "assets/app.css": "/* staging override */\nbody { margin: 0 }"
  })), /unreviewed comment in assets\/app\.css/);
  assert.throws(() => verifyBrowserBuild(build({
    "index.html": "<!-- deployed from the release runner -->"
  })), /unreviewed comment in index\.html/);
  verifyBrowserBuild(build({ "assets/app.js": "const pattern = /\\/*/; console.log(pattern)" }));
});

test("given shipped resources, when reading the origins they name, then an unreviewed host is refused", (context) => {
  // given
  const build = temporaryBuild(context);
  const reviewed = inventory.reviewedOrigins.map(({ host }) => host);

  // when / then
  assert.throws(() => verifyBrowserBuild(build({
    "assets/app.js": "fetch('https://telemetry.example.invalid/collect')"
  })), /unreviewed origin telemetry\.example\.invalid in assets\/app\.js/);
  assert.throws(() => verifyBrowserBuild(build({
    "icon.svg": "<svg xmlns=\"http://www.w3.org.example.invalid/2000/svg\"></svg>"
  })), /unreviewed origin www\.w3\.org\.example\.invalid in icon\.svg/);
  assert.deepEqual(browserBuildOrigins("<svg xmlns=\"http://www.w3.org/2000/svg\">"), ["www.w3.org"]);
  verifyBrowserBuild(build({
    "icon.svg": `<svg xmlns="http://${reviewed[0]}/2000/svg"></svg>`
  }));
});

test("given the packaged application, when reading how the web root reaches it, then the checked build is the packaged one", () => {
  // given
  const pom = readFileSync(join(repository, "pom.xml"), "utf8");
  const execution = pom.slice(pom.indexOf("<id>copy-web-client</id>"), pom.indexOf("</plugin>",
    pom.indexOf("<id>copy-web-client</id>")));

  // when / then
  assert.match(execution, /<outputDirectory>\$\{project\.build\.outputDirectory}\/static<\/outputDirectory>/);
  assert.match(execution, /<directory>\$\{project\.basedir}\/frontend\/dist<\/directory>/);
  assert.match(execution, /<filtering>false<\/filtering>/,
    "a filtered copy would put something into the image that the policy never read");
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
