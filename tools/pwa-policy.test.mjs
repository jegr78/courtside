import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontendRequire = createRequire(join(repository, "frontend", "package.json"));
const Ajv2020 = frontendRequire("ajv/dist/2020").default;
const ts = frontendRequire("typescript");
const fixtures = readFileSync(new URL("../frontend/e2e/fixtures.ts", import.meta.url), "utf8");
const playwright = readFileSync(join(repository, "frontend/playwright.config.ts"), "utf8");
const viteConfiguration = readFileSync(join(repository, "frontend/vite.config.ts"), "utf8");
const eslintConfiguration = readFileSync(join(repository, "frontend/eslint.config.js"), "utf8");
const typescriptConfiguration = readFileSync(join(repository, "frontend/tsconfig.app.json"), "utf8");
const frontendPackage = JSON.parse(readFileSync(join(repository, "frontend/package.json"), "utf8"));
const pom = readFileSync(join(repository, "pom.xml"), "utf8");
const buildWorkflow = readFileSync(join(repository, ".github/workflows/build.yml"), "utf8");
const stability = readFileSync(join(repository, ".github/workflows/test-stability.yml"), "utf8");
const pwa = readFileSync(join(repository, "frontend/e2e/pwa-lifecycle.spec.ts"), "utf8");
const supported = readFileSync(join(repository, "frontend/e2e/supported-browser.spec.ts"), "utf8");
const browserSecurity = readFileSync(join(repository, "frontend/e2e/browser-security.spec.ts"), "utf8");
const browserSecuritySmoke = readFileSync(join(repository, "frontend/e2e/browser-security-smoke.spec.ts"), "utf8");
const catalog = JSON.parse(readFileSync(join(repository, "security/assessment-catalog.json"), "utf8"));
const browserEvidenceSchema = JSON.parse(readFileSync(join(repository, "security/browser-security-evidence.schema.json"), "utf8"));
const renderingContexts = JSON.parse(readFileSync(join(repository, "security/browser-rendering-contexts.json"), "utf8"));
const documentation = readFileSync(join(repository, "docs/browser-pwa-testing.md"), "utf8");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

const shippedBrowserSources = [join(repository, "frontend", "index.html"),
  ...sourceFiles(join(repository, "frontend", "src"))]
  .filter((path) => /\.(?:html|js|jsx|ts|tsx)$/.test(path))
  .filter((path) => !/\.(?:test|spec)\.[^.]+$|\.d\.ts$|setupTests\.ts$/.test(path))
  .map((path) => ({ path, source: readFileSync(path, "utf8") }));

const publicFiles = sourceFiles(join(repository, "frontend", "public"));
const metadataRouteSources = [
  ...publicFiles,
  ...sourceFiles(join(repository, "src", "main"))
    .filter((path) => /\.(?:html|java|json|properties|txt|xml|ya?ml)$/.test(path)),
  join(repository, "deploy", "Caddyfile")
];

test("given supported desktop browsers, when qualifying a pull request, then Chromium and WebKit run core smoke journeys", () => {
  assert.match(playwright, /name: "chromium"/);
  assert.match(playwright, /supported-browser\\\.spec\\\.ts/);
  assert.doesNotMatch(pom, /playwright install/);
  assert.match(playwright, /name: "webkit-core".*use: \{ browserName: "webkit"/);
  assert.doesNotMatch(playwright, /name: "webkit-core".*metadata: \{ plainOrigin: true \}/);
  // Firefox's periodic process cannot use the shared local CA, so it retains the explicit HTTP path.
  assert.match(playwright, /name: "firefox-periodic".*metadata: \{ plainOrigin: true \}/);
  assert.match(fixtures, /project\.metadata\.plainOrigin === true/);
  assert.match(supported, /isSecureContext\)\)\.toBe\(overTls\)/);
  assert.match(supported, /typeof crypto\.randomUUID === "function"\)\)\.toBe\(overTls\)/);
});

test("given shipped browser sources, when enforcing the client technology boundary, then legacy plugin APIs stay absent", () => {
  const legacyTechnology = new RegExp([
    String.raw`<(?:applet|embed|object)\b`,
    String.raw`\b(?:ActiveXObject|navigator\.plugins|document\.write)\b`,
    String.raw`\b(?:document|React)(?:\.createElement|\[\s*["']createElement["']\s*\])`
      + String.raw`\s*\(\s*["'](?:applet|embed|object)["']`
  ].join("|"), "i");
  const offenders = shippedBrowserSources
    .filter(({ source }) => legacyTechnology.test(source))
    .map(({ path }) => path.slice(repository.length + 1));
  assert.deepEqual(offenders, []);
});

test("given public metadata paths, when reviewing the shipped web root, then none advertises hidden application paths", () => {
  const metadataNames = new Set([
    "robots.txt", "sitemap.xml", "security.txt", "humans.txt", "ads.txt",
    "crossdomain.xml", "clientaccesspolicy.xml"
  ]);
  const published = metadataRouteSources
    .filter((path) => metadataNames.has(path.slice(path.lastIndexOf("/") + 1).toLowerCase())
      || [...metadataNames].some((name) => readFileSync(path, "utf8").includes(`/${name}`)))
    .map((path) => path.slice(repository.length + 1));

  assert.deepEqual(published, [],
    "A web metadata file needs a control reading before it may expose paths or deployment details");
});

test("given the production browser build, when reviewing page-content leakage, then debug sources stay unpublished", () => {
  assert.match(viteConfiguration, /build:\s*\{\s*minify:\s*["']oxc["'],\s*sourcemap:\s*false\s*\}/s);
  assert.match(frontendPackage.scripts.build,
    /vite build && node \.\.\/tools\/browser-build-policy\.mjs dist$/);
  const disclosureMarkers = shippedBrowserSources
    .filter(({ source }) => /[#@]\s*sourceMappingURL=|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(source))
    .map(({ path }) => path.slice(repository.length + 1));
  assert.deepEqual(disclosureMarkers, []);
});

test("given shipped browser code, when enforcing comparisons, then coercive equality stays absent", () => {
  assert.match(typescriptConfiguration, /"strict":\s*true/);
  assert.match(eslintConfiguration, /eqeqeq:\s*\[\s*["']error["'],\s*["']always["']\s*\]/);
  const offenders = shippedBrowserSources.flatMap(({ path, source }) => {
    if (!/\.(?:js|jsx|ts|tsx)$/.test(path)) return [];
    const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX
      : path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
    const found = [];
    function visit(node) {
      if (ts.isBinaryExpression(node)
          && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]
            .includes(node.operatorToken.kind)) {
        found.push(`${path.slice(repository.length + 1)}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    return found;
  });
  assert.deepEqual(offenders, []);
});

test("given shipped password inputs, when enforcing browser credential handling, then every field remains masked and password-manager compatible", () => {
  // given
  const passwordFields = shippedBrowserSources.flatMap(({ path, source }) =>
    jsxPasswordFields(path, source));

  // when / then
  assert.equal(passwordFields.length, 9,
    "Every added or removed password field needs an explicit credential-handling review");
  for (const field of passwordFields) {
    assert.equal(field.type, "password", `${field.path}:${field.line} exposes a password as ${field.type}`);
    assert.ok(["current-password", "new-password"].includes(field.autoComplete),
      `${field.path}:${field.line} gives password managers no standard purpose`);
    assert.equal(field.onPaste, false, `${field.path}:${field.line} intercepts paste`);
  }
  const pasteInterceptors = shippedBrowserSources
    .filter(({ source }) => /\bonPaste(?:Capture)?\s*=|addEventListener\s*\(\s*["']paste["']/.test(source))
    .map(({ path }) => path.slice(repository.length + 1));
  assert.deepEqual(pasteInterceptors, []);
});

test("given shipped identity contracts, when enforcing the authentication-factor boundary, then password hints and knowledge questions stay absent", () => {
  // given
  const identitySources = [
    ...sourceFiles(join(repository, "src", "main", "java", "org", "courtside", "identity")),
    join(repository, "src", "main", "resources", "api", "openapi.yaml"),
    ...shippedBrowserSources.map(({ path }) => path)
  ];
  const knowledgeChallenge = /password[\s_-]*hint|(?:security|secret)[\s_-]*(?:question|answer)|knowledge[\s_-]*based|mother(?:s|['’]s)?[\s_-]*maiden[\s_-]*name|favou?rite[\s_-]*(?:colou?r|place|teacher)|birth[\s_-]*(?:place|city)|first[\s_-]*pet[\s_-]*name|\bchallenge\b/i;

  // when
  const offenders = identitySources
    .filter((path) => knowledgeChallenge.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(repository.length + 1));

  // then
  assert.deepEqual(offenders, []);
});

function jsxPasswordFields(path, source) {
  if (!/\.(?:jsx|tsx)$/.test(path)) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fields = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const type = jsxAttribute(node, "type");
      const name = jsxAttribute(node, "name");
      const id = jsxAttribute(node, "id");
      if (type === "password" || /password/i.test(`${name ?? ""} ${id ?? ""}`)) {
        fields.push({
          path: path.slice(repository.length + 1),
          line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          type,
          autoComplete: jsxAttribute(node, "autoComplete"),
          onPaste: node.attributes.properties.some((attribute) =>
            ts.isJsxAttribute(attribute) && attribute.name.text === "onPaste")
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return fields;
}

function jsxAttribute(node, name) {
  const attribute = node.attributes.properties.find((candidate) =>
    ts.isJsxAttribute(candidate) && candidate.name.text === name);
  if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (ts.isJsxExpression(attribute.initializer)
      && attribute.initializer.expression && ts.isStringLiteral(attribute.initializer.expression)) {
    return attribute.initializer.expression.text;
  }
  return undefined;
}

test("given the phone layout journey, when a pull request runs, then a device project covers it unswitched", () => {
  // given — qualifying a browser is periodic work; whether the product lays out on a phone is a
  // product check, and the gate that merges a change has to run it
  const gated = configurationBetween("COURTSIDE_PERIODIC_BROWSERS", "const projectOrder");
  const configured = configurationBetween("const configuredProjects", "const projects =");

  // when / then — name, specification and device tied together, so retargeting one of them is not
  // a way past this
  assert.doesNotMatch(gated, /responsive-mobile/);
  assert.match(configured, /name: "iphone".*responsive-mobile.*spec.*devices\["iPhone/);
  assert.match(configured, /name: "android".*responsive-mobile.*spec.*devices\["Pixel/);
  // The two legitimate switches reach this region as spreads, so an inline one is a new gate.
  assert.doesNotMatch(configured, /process\.env/);
});

function configurationBetween(start, end) {
  const from = playwright.indexOf(start);
  const to = playwright.indexOf(end);
  assert.ok(from >= 0 && to > from, `playwright.config.ts no longer holds ${start} before ${end}`);
  return playwright.slice(from, to);
}

test("given periodic browser qualification, when the stability workflow runs, then Firefox and mobile devices produce evidence", () => {
  assert.doesNotMatch(stability, /playwright install/);
  assert.match(stability, /--project=firefox-periodic/);
  assert.match(stability, /--project=iphone$/m);
  assert.match(stability, /--project=android$/m);
  assert.match(stability, /--reporter=line,json/);
  assert.match(stability, /test-results\/browser-compatibility\.json/);
});

test("given the installed PWA, when its lifecycle is qualified, then shell availability and API cache privacy are asserted", () => {
  assert.match(pwa, /serviceWorker\.ready/);
  assert.match(pwa, /context\.setOffline\(true\)/);
  assert.match(pwa, /caches\.keys/);
  assert.match(pwa, /\/api\//);
});

test("given the installed PWA, when checking supported engines, then Chromium and WebKit run its signed-in journey", () => {
  assert.match(playwright, /name: "webkit-pwa".*pwa-browser-compatibility\\\.spec\\\.ts/);
  assert.match(playwright, /name: "chromium"/);
});

test("given a release on physical devices, when recording evidence, then both mobile platforms and immutable candidate identity are required", () => {
  assert.match(documentation, /iOS\/Safari/);
  assert.match(documentation, /Android\/Chrome/);
  assert.match(documentation, /candidate commit, image digest/);
  assert.match(documentation, /link it from the release checklist/);
});

test("given browser-controlled and stored values, when qualifying the PWA, then security evidence covers injection and retention", () => {
  assert.match(browserSecurity, /securitypolicyviolation/);
  assert.match(browserSecurity, /localStorage/);
  assert.match(browserSecurity, /sessionStorage/);
  assert.match(browserSecurity, /indexedDB\.databases/);
  assert.match(browserSecurity, /indexedDbNames\)\.toEqual\(\[\]\)/);
  assert.match(browserSecurity, /context\(\)\.cookies/);
  assert.match(browserSecurity, /caches\.keys/);
  assert.match(browserSecurity, /URL and fragment payloads/);
  assert.match(browserSecurity, /page\.on\("console"/);
  assert.match(browserSecurity, /cross-role/);
  assert.match(browserSecuritySmoke, /content-security-policy/);
  assert.match(playwright, /browser-security-smoke\\\.spec\\\.ts/);
  assert.match(stability, /--project=firefox-periodic/);
  assert.match(browserSecurity, /test\.use\(\{ trace: "off", screenshot: "off", video: "off" \}\)/);
  assert.match(buildWorkflow, /browser-security\/browser-storage-evidence\.json/);
  assert.match(buildWorkflow, /browser-security\/browser-csp-evidence\.json/);
  assert.match(buildWorkflow, /!frontend\/test-results\/browser-security-\*\/trace\.zip/);
  assert.equal(catalog.tests.find(({ id }) => id === "CSA-PWA-001")?.status, "implemented");
});

test("given retained browser security evidence, when validating it, then only closed redacted records are accepted", () => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(browserEvidenceSchema);
  assert.equal(validate({
    kind: "browser-csp", executed: false,
    events: [{ directive: "script-src-elem", blockedReason: "inline" }]
  }), true);
  assert.equal(validate({
    kind: "browser-csp", executed: false,
    events: [{ directive: "script-src-elem", blockedReason: "inline", cookie: "secret" }]
  }), false);
});

test("given club-controlled rendering contexts, when checking the security journey, then every inventoried sink is bound to a test", () => {
  const expectedIds = [
    "club-name-text", "club-name-title", "court-name-text", "booking-card-label",
    "participant-card-label", "rule-set-name", "person-fields", "account-username",
    "membership-type-name", "import-source-name", "external-reference-id",
    "booking-note", "guest-name", "audit-projection", "logo-url", "imprint-url", "privacy-url",
    "location-input"
  ];
  assert.deepEqual(renderingContexts.contexts.map(({ id }) => id).toSorted(), expectedIds.toSorted());
  for (const context of renderingContexts.contexts) {
    assert.deepEqual(Object.keys(context).toSorted(), ["field", "id", "journey", "sink"]);
    assert.match(browserSecurity, new RegExp(`"${context.id}"`));
  }
});
