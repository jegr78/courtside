import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontendRequire = createRequire(join(repository, "frontend", "package.json"));
const Ajv2020 = frontendRequire("ajv/dist/2020").default;
const fixtures = readFileSync(new URL("../frontend/e2e/fixtures.ts", import.meta.url), "utf8");
const playwright = readFileSync(join(repository, "frontend/playwright.config.ts"), "utf8");
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

test("given supported desktop browsers, when qualifying a pull request, then Chromium and WebKit run core smoke journeys", () => {
  assert.match(playwright, /name: "chromium"/);
  assert.match(playwright, /supported-browser\\\.spec\\\.ts/);
  assert.doesNotMatch(pom, /playwright install/);
  // One project stays on the plain origin, so the club that serves Courtside without TLS is covered.
  assert.match(playwright, /name: "webkit-core".*metadata: \{ plainOrigin: true \}/);
  assert.match(fixtures, /project\.metadata\.plainOrigin === true/);
  assert.match(supported, /isSecureContext\)\)\.toBe\(overTls\)/);
  assert.match(supported, /typeof crypto\.randomUUID === "function"\)\)\.toBe\(overTls\)/);
});

test("given periodic browser qualification, when the stability workflow runs, then Firefox and mobile devices produce evidence", () => {
  assert.doesNotMatch(stability, /playwright install/);
  assert.match(stability, /--project=firefox-periodic/);
  assert.match(stability, /--project=iphone-periodic/);
  assert.match(stability, /--project=android-periodic/);
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
    "booking-note", "guest-name", "audit-projection", "logo-url", "imprint-url", "location-input"
  ];
  assert.deepEqual(renderingContexts.contexts.map(({ id }) => id).toSorted(), expectedIds.toSorted());
  for (const context of renderingContexts.contexts) {
    assert.deepEqual(Object.keys(context).toSorted(), ["field", "id", "journey", "sink"]);
    assert.match(browserSecurity, new RegExp(`"${context.id}"`));
  }
});
