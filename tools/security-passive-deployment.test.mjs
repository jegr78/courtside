import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { boundedAssessmentFailureReason } from "./security-runner.mjs";
import {
  assertPassiveDeploymentEvidence, assertQualifiedImageEvidence, buildPassiveDeploymentEvidence, createAssessmentControl,
  evaluateCipherPolicy, evaluateExposureResponses, evaluateMethodBoundary, evaluatePublicResponseHeaders,
  normalizeZapAlerts, openCandidateCount, passiveAlertFingerprint, passiveDeploymentSummary,
  alertDiscriminator, recordCovers, resolveAlertAgainst,
  passiveScannerOrigin, requiredPassiveCheckIds, runOwnedProcess, zapVersion
} from "./security-passive-deployment.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const schema = JSON.parse(readFileSync(new URL(
  "../security/passive-deployment-evidence.schema.json", import.meta.url)));
const digest = `sha256:${"a".repeat(64)}`;
const observationById = {
  "backup-exposure": "route-group-not-exposed", "body-limit": "proxy-body-limit-enforced",
  "certificate-trust": "certificate-chain-and-host-valid",
  "direct-forwarded-behavior": "direct-app-distinguished-from-proxy", "forwarded-boundary": "spoofed-host-rejected",
  "header-limit": "oversized-header-rejected", "http-redirect": "http-port-not-published",
  "host-boundary": "upstream-host-canonicalized",
  "loopback-publication": "proxy-loopback-only", "management-separation": "management-internal-only",
  "method-override": "unsafe-and-overridden-methods-rejected",
  "qualified-image-evidence": "covered-by-image-qualification",
  "runtime-file-permissions": "application-files-confined", "runtime-hardening": "runtime-controls-present",
  "scanner-runtime-hardening": "scanner-runtime-controls-present",
  "secure-cookie-delivery": "issued-cookies-secure", "sensitive-extension-exposure": "route-group-not-exposed",
  "tls-ciphers": "recommended-ciphers-only", "tls-versions": "tls12-and-tls13-only",
  "transport-security": "localhost-transport-qualified-externally"
};

function passingObservations() {
  return requiredPassiveCheckIds.map((id) => {
    const layer = ["runtime-hardening", "scanner-runtime-hardening"].includes(id) ? "container"
      : ["loopback-publication", "http-redirect", "transport-security", "qualified-image-evidence"].includes(id)
        ? "host" : ["management-separation", "direct-forwarded-behavior"].includes(id) ? "application" : "proxy";
    const outcome = ["http-redirect", "transport-security"].includes(id)
      ? "not-applicable" : undefined;
    const observation = observationById[id] ?? (id.startsWith("exposure-") ? "route-not-exposed"
      : id.startsWith("headers-") ? "security-and-cache-headers-valid" : "method-rejected");
    return { id, layer, passed: true, outcome, observation };
  });
}

test("given sensitive extension responses, when exposure is assessed, then every representative path must be absent", () => {
  // given
  const absent = [404, 404, 404, 404, 404];

  // when / then
  assert.deepEqual(evaluateExposureResponses(absent), {
    passed: true, observation: "route-group-not-exposed"
  });
  assert.deepEqual(evaluateExposureResponses([404, 404, 200, 404, 404]), {
    passed: false, observation: "unexpected-route-group-response"
  });
});

test("given backup and unreferenced responses, when exposure is assessed, then only a served one fails", () => {
  // given — the deployment answers every one of these 401, because it authenticates before it routes
  const refused = [401, 401, 401, 401, 401];

  // when / then
  assert.equal(evaluateExposureResponses(refused).passed, true);
  assert.equal(evaluateExposureResponses([401, 404, 401, 401, 401]).passed, true);
  assert.equal(evaluateExposureResponses([401, 403, 401, 401, 401]).passed, false);
  assert.equal(evaluateExposureResponses([401, 401, 200, 401, 401]).passed, false);
  assert.equal(evaluateExposureResponses([401, 401, 301, 401, 401]).passed, false);
  assert.equal(evaluateExposureResponses([401, 401, 500, 401, 401]).passed, false);
});

test("given unsafe and overridden methods, when the boundary is assessed, then changed request semantics fail", () => {
  // when / then
  assert.deepEqual(evaluateMethodBoundary([405, 400, 405], [200, 200, 200]), {
    passed: true, observation: "unsafe-and-overridden-methods-rejected"
  });
  assert.equal(evaluateMethodBoundary([200, 400, 405], [200, 200, 200]).passed, false);
  assert.equal(evaluateMethodBoundary([405, 400, 405], [200, 405, 200]).passed, false);
});

test("given negotiated cipher suites, when TLS policy is assessed, then deprecated suites fail", () => {
  // given
  const tls12 = { connected: true, protocol: "TLSv1.2", cipher: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256" };
  const tls13 = { connected: true, protocol: "TLSv1.3", cipher: "TLS_AES_128_GCM_SHA256" };

  // when / then
  assert.deepEqual(evaluateCipherPolicy(tls12, tls13, { connected: false }), {
    passed: true, observation: "recommended-ciphers-only"
  });
  assert.deepEqual(evaluateCipherPolicy(
    { ...tls12, cipher: "TLS_RSA_WITH_AES_128_CBC_SHA" }, tls13, { connected: false }), {
    passed: false, observation: "cipher-policy-mismatch"
  });
  assert.equal(evaluateCipherPolicy(tls12, tls13, {
    connected: true, protocol: "TLSv1.2", cipher: "TLS_RSA_WITH_AES_128_CBC_SHA"
  }).passed, false);
});

test("given the public response boundary, when CSP or proxy disclosure is broader than intended, then it fails closed", () => {
  // given
  const headers = new Map([
    ["content-security-policy", "default-src 'self'; object-src 'none'; img-src 'self' https:; "
      + "style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; "
      + "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"],
    ["x-content-type-options", "nosniff"], ["x-frame-options", "DENY"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    ["permissions-policy", "geolocation=(), camera=(), microphone=()"]
  ]);
  const response = { headers, cacheProtected: true };

  // when / then
  assert.deepEqual(evaluatePublicResponseHeaders(response), {
    passed: true, observation: "security-and-cache-headers-valid"
  });
  assert.deepEqual(evaluatePublicResponseHeaders({ ...response,
    headers: new Map([...headers, ["content-security-policy",
      `${headers.get("content-security-policy")}, base-uri 'none'; frame-ancestors 'none'`]])
  }), { passed: true, observation: "security-and-cache-headers-valid" });
  for (const proxyPolicy of ["frame-ancestors 'self'", "report-uri /csp", "base-uri 'none'; img-src *"]) {
    assert.deepEqual(evaluatePublicResponseHeaders({ ...response,
      headers: new Map([...headers, ["content-security-policy",
        `${headers.get("content-security-policy")}, ${proxyPolicy}`]])
    }), { passed: false, observation: "security-or-cache-headers-invalid" });
  }
  assert.deepEqual(evaluatePublicResponseHeaders({ ...response,
    headers: new Map([...headers, ["via", "1.1 Caddy"]])
  }), { passed: false, observation: "proxy-implementation-disclosed" });
  assert.deepEqual(evaluatePublicResponseHeaders({ ...response,
    headers: new Map([...headers, ["content-security-policy",
      headers.get("content-security-policy").replace("https:", "https: http: data:")]])
  }), { passed: false, observation: "security-or-cache-headers-invalid" });
  for (const broaderPolicy of [
    headers.get("content-security-policy").replace("https:", "https: blob:"),
    headers.get("content-security-policy").replace("https:", "https: HTTP:"),
    `${headers.get("content-security-policy")}; img-src 'self' http:`
  ]) {
    assert.deepEqual(evaluatePublicResponseHeaders({ ...response,
      headers: new Map([...headers, ["content-security-policy", broaderPolicy]])
    }), { passed: false, observation: "security-or-cache-headers-invalid" });
  }
});

test("given passing layer observations, when building passive evidence, then only closed redacted facts remain", () => {
  // given
  const observations = passingObservations();

  // when
  const evidence = buildPassiveDeploymentEvidence({
    targetFingerprint: digest, imageDigest: digest, observations,
    zapReport: { version: "2.17.0", site: [{ alerts: [] }] }, requestCount: 24
  });

  // then
  const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
  assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
  assert.equal(evidence.outcome, "passed");
  assert.doesNotMatch(JSON.stringify(evidence), /session=|authorization=|password=|responseBody/i);
});

test("given a failed required observation, when building passive evidence, then it cannot pass", () => {
  // when
  const evidence = buildPassiveDeploymentEvidence({
    targetFingerprint: digest, imageDigest: digest,
    observations: passingObservations().map((observation) => observation.id === "body-limit"
      ? { ...observation, passed: false, observation: "proxy-body-limit-not-proven" } : observation),
    zapReport: { version: "2.17.0", site: [{ alerts: [] }] }, requestCount: 1
  });

  // then
  assert.equal(evidence.outcome, "failed");
});

test("given ZAP output on separate routes, when normalizing it, then safe route identities remain distinct", () => {
  // given
  const report = { site: [{ alerts: [{ pluginid: "10010", riskcode: "1", confidence: "2",
    instances: [
      { uri: `${passiveScannerOrigin}/api/source`, method: "GET", param: "__Host-XSRF-TOKEN",
        evidence: "Set-Cookie: __Host-XSRF-TOKEN", otherinfo: "" },
      { uri: `${passiveScannerOrigin}/api/source`, method: "GET", param: "__Host-XSRF-TOKEN",
        evidence: "Set-Cookie: __Host-XSRF-TOKEN", otherinfo: "" },
      { uri: `${passiveScannerOrigin}/assets/index-a1b2c3.js`, method: "GET", param: "__Host-XSRF-TOKEN",
        evidence: "Set-Cookie: __Host-XSRF-TOKEN", otherinfo: "" }
    ] }] }] };

  // when
  const alerts = normalizeZapAlerts(report);

  // then
  assert.deepEqual(alerts.map(({ fingerprint, ...alert }) => alert), [
    { pluginId: "10010", riskCode: 1, confidence: 2, method: "GET", routeTemplate: "/api/source", count: 2,
      ruleEvidence: { kind: "cookie-attribute", cookieName: "xsrf-token", missingAttribute: "http-only" } },
    { pluginId: "10010", riskCode: 1, confidence: 2, method: "GET", routeTemplate: "/assets/{asset}", count: 1,
      ruleEvidence: { kind: "cookie-attribute", cookieName: "xsrf-token", missingAttribute: "http-only" } }
  ]);
  assert.match(alerts[0].fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(alerts[0].fingerprint, alerts[1].fingerprint);
  assert.doesNotMatch(JSON.stringify(alerts), /localhost|secret|__Host-SESSION/);
});

test("given a suspicious-comment alert, when normalizing it, then only a pattern id and bound location remain", () => {
  // given
  const instance = { uri: `${passiveScannerOrigin}/assets/index-a1b2c3.js`, method: "GET", param: "",
    evidence: "select", otherinfo: "The following pattern was used: \\bSELECT\\b and matched secret-like text" };
  const report = { site: [{ alerts: [{ pluginid: "10027", riskcode: "0", confidence: "1",
    instances: [instance, instance] }] }] };

  // when
  const [alert] = normalizeZapAlerts(report, digest);

  // then
  assert.equal(alert.count, 2);
  assert.deepEqual(alert.ruleEvidence, { kind: "text-pattern", matches: [{ patternId: "comment-select",
    resourceDigest: alert.ruleEvidence.matches[0].resourceDigest, occurrenceCount: 2,
    locationDigest: alert.ruleEvidence.matches[0].locationDigest }] });
  assert.match(alert.ruleEvidence.matches[0].resourceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(alert.ruleEvidence.matches[0].locationDigest, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(alert.ruleEvidence.matches[0].locationDigest, alert.fingerprint);
  assert.equal(alert.fingerprint, "sha256:6744ae243ecc24def5606740af614410a70a72e0569fd5dec781f41a7b9d77d6");
  assert.doesNotMatch(JSON.stringify(alert), /secret-like|\\bSELECT\\b|"select"/i);
});

test("given the same pattern in different assets, when normalizing it, then each resource remains attributable", () => {
  // given
  const instance = (asset) => ({ uri: `${passiveScannerOrigin}/assets/${asset}.js`, method: "GET", param: "",
    evidence: "select", otherinfo: "The following pattern was used: \\bSELECT\\b" });
  const report = { site: [{ alerts: [{ pluginid: "10027", riskcode: "0", confidence: "1",
    instances: [instance("first-a1b2c3"), instance("second-d4e5f6")] }] }] };

  // when
  const [alert] = normalizeZapAlerts(report, digest);

  // then
  assert.equal(alert.ruleEvidence.matches.length, 2);
  assert.notEqual(alert.ruleEvidence.matches[0].resourceDigest, alert.ruleEvidence.matches[1].resourceDigest);
  assert.notEqual(alert.ruleEvidence.matches[0].locationDigest, alert.ruleEvidence.matches[1].locationDigest);
  assert.doesNotMatch(JSON.stringify(alert), /first-a1b2c3|second-d4e5f6/);
});

test("given repeated matches in one asset, when normalizing them, then the bounded location records their count", () => {
  // given
  const instance = { uri: `${passiveScannerOrigin}/assets/index-a1b2c3.js`, method: "GET", param: "",
    evidence: "select", otherinfo: "The following pattern was used: \\bSELECT\\b" };

  // when
  const [single] = normalizeZapAlerts({ site: [{ alerts: [{ pluginid: "10027", riskcode: "0", confidence: "1",
    instances: [instance] }] }] }, digest);
  const [repeated] = normalizeZapAlerts({ site: [{ alerts: [{ pluginid: "10027", riskcode: "0", confidence: "1",
    instances: [instance, instance] }] }] }, digest);

  // then
  assert.equal(single.ruleEvidence.matches[0].occurrenceCount, 1);
  assert.equal(repeated.ruleEvidence.matches[0].occurrenceCount, 2);
  assert.notEqual(single.ruleEvidence.matches[0].locationDigest, repeated.ruleEvidence.matches[0].locationDigest);
});

test("given every supported suspicious-comment pattern, when normalizing it, then each has one closed identifier", () => {
  // given
  const patterns = ["todo", "fixme", "bug", "bugs", "xxx", "query", "db", "admin", "administrator", "user",
    "username", "select", "where", "from", "later", "debug"];

  // when / then
  for (const pattern of patterns) {
    const [alert] = normalizeZapAlerts({ site: [{ alerts: [{ pluginid: "10027", riskcode: "0", confidence: "1",
      instances: [{ uri: `${passiveScannerOrigin}/assets/index-a1b2c3.js`, method: "GET", param: "",
        evidence: `unretained-${pattern}`, otherinfo: `The following pattern was used: \\b${pattern}\\b` }] }] }] }, digest);
    assert.equal(alert.ruleEvidence.matches[0].patternId, `comment-${pattern}`);
    assert.doesNotMatch(JSON.stringify(alert), /unretained/);
  }
});

test("given ZAP keeps a suspicious pattern at alert level, when normalizing it, then the same closed evidence remains", () => {
  // given
  const report = { site: [{ alerts: [{ pluginid: "10027", riskcode: "0", confidence: "1",
    otherinfo: "<p>The following pattern was used: \\bSELECT\\b and matched omitted text.</p>",
    instances: [{ uri: `${passiveScannerOrigin}/assets/index-a1b2c3.js`, method: "GET", param: "",
      evidence: "arbitrary matched comment", otherinfo: "scanner-specific summary" }] }] }] };

  // when
  const [alert] = normalizeZapAlerts(report, digest);

  // then
  assert.equal(alert.ruleEvidence.matches[0].patternId, "comment-select");
  assert.doesNotMatch(JSON.stringify(alert), /arbitrary|omitted|scanner-specific/);
});

test("given unsafe or unsupported passive evidence, when normalizing it, then the run fails closed", () => {
  // given
  const alert = (pluginid, instance) => ({ site: [{ alerts: [{ pluginid, riskcode: "0", confidence: "1",
    instances: [instance] }] }] });
  const textInstance = { uri: `${passiveScannerOrigin}/assets/index-a1b2c3.js`, method: "GET", param: "",
    evidence: "select", otherinfo: "The following pattern was used: \\bSELECT\\b" };

  // when / then
  assert.throws(() => normalizeZapAlerts(alert("99999", textInstance), digest), /unsupported passive rule/);
  const [redacted] = normalizeZapAlerts(alert("10027", { ...textInstance, evidence: "password=secret" }), digest);
  assert.doesNotMatch(JSON.stringify(redacted), /password|secret/);
  assert.throws(() => normalizeZapAlerts(alert("10027", { ...textInstance, evidence: "" }), digest),
    /no match evidence/);
  assert.throws(() => normalizeZapAlerts(alert("10027", {
    ...textInstance, uri: `${passiveScannerOrigin}/assets/image-a1b2c3.png`
  }), digest), /textual resource/);
  assert.throws(() => normalizeZapAlerts(alert("10027", { ...textInstance,
    otherinfo: "The following pattern was used: secret-token" }), digest), /unsupported pattern identifier/);
  assert.throws(() => normalizeZapAlerts(alert("10027", { ...textInstance,
    otherinfo: "The following pattern was used: \\bSELECT\\b and \\bQUERY\\b" }), digest),
  /unsupported pattern identifier/);
});

test("given a server-header alert, when normalizing it, then its value is classified but never retained", () => {
  // given
  const report = { site: [{ alerts: [{ pluginid: "10036", riskcode: "0", confidence: "3",
    instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET", param: "", evidence: "scanner-name/1.2.3",
      otherinfo: "" }] }] }] };

  // when
  const [alert] = normalizeZapAlerts(report);

  // then
  assert.deepEqual(alert.ruleEvidence, { kind: "response-header", headerName: "server" });
  assert.doesNotMatch(JSON.stringify(alert), /scanner-name|1\.2\.3/);
});

test("given the remaining supported passive rules, when normalizing them, then only their closed facts remain", () => {
  // given
  const report = { site: [{ alerts: [
    { pluginid: "10054", riskcode: "1", confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "__Host-XSRF-TOKEN", evidence: "Set-Cookie: __Host-XSRF-TOKEN", otherinfo: "" }] },
    { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "Content-Security-Policy", evidence: "policy-value", otherinfo: "Broad directives:\nimg-src" }] },
    { pluginid: "10109", riskcode: "0", confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "", evidence: "<script src=secret>",
      otherinfo: "No links have been found while there are scripts, indicating a modern application." }] },
    { pluginid: "10112", riskcode: "0", confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "__Host-SESSION", evidence: "__Host-SESSION", otherinfo: "cookie:__Host-SESSION\ncookie:__Host-XSRF-TOKEN" }] }
  ] }] };

  // when
  const alerts = normalizeZapAlerts(report);

  // then
  assert.deepEqual(alerts.map(({ ruleEvidence }) => ruleEvidence), [
    { kind: "cookie-attribute", cookieName: "xsrf-token", missingAttribute: "same-site" },
    { kind: "policy-directive", headerName: "content-security-policy", directives: ["img-src"] },
    { kind: "application-signal", signal: "scripts-without-links" },
    { kind: "session-signal", tokenNames: ["session", "xsrf-token"] }
  ]);
  assert.doesNotMatch(JSON.stringify(alerts), /policy-value|src=secret/);
});

test("given the CSP directives ZAP says do not fall back, when normalizing them, then it names them", () => {
  // given — the shape a hosted run produced against the proxy's own deliberately narrow policy
  const report = { site: [{ alerts: [
    { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "Content-Security-Policy", evidence: "base-uri 'none'; frame-ancestors 'none'",
      otherinfo: "The directive(s): form-action is/are among the directives that do not fallback to default-src." }] }
  ] }] };

  // when
  const alerts = normalizeZapAlerts(report);

  // then
  assert.deepEqual(alerts.map(({ ruleEvidence }) => ruleEvidence), [
    { kind: "policy-directive", headerName: "content-security-policy", directives: ["form-action"] }
  ]);
  assert.doesNotMatch(JSON.stringify(alerts), /base-uri|'none'/);
});

test("given several directives in one CSP alert, when normalizing it, then they are deduplicated and ordered", () => {
  // given
  const report = { site: [{ alerts: [
    { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "Content-Security-Policy", evidence: "base-uri 'none'",
      otherinfo: "The directive(s): form-action, base-uri, form-action is/are among the directives that do not fallback to default-src." }] }
  ] }] };

  // when
  const alerts = normalizeZapAlerts(report);

  // then
  assert.deepEqual(alerts[0].ruleEvidence.directives, ["base-uri", "form-action"]);
});

test("given a broad-directive list of several lines, when normalizing it, then every line is named", () => {
  // given
  const report = { site: [{ alerts: [
    { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "Content-Security-Policy", evidence: "policy-value",
      otherinfo: "Broad directives:\nimg-src\nscript-src\ndefault-src" }] }
  ] }] };

  // when
  const alerts = normalizeZapAlerts(report);

  // then
  assert.deepEqual(alerts[0].ruleEvidence.directives, ["default-src", "img-src", "script-src"]);
});

test("given the wording a hosted 2.17 scanner produced, when normalizing it, then every directive is named", () => {
  // given — captured verbatim from a local run against the disposable target
  const report = { site: [{ alerts: [
    { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "Content-Security-Policy", evidence: "policy-value",
      otherinfo: "The following directives either allow wildcard sources (or ancestors), are not"
        + " defined, or are overly broadly defined: script-src, style-src, img-src, connect-src,"
        + " frame-src, font-src, media-src, object-src, manifest-src, worker-src" }] }
  ] }] };

  // when
  const alerts = normalizeZapAlerts(report);

  // then
  assert.deepEqual(alerts[0].ruleEvidence.directives, ["connect-src", "font-src", "frame-src",
    "img-src", "manifest-src", "media-src", "object-src", "script-src", "style-src", "worker-src"]);
});

const cspAlert = (otherinfo) => ({ site: [{ alerts: [
  { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
    param: "Content-Security-Policy", evidence: "policy-value", otherinfo }] }
] }] });

// Every otherinfo template rule 10055 can emit, read out of the pinned image with
// unzip /zap/plugin/pscanrules-release-75.zap "*Messages.properties".
const cspTemplates = [
  ["malformed", "A non-ASCII character was encountered while attempting to parse the policy, thus"
    + " rendering it invalid (no further evaluation occurred). The following invalid characters were"
    + " collected: \u00e9, \u00fc", []],
  ["nofallback", "The directive(s): form-action, frame-ancestors is/are among the directives that do"
    + " not fallback to default-src.", ["form-action", "frame-ancestors"]],
  ["scriptsrc.unsafe.eval", "script-src includes unsafe-eval.", ["script-src"]],
  ["scriptsrc.unsafe.hashes", "script-src includes unsafe-hashes, an attacker will be able to use any"
    + " of the code covered by such hashes.", ["script-src"]],
  ["scriptsrc.unsafe", "script-src includes unsafe-inline.", ["script-src"]],
  ["stylesrc.unsafe.hashes", "style-src includes unsafe-hashes, an attacker will be able to use any"
    + " of the code covered by such hashes.", ["style-src"]],
  ["stylesrc.unsafe", "style-src includes unsafe-inline.", ["style-src"]],
  ["wildcard", "The following directives either allow wildcard sources (or ancestors), are not"
    + " defined, or are overly broadly defined:\nscript-src\nstyle-src\nimg-src\nsandbox",
  ["img-src", "sandbox", "script-src", "style-src"]],
  ["xcsp", "The header X-Content-Security-Policy was found on this response. While it is a good sign"
    + " that CSP is implemented to some degree the policy specified in this header has not been"
    + " analyzed by ZAP. To ensure full support by modern browsers ensure that the"
    + " Content-Security-Policy header is defined and attached to responses.", []],
  ["xwkcsp", "The header X-WebKit-CSP was found on this response. While it is a good sign that CSP is"
    + " implemented to some degree the policy specified in this header has not been analyzed by ZAP."
    + " To ensure full support by modern browsers ensure that the Content-Security-Policy header is"
    + " defined and attached to responses.", []]
];

test("given every wording rule 10055 can emit, when normalizing each, then it names exactly its directives",
  () => {
    // given
    const read = [];

    // when
    for (const [, otherInfo] of cspTemplates) {
      read.push(normalizeZapAlerts(cspAlert(otherInfo))[0].ruleEvidence.directives);
    }

    // then — extraction from free prose is a heuristic, so what the pinned scanner writes is pinned here
    assert.deepEqual(read, cspTemplates.map(([, , directives]) => directives));
    assert.equal(cspTemplates.length, 10);
  });

test("given a wording that opens with its directive, when normalizing it, then that directive is named", () => {
  // given — the scanner's own script-src and style-src templates put the name first
  const otherInfo = "script-src includes unsafe-inline.";

  // when
  const alerts = normalizeZapAlerts(cspAlert(otherInfo));

  // then
  assert.deepEqual(alerts[0].ruleEvidence.directives, ["script-src"]);
});

test("given a wording that names no directive at all, when normalizing it, then the alert is kept without one", () => {
  // given — the scanner reports a legacy CSP header without analysing any directive
  const otherInfo = "The header X-WebKit-CSP was found on this response."
    + " While it is a good sign that CSP is implemented to some degree the policy specified in this"
    + " header has not been analyzed by ZAP.";

  // when
  const alerts = normalizeZapAlerts(cspAlert(otherInfo));

  // then — refusing this aborted the whole assessment, though the alert is perfectly valid
  assert.deepEqual(alerts[0].ruleEvidence,
    { kind: "policy-directive", headerName: "content-security-policy", directives: [] });
});

test("given a name before an announced run, when normalizing it, then only the announced run is read", () => {
  // given — an unfamiliar wording is kept rather than refused, so what it yields has to be right
  const otherInfo = "Warning: the directive default-src was not set,"
    + " so the following are unsafe: script-src img-src";

  // when
  const alerts = normalizeZapAlerts(cspAlert(otherInfo));

  // then — default-src sits in prose rather than in an announced run, so it is left out
  assert.deepEqual(alerts[0].ruleEvidence.directives, ["img-src", "script-src"]);
});

test("given a refusal about a cookie alert, when it reaches the manifest, then redaction leaves it readable", () => {
  // given — a reason ending in "cookie:" matches the redaction pattern and loses its whole excerpt
  const report = { site: [{ alerts: [
    { pluginid: "10054", riskcode: "1", confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "__Host-OTHER", evidence: "Set-Cookie: __Host-OTHER", otherinfo: "" }] }
  ] }] };

  // when
  let published = "";
  try { normalizeZapAlerts(report); } catch (error) { published = boundedAssessmentFailureReason(error.message); }

  // then
  assert.match(published, /__Host-OTHER/);
  assert.doesNotMatch(published, /\[REDACTED\]/);
});

test("given a directive list without a heading, when normalizing it, then every line is named", () => {
  // given — the wildcard template lists the directives on their own lines and announces none of them
  const otherInfo = "script-src\nimg-src\ndefault-src";

  // when
  const alerts = normalizeZapAlerts(cspAlert(otherInfo));

  // then
  assert.deepEqual(alerts[0].ruleEvidence.directives, ["default-src", "img-src", "script-src"]);
});

test("given an unknown name at the head of an announced run, when normalizing it, then the run yields nothing",
  () => {
    // given — a wording that announces something other than directives must not have its words collected
    const otherInfo = "The following were seen: nonsense img-src";

    // when
    const alerts = normalizeZapAlerts(cspAlert(otherInfo));

    // then
    assert.deepEqual(alerts[0].ruleEvidence.directives, []);
  });

test("given an announced run closed by a full stop, when normalizing it, then its last directive is named", () => {
  // given — the fallback template ends its list with a full stop, and plugin-types is one of the ten
  const otherInfo = "The directive(s): plugin-types, style-src, img-src."
    + " is/are among the directives that do not fallback to default-src.";

  // when
  const alerts = normalizeZapAlerts(cspAlert(otherInfo));

  // then — img-src carries the sentence's full stop and is a directive nonetheless
  assert.deepEqual(alerts[0].ruleEvidence.directives, ["img-src", "plugin-types", "style-src"]);
});

test("given a refusal about the session alert, when it reaches the manifest, then redaction leaves it readable",
  () => {
    // given — the cookie names live in the alert's own text, which the redaction removes wholesale
    const report = { site: [{ alerts: [
      { pluginid: "10112", riskcode: "0", confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/`,
        method: "GET", param: "__Host-SESSION", evidence: "__Host-SESSION",
        otherinfo: "cookie:__Host-SESSION\ncookie:__Host-OTHER" }] }
    ] }] };

    // when
    let published = "";
    try { normalizeZapAlerts(report); } catch (error) { published = boundedAssessmentFailureReason(error.message); }

    // then — what it read is stated as counts, so no excerpt is left for the redaction to eat
    assert.match(published, /read 1 known of 2 cookie lines/);
    assert.doesNotMatch(published, /\[REDACTED\]/);
  });

test("given a non-textual evidence field, when normalizing the alert, then the refusal names its type", () => {
  // given — quoting a field that is not text would have printed its JSON rather than saying what it is
  const report = { site: [{ alerts: [
    { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`,
      method: "GET", param: "Content-Security-Policy", evidence: 42, otherinfo: "img-src" }] }
  ] }] };

  // when / then
  assert.throws(() => normalizeZapAlerts(report), /evidence is not text \(number\)/);
});

test("given collected invalid characters after a colon, when normalizing them, then none becomes a directive", () => {
  // given — the malformed-policy template collects non-ASCII characters behind a colon
  const otherInfo = "A non-ASCII character was encountered while attempting"
    + " to parse the policy, thus rendering it invalid (no further evaluation occurred)."
    + " The following invalid characters were collected: \u00e9, \u00fc";

  // when
  const alerts = normalizeZapAlerts(cspAlert(otherInfo));

  // then
  assert.deepEqual(alerts[0].ruleEvidence.directives, []);
});

test("given both CSP wordings on one route, when they are merged, then the evidence names all their directives",
  () => {
    // given
    const report = { site: [{ alerts: [
      { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
        param: "Content-Security-Policy", evidence: "policy-value", otherinfo: "Broad directives:\nimg-src" }] },
      { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
        param: "Content-Security-Policy", evidence: "base-uri 'none'",
        otherinfo: "The directive(s): form-action is/are among the directives that do not fallback to default-src." }] }
    ] }] };

    // when
    const alerts = normalizeZapAlerts(report);

    // then
    assert.equal(alerts.length, 1);
    assert.deepEqual(alerts[0].ruleEvidence.directives, ["form-action", "img-src"]);
  });

test("given two alerts of another rule that disagree on one route, when they are merged, then it fails closed", () => {
  // given — session evidence, whose token names genuinely differ between the two alerts
  const report = { site: [{ alerts: [
    { pluginid: "10112", riskcode: "0", confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "__Host-SESSION", evidence: "__Host-SESSION", otherinfo: "cookie:__Host-SESSION" }] },
    { pluginid: "10112", riskcode: "0", confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "__Host-XSRF-TOKEN", evidence: "__Host-XSRF-TOKEN", otherinfo: "cookie:__Host-XSRF-TOKEN" }] }
  ] }] };

  // when / then
  assert.throws(() => normalizeZapAlerts(report), /contradictory rule evidence/);
});

test("given retained evidence naming a fallback directive, when it is validated, then the check and the schema accept it",
  () => {
    // given
    const evidence = buildPassiveDeploymentEvidence({ targetFingerprint: digest, imageDigest: digest,
      observations: passingObservations(), requestCount: 1,
      zapReport: { version: "2.17.0", site: [{ alerts: [{ pluginid: "10055", riskcode: "2", confidence: "3",
        instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET", param: "Content-Security-Policy",
          evidence: "base-uri 'none'; frame-ancestors 'none'",
          otherinfo: "The directive(s): form-action is/are among the directives that do not fallback to default-src." }] }] }] }
    });

    // when / then — the recomputation and the schema each pinned img-src, so each refused this alone
    assert.deepEqual(evidence.zap.alerts[0].ruleEvidence.directives, ["form-action"]);
    assert.doesNotThrow(() => assertPassiveDeploymentEvidence(evidence));
    const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
    assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
  });

test("given retained evidence naming no directive, when it is validated, then the check and the schema accept it",
  () => {
    // given — the legacy-header templates analyse no policy, so their alert carries an empty list
    const evidence = buildPassiveDeploymentEvidence({ targetFingerprint: digest, imageDigest: digest,
      observations: passingObservations(), requestCount: 1,
      zapReport: { version: "2.17.0", site: [{ alerts: [{ pluginid: "10055", riskcode: "2", confidence: "3",
        instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET", param: "Content-Security-Policy",
          evidence: "base-uri 'none'; frame-ancestors 'none'",
          otherinfo: "The header X-WebKit-CSP was found on this response." }] }] }] }
    });

    // when / then — a minItems of one in the schema aborts the run here, one function past the normalizer
    assert.deepEqual(evidence.zap.alerts[0].ruleEvidence.directives, []);
    assert.doesNotThrow(() => assertPassiveDeploymentEvidence(evidence));
    const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
    assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
  });

const dispositions = JSON.parse(readFileSync(new URL(
  "../security/passive-alert-dispositions.json", import.meta.url)));
const acceptances = JSON.parse(readFileSync(new URL(
  "../security/exceptions.json", import.meta.url))).riskAcceptances;
const baselineCandidates = JSON.parse(readFileSync(new URL(
  "../security/passive-baseline-finding-summary.json", import.meta.url))).candidates;

const cookieAlert = (route) => ({ pluginid: "10010", riskcode: "1", confidence: "2",
  instances: [{ uri: `${passiveScannerOrigin}${route}`, method: "GET", param: "__Host-XSRF-TOKEN",
    evidence: "Set-Cookie: __Host-XSRF-TOKEN", otherinfo: "" }] });

const evidenceFor = (alerts, today) => buildPassiveDeploymentEvidence({
  targetFingerprint: digest, imageDigest: digest, observations: passingObservations(), requestCount: 1,
  zapReport: { version: "2.17.0", site: [{ alerts }] }, today });

test("given an alert a recorded disposition covers, when building evidence, then no candidate remains", () => {
  // given — the run against the disposable target raises this on the site root every time
  const alerts = [cookieAlert("/")];

  // when
  const evidence = evidenceFor(alerts);

  // then
  assert.equal(evidence.zap.alerts[0].state, "false-positive");
  assert.match(evidence.zap.alerts[0].disposition.rationale, /double-submit/);
  assert.equal(evidence.outcome, "passed");
});

test("given an alert nothing has classified, when building evidence, then the run stays incomplete", () => {
  // given — a rule on a route no disposition names is the case the mechanism exists for
  const alerts = [cookieAlert("/font-licenses.txt")];

  // when
  const evidence = evidenceFor(alerts);

  // then
  assert.equal(evidence.zap.alerts[0].state, "candidate");
  assert.equal(evidence.outcome, "incomplete");
});

const acceptedDirectives = ["connect-src", "font-src", "form-action", "frame-src", "img-src",
  "manifest-src", "media-src", "object-src", "script-src", "style-src", "worker-src"];
const acceptedOccurrences = 5;
const policyAlert = (directives, riskcode = "2", occurrences = acceptedOccurrences) => ({
  pluginid: "10055", riskcode, confidence: "3",
  instances: Array.from({ length: occurrences }, () => ({ uri: `${passiveScannerOrigin}/`, method: "GET",
    param: "Content-Security-Policy", evidence: "base-uri 'none'; frame-ancestors 'none'",
    otherinfo: `The following directives either allow wildcard sources (or ancestors), are not defined,`
      + ` or are overly broadly defined:\n${directives.join("\n")}` })) });

test("given an alert an unexpired acceptance covers, when building evidence, then the run passes", () => {
  // given — the CSP alert on the site root is the accepted remote-logo risk, not a false positive
  const alerts = [policyAlert(acceptedDirectives)];

  // when
  const evidence = evidenceFor(alerts, "2026-09-10");

  // then
  assert.equal(evidence.zap.alerts[0].state, "accepted-risk");
  assert.equal(evidence.zap.alerts[0].acceptance.id, "remote-https-club-logo-2026");
  assert.equal(evidence.outcome, "passed");
});

test("given the acceptance has expired, when building evidence, then its alert is an open candidate again", () => {
  // given — the same alert, read on a day past the recorded expiry
  const alerts = [policyAlert(acceptedDirectives)];

  // when
  const evidence = evidenceFor(alerts, "2027-01-01");

  // then — an expiry that quietly kept passing would be the whole point of the date missed
  assert.equal(evidence.zap.alerts[0].state, "candidate");
  assert.equal(evidence.outcome, "incomplete");
});

test("given the same rule reports a louder risk, when building evidence, then the record stops covering it", () => {
  // given — a fingerprint names a rule and a route, so risk has to be compared beside it
  const alerts = [policyAlert(acceptedDirectives, "3")];

  // when
  const evidence = evidenceFor(alerts, "2026-09-10");

  // then
  assert.equal(evidence.zap.alerts[0].state, "candidate");
  assert.equal(evidence.outcome, "incomplete");
});

test("given the same rule reports something else, when building evidence, then the record stops covering it",
  () => {
    // given — a leaked comment in a rebuilt asset carries the fingerprint of the disposed one
    const alerts = [{ pluginid: "10027", riskcode: "0", confidence: "2", instances: [{
      uri: `${passiveScannerOrigin}/assets/index-a1b2c3.js`, method: "GET", param: "", evidence: "select",
      otherinfo: "The following pattern was used: \\bSELECT\\b and it matched secret-like text." }] }];

    // when
    const evidence = evidenceFor(alerts, "2026-09-10");

    // then — the disposed alert on this route matched the word query, and this one does not
    assert.equal(evidence.zap.alerts[0].state, "candidate");
    assert.equal(evidence.outcome, "incomplete");
  });

test("given a scanner other than the one a record names, when it is matched, then it covers nothing", () => {
  // given — a bump of the pinned image changes what a rule reports, so a record does not carry over
  const record = dispositions.dispositions[0];
  const alert = { pluginId: record.pluginId, method: record.method, routeTemplate: record.routeTemplate,
    riskCode: record.riskCode, confidence: record.confidence, count: record.count,
    fingerprint: record.fingerprint,
    ruleEvidence: { kind: "cookie-attribute", cookieName: "xsrf-token", missingAttribute: "http-only" } };

  // when / then
  assert.equal(recordCovers(record, alert), true);
  assert.equal(recordCovers({ ...record, scannerVersion: "2.16.0" }, alert), false);
  assert.ok(dispositions.dispositions.every((entry) => entry.scannerVersion === zapVersion));
});

test("given an alert no record covers, when it is validated, then no record bounds the day it was read",
  () => {
    // given — a louder variant shares the fingerprint of a record that does not cover it
    const readBeforeTheRecord = "2026-09-01";

    // when / then — bounding by the fingerprint would reject this and blame a back-dated clock
    assert.doesNotThrow(() => evidenceFor([policyAlert(acceptedDirectives, "3")], readBeforeTheRecord));
    assert.equal(evidenceFor([policyAlert(acceptedDirectives, "3")], readBeforeTheRecord)
      .zap.alerts[0].state, "candidate");
  });

test("given a record whose own rule and route miss its fingerprint, when it is matched, then it covers nothing",
  () => {
    // given — the fingerprint is a hash, so a record could name one its own three fields do not produce
    const record = dispositions.dispositions[0];
    const alert = { pluginId: record.pluginId, method: record.method, routeTemplate: record.routeTemplate,
      riskCode: record.riskCode, confidence: record.confidence, count: record.count,
    fingerprint: record.fingerprint,
      ruleEvidence: { kind: "cookie-attribute", cookieName: "xsrf-token", missingAttribute: "http-only" } };

    // when / then — the alert still carries that fingerprint, so only the recomputation catches this
    assert.equal(recordCovers({ ...record, pluginId: "10054" }, { ...alert, pluginId: "10054" }), false);
    assert.equal(recordCovers({ ...record, routeTemplate: "/login" }, { ...alert, routeTemplate: "/login" }),
      false);
  });

test("given a back-dated evidence file, when it is validated, then its own day cannot revive an expiry", () => {
  // given — an artefact claiming it was read before the acceptance was written
  const evidence = evidenceFor([policyAlert(acceptedDirectives)], "2026-09-10");
  evidence.readOn = "2020-01-01";

  // when / then — the record it used is newer than the day it claims, which no clock can produce
  assert.throws(() => assertPassiveDeploymentEvidence(evidence), /read before the record it relies on/);
});

test("given a day no calendar has, when building evidence, then the assessment refuses to read one", () => {
  // when / then
  assert.throws(() => evidenceFor([policyAlert(acceptedDirectives)], "2026-02-31"), /no readable day/);
  assert.throws(() => evidenceFor([policyAlert(acceptedDirectives)], "2026-9-10"), /no readable day/);
});

test("given resolved alerts beside an open one, when the summary is written, then it counts only the open one",
  () => {
    // given
    const evidence = evidenceFor([policyAlert(acceptedDirectives), cookieAlert("/font-licenses.txt")],
      "2026-09-10");

    // when / then — alerts.length was the candidate count until a record could resolve one
    assert.equal(openCandidateCount(evidence), 1);
    assert.match(passiveDeploymentSummary(evidence), /ZAP candidates: 1 of 2 alerts/);
  });

test("given evidence claiming a state nothing recorded, when it is validated, then it fails closed", () => {
  // given
  const evidence = evidenceFor([cookieAlert("/font-licenses.txt")]);
  evidence.zap.alerts[0].state = "false-positive";
  evidence.zap.alerts[0].disposition = { rationale: "looks fine", actor: "nobody",
    classifiedAt: "2026-09-10T00:00:00.000Z", reference: "none" };

  // when / then
  assert.throws(() => assertPassiveDeploymentEvidence(evidence), /unrecorded alert disposition/);
});

test("given evidence rewording a disposition it did record, when it is validated, then it fails closed", () => {
  // given — the state is the one the record gives, and only the reason beside it was rewritten
  const evidence = evidenceFor([cookieAlert("/")]);
  assert.equal(evidence.zap.alerts[0].state, "false-positive");
  evidence.zap.alerts[0].disposition = { ...evidence.zap.alerts[0].disposition, rationale: "trust me" };

  // when / then
  assert.throws(() => assertPassiveDeploymentEvidence(evidence), /unrecorded alert disposition/);
});

test("given evidence rewording an acceptance it did record, when it is validated, then it fails closed", () => {
  // given — the acceptance the evidence publishes has to be the one the record resolved it against
  const evidence = evidenceFor([policyAlert(acceptedDirectives)], "2026-09-10");
  assert.equal(evidence.zap.alerts[0].state, "accepted-risk");
  evidence.zap.alerts[0].acceptance = { ...evidence.zap.alerts[0].acceptance, expiresOn: "2099-12-31" };

  // when / then
  assert.throws(() => assertPassiveDeploymentEvidence(evidence), /unrecorded alert disposition/);
});

const acceptedRecord = () => dispositions.dispositions.find(({ state }) => state === "accepted-risk");
const acceptedAlert = (overrides = {}) => {
  const record = acceptedRecord();
  return { pluginId: record.pluginId, method: record.method, routeTemplate: record.routeTemplate,
    riskCode: record.riskCode, confidence: record.confidence, count: record.count,
    fingerprint: record.fingerprint,
    ruleEvidence: { kind: "policy-directive", headerName: record.observed.headerName,
      directives: record.observed.directives }, ...overrides };
};
const acceptanceMap = () => new Map(acceptances.map((entry) => [entry.id, entry]));

test("given the rule reports a different confidence, when it is matched, then the record covers nothing", () => {
  // given — a rule that grows more certain about the same route is saying something new
  const record = acceptedRecord();

  // when / then
  assert.equal(recordCovers(record, acceptedAlert()), true);
  assert.equal(recordCovers(record, acceptedAlert({ confidence: record.confidence + 1 })), false);
});

test("given a record naming an acceptance nobody wrote, when it is resolved, then the alert stays open", () => {
  // given — the record names the acceptance rather than restating it, so the acceptance has to exist
  const record = { ...acceptedRecord(), acceptanceId: "no-such-acceptance-2026" };

  // when
  const resolved = resolveAlertAgainst([record], acceptanceMap(), acceptedAlert(), "2026-09-10");

  // then
  assert.deepEqual(resolved, { state: "candidate" });
});

test("given an acceptance written about another alert, when it is resolved, then the alert stays open", () => {
  // given — an acceptance carries the fingerprint it was written for, and it has to be this one
  const foreign = acceptances.map((entry) => ({ ...entry, fingerprint: `sha256:${"b".repeat(64)}` }));

  // when
  const resolved = resolveAlertAgainst([acceptedRecord()], new Map(foreign.map((e) => [e.id, e])),
    acceptedAlert(), "2026-09-10");

  // then
  assert.deepEqual(resolved, { state: "candidate" });
});

test("given a record written in another key order, when it is matched, then it still covers its alert", () => {
  // given — a reformatter must not turn every resolution into a candidate without saying so
  const record = acceptedRecord();
  const reordered = { ...record, observed: { directives: [...record.observed.directives].toReversed(),
    kind: record.observed.kind, headerName: record.observed.headerName } };

  // when / then
  assert.equal(recordCovers(reordered, acceptedAlert()), true);
});

test("given one more occurrence than the record names, when it is matched, then the record covers nothing",
  () => {
    // given — the scanner merges every wording of one rule on one route, so a sixth is invisible in the
    // directive union and visible only in the count
    const record = acceptedRecord();

    // when / then
    assert.equal(recordCovers(record, acceptedAlert()), true);
    assert.equal(recordCovers(record, acceptedAlert({ count: record.count + 1 })), false);
  });

test("given a second wording merged into an accepted alert, when building evidence, then it stays open", () => {
  // given — a legacy CSP header ZAP does not analyse names no directive, so the union does not move
  const alerts = [policyAlert(acceptedDirectives), { pluginid: "10055", riskcode: "2", confidence: "3",
    instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET", param: "Content-Security-Policy",
      evidence: "base-uri 'none'; frame-ancestors 'none'",
      otherinfo: "The header X-WebKit-CSP was found on this response." }] }];

  // when
  const evidence = evidenceFor(alerts, "2026-09-10");

  // then
  assert.deepEqual(evidence.zap.alerts[0].ruleEvidence.directives, acceptedDirectives);
  assert.equal(evidence.zap.alerts[0].state, "candidate");
  assert.equal(evidence.outcome, "incomplete");
});

test("given a second asset matching the same pattern, when building evidence, then the alert stays open", () => {
  // given — one instance carries the pattern sentence and the other inherits it from the alert level
  const alerts = [{ pluginid: "10027", riskcode: "0", confidence: "2",
    otherinfo: "The following pattern was used: \\bQUERY\\b and matched omitted text.",
    instances: [
      { uri: `${passiveScannerOrigin}/assets/index-a1b2c3.js`, method: "GET", param: "", evidence: "query",
        otherinfo: "The following pattern was used: \\bQUERY\\b" },
      { uri: `${passiveScannerOrigin}/assets/index-d4e5f6.js`, method: "GET", param: "", evidence: "query",
        otherinfo: "scanner-specific summary" }
    ] }];

  // when
  const evidence = evidenceFor(alerts, "2026-09-10");

  // then — the pattern set is unchanged and only the count says a second asset appeared
  assert.deepEqual(evidence.zap.alerts[0].ruleEvidence.matches.map(({ patternId }) => patternId),
    ["comment-query", "comment-query"]);
  assert.equal(evidence.zap.alerts[0].count, 2);
  assert.equal(evidence.zap.alerts[0].state, "candidate");
  assert.equal(evidence.outcome, "incomplete");
});

test("given rule evidence no discriminator reads, when it is discriminated, then it refuses to guess", () => {
  // given — a seventh evidence kind would otherwise be told apart by its kind alone
  const unknown = { kind: "future-signal", headerName: "server", loudness: "high" };

  // when / then
  assert.throws(() => alertDiscriminator(unknown), /No passive alert discriminator reads/);
  assert.deepEqual(alertDiscriminator({ kind: "response-header", headerName: "server" }),
    { kind: "response-header", headerName: "server" });
});

test("given an expiry no calendar has, when it is resolved, then the acceptance stops covering", () => {
  // given — the day is validated as a calendar day and the expiry it is compared against was not
  const impossible = acceptances.map((entry) => ({ ...entry, expiresOn: "2026-13-01" }));

  // when
  const resolved = resolveAlertAgainst([acceptedRecord()], new Map(impossible.map((e) => [e.id, e])),
    acceptedAlert(), "2026-09-10");

  // then — a month that does not exist sorts after every real day of the year
  assert.deepEqual(resolved, { state: "candidate" });
});

test("given a key shaped like a pair, when the record is matched, then it cannot impersonate one", () => {
  // given — canonical() interpolated keys raw, so one key could read as a key and a value
  const record = acceptedRecord();
  const forged = { ...record, observed: { [`headerName:"content-security-policy",kind`]: "policy-directive",
    directives: record.observed.directives } };

  // when / then
  assert.equal(recordCovers(forged, acceptedAlert()), false);
});

test("given an evidence file claiming a verdict its alerts deny, when it is validated, then it fails closed",
  () => {
    // given
    const evidence = evidenceFor([cookieAlert("/font-licenses.txt")]);
    assert.equal(evidence.outcome, "incomplete");
    evidence.outcome = "passed";

    // when / then
    assert.throws(() => assertPassiveDeploymentEvidence(evidence), /outcome its own checks and alerts do not/);
  });

test("given the recorded dispositions, when they are read, then each names a rationale, an actor and a source",
  () => {
    // given
    const validate = new Ajv({ strict: true, allErrors: true }).compile(JSON.parse(readFileSync(
      new URL("../security/passive-alert-dispositions.schema.json", import.meta.url))));

    // when / then
    assert.equal(validate(dispositions), true, JSON.stringify(validate.errors));
    assert.ok(dispositions.dispositions.length > 0);
    assert.equal(new Set(dispositions.dispositions.map(({ fingerprint }) => fingerprint)).size,
      dispositions.dispositions.length);
    for (const entry of dispositions.dispositions) {
      assert.equal(entry.fingerprint,
        passiveAlertFingerprint(entry.pluginId, entry.method, entry.routeTemplate),
        `${entry.pluginId} ${entry.routeTemplate} names a fingerprint its own rule and route do not produce`);
      if (entry.state === "accepted-risk") {
        assert.ok(acceptances.some(({ id }) => id === entry.acceptanceId),
          `${entry.acceptanceId} is named by a record and written down nowhere`);
      } else {
        const carried = baselineCandidates.find(({ fingerprint }) => fingerprint === entry.fingerprint);
        assert.ok(carried === undefined || carried.state === entry.state,
          `${entry.fingerprint} is dismissed against a triage summary that classified it ${carried?.state}`);
      }
    }
  });

test("given a CSP alert about another header, when normalizing it, then the evidence fails closed", () => {
  // given — the wording may be anything, but the header the alert describes may not
  const report = { site: [{ alerts: [
    { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "X-Frame-Options", evidence: "policy-value",
      otherinfo: "A wholly new sentence ZAP has started producing." }] }
  ] }] };

  // when / then
  assert.throws(() => normalizeZapAlerts(report), /unsupported rule evidence/);
});

test("given evidence that is refused, when the refusal is read, then it says what it saw", () => {
  // given
  const report = { site: [{ alerts: [
    { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "X-Frame-Options", evidence: "",
      otherinfo: "A wholly new sentence ZAP has started producing." }] }
  ] }] };

  // when / then — a refusal naming only the rule costs a local reproduction to diagnose
  assert.throws(() => normalizeZapAlerts(report), (error) =>
    /does not describe the policy header/.test(error.message)
      && error.message.includes("X-Frame-Options")
      && error.message.includes("A wholly new sentence ZAP has started producing."));
});

test("given an alert field that is far too long, when it appears in a refusal, then the refusal stays bounded", () => {
  // given
  const report = { site: [{ alerts: [
    { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "X-Frame-Options", evidence: "policy-value", otherinfo: "z".repeat(5000) }] }
  ] }] };

  // when / then
  assert.throws(() => normalizeZapAlerts(report), (error) =>
    error.message.length < 600 && error.message.includes('...')
      && !error.message.includes('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'));
});

test("given an otherinfo shaped to make the sentence parser backtrack, when normalizing it, then it does not spin",
  () => {
    // given — a param and an evidence that pass every cheap check, so the parser itself is measured
    const report = { site: [{ alerts: [
      { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
        param: "Content-Security-Policy", evidence: "policy-value",
        otherinfo: `The directive(s):${" ".repeat(4000)}` }] }
    ] }] };

    // when
    const started = performance.now();
    assert.deepEqual(normalizeZapAlerts(report)[0].ruleEvidence.directives, []);
    const elapsed = performance.now() - started;

    // then — the regex this replaced needed about eleven seconds for this input, a scan a fraction of one
    assert.ok(elapsed < 500, `normalizing an adversarial otherinfo took ${elapsed.toFixed(0)} ms`);
  });

test("given an otherinfo dense with colons, when normalizing it, then the directive scan stays linear", () => {
  // given — each colon opens a directive run, so re-scanning the remainder per colon would be quadratic
  const report = { site: [{ alerts: [
    { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "Content-Security-Policy", evidence: "policy-value", otherinfo: ": ".repeat(40000) }] }
  ] }] };

  // when
  const started = performance.now();
  assert.deepEqual(normalizeZapAlerts(report)[0].ruleEvidence.directives, []);
  const elapsed = performance.now() - started;

  // then — a per-colon rescan needs about fifteen seconds for this input, a single pass a few milliseconds
  assert.ok(elapsed < 1000, `scanning a colon-dense otherinfo took ${elapsed.toFixed(0)} ms`);
});

test("given one token of trailing punctuation, when normalizing it, then stripping it stays linear", () => {
  // given — an anchored /[.;]+$/ backtracks from every start offset of a token that never ends in one
  const report = { site: [{ alerts: [
    { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "Content-Security-Policy", evidence: "policy-value", otherinfo: `${";".repeat(80000)}x` }] }
  ] }] };

  // when
  const started = performance.now();
  assert.deepEqual(normalizeZapAlerts(report)[0].ruleEvidence.directives, []);
  const elapsed = performance.now() - started;

  // then — the regex needs about three seconds for this token, a backward walk a fraction of one
  assert.ok(elapsed < 500, `stripping trailing punctuation took ${elapsed.toFixed(0)} ms`);
});

test("given session fields that name different tokens, when normalizing them, then the evidence fails closed", () => {
  // given
  const report = { site: [{ alerts: [{ pluginid: "10112", riskcode: "0", confidence: "2",
    instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET", param: "__Host-SESSION", evidence: "__Host-SESSION",
      otherinfo: "cookie:__Host-XSRF-TOKEN" }] }] }] };

  // when / then
  assert.throws(() => normalizeZapAlerts(report), /unsupported rule evidence/);
});

test("given a passive alert on an unclassified dynamic route, when normalizing it, then evidence fails closed", () => {
  // given
  const report = { site: [{ alerts: [{ pluginid: "10020", riskcode: "1", confidence: "2",
    instances: [{ uri: `${passiveScannerOrigin}/api/admin/roster/00000000-0000-0000-0000-000000000101`,
      method: "GET" }] }] }] };

  // when / then
  assert.throws(() => normalizeZapAlerts(report), /unclassified route/);
});

test("given a passive alert tied to a query value, when normalizing it, then the value is neither dropped nor retained", () => {
  // given
  const report = { site: [{ alerts: [{ pluginid: "10020", riskcode: "1", confidence: "2",
    instances: [{ uri: `${passiveScannerOrigin}/api/source?probe=opaque`, method: "GET" }] }] }] };

  // when / then
  assert.throws(() => normalizeZapAlerts(report), /unclassified route/);
});

test("given missing scanner structure, when normalizing alerts, then absence cannot mean a clean scan", () => {
  // when / then
  assert.throws(() => normalizeZapAlerts({}), /invalid report/);
  assert.throws(() => normalizeZapAlerts({ site: [] }), /invalid report/);
  assert.throws(() => normalizeZapAlerts({ site: [{}] }), /invalid report/);
});

test("given a malformed alert or instance, when normalizing it, then parsing fails closed", () => {
  // when / then
  assert.throws(() => normalizeZapAlerts({ site: [{ alerts: [null] }] }), /invalid alert record/);
  assert.throws(() => normalizeZapAlerts({ site: [{ alerts: [{ pluginid: "10020", riskcode: "1",
    confidence: "2", instances: [null] }] }] }), /invalid alert record/);
});

test("given a foreign origin or URL credential, when normalizing alerts, then target attribution fails closed", () => {
  // given
  const alert = (uri) => ({ site: [{ alerts: [{ pluginid: "10020", riskcode: "1", confidence: "2",
    instances: [{ uri, method: "GET" }] }] }] });

  // when / then
  assert.throws(() => normalizeZapAlerts(alert("https://foreign.example/api/source")), /unclassified route/);
  assert.throws(() => normalizeZapAlerts(alert("http://user:secret@scanner-gateway:8090/api/source")),
    /unclassified route/);
});

test("given contradictory ratings for one candidate, when normalizing alerts, then one fingerprint cannot mean both", () => {
  // given
  const instance = { uri: `${passiveScannerOrigin}/api/source`, method: "GET", param: "__Host-XSRF-TOKEN",
    evidence: "Set-Cookie: __Host-XSRF-TOKEN", otherinfo: "" };
  const report = { site: [{ alerts: [
    { pluginid: "10010", riskcode: "1", confidence: "2", instances: [instance] },
    { pluginid: "10010", riskcode: "2", confidence: "3", instances: [instance] }
  ] }] };

  // when / then
  assert.throws(() => normalizeZapAlerts(report), /contradictory alert/);
});

test("given an untriaged ZAP candidate, when building evidence, then the assessment is incomplete", () => {
  // when — the same rule on a route no disposition names, so nothing has classified this one
  const evidence = buildPassiveDeploymentEvidence({
    targetFingerprint: digest, imageDigest: digest,
    observations: passingObservations(),
    zapReport: { version: "2.17.0", site: [{ alerts: [{ pluginid: "10010", riskcode: "1",
      confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/font-licenses.txt`, method: "GET",
        param: "__Host-XSRF-TOKEN", evidence: "Set-Cookie: __Host-XSRF-TOKEN", otherinfo: "" }] }] }] },
    requestCount: 1
  });

  // then
  assert.equal(evidence.outcome, "incomplete");
  assert.doesNotMatch(passiveDeploymentSummary(evidence), /proxy:8080/);
});

test("given a forged retained fingerprint, when validating evidence, then its identity is recomputed", () => {
  // given
  const evidence = buildPassiveDeploymentEvidence({ targetFingerprint: digest, imageDigest: digest,
    observations: passingObservations(), requestCount: 1,
    zapReport: { version: "2.17.0", site: [{ alerts: [{ pluginid: "10010", riskcode: "1",
      confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET", param: "__Host-XSRF-TOKEN",
        evidence: "Set-Cookie: __Host-XSRF-TOKEN", otherinfo: "" }] }] }] }
  });
  evidence.zap.alerts[0].fingerprint = `sha256:${"b".repeat(64)}`;

  // when / then
  assert.throws(() => assertPassiveDeploymentEvidence(evidence), /fingerprint/);
});

test("given forged rule evidence, when validating retained evidence, then rule semantics are recomputed", () => {
  // given
  const evidence = buildPassiveDeploymentEvidence({ targetFingerprint: digest, imageDigest: digest,
    observations: passingObservations(), requestCount: 1,
    zapReport: { version: "2.17.0", site: [{ alerts: [{ pluginid: "10027", riskcode: "0", confidence: "1",
      instances: [{ uri: `${passiveScannerOrigin}/assets/index-a1b2c3.js`, method: "GET", param: "",
        evidence: "select", otherinfo: "The following pattern was used: \\bSELECT\\b" }] }] }] }
  });

  // when / then
  evidence.zap.alerts[0].ruleEvidence.matches[0].locationDigest = digest;
  assert.throws(() => assertPassiveDeploymentEvidence(evidence), /rule evidence/);
  evidence.zap.alerts[0].ruleEvidence = { kind: "cookie-attribute", cookieName: "xsrf-token",
    missingAttribute: "http-only" };
  assert.throws(() => assertPassiveDeploymentEvidence(evidence), /rule evidence/);
  evidence.zap.alerts[0].ruleEvidence.extra = "secret";
  assert.throws(() => assertPassiveDeploymentEvidence(evidence), /invalid/);
});

test("given duplicate text locations, when validating retained evidence, then one location has one encoding", () => {
  // given
  const instance = { uri: `${passiveScannerOrigin}/assets/index-a1b2c3.js`, method: "GET", param: "",
    evidence: "select", otherinfo: "The following pattern was used: \\bSELECT\\b" };
  const zapReport = (instances) => ({ version: "2.17.0", site: [{ alerts: [{ pluginid: "10027",
    riskcode: "0", confidence: "1", instances }] }] });
  const evidence = buildPassiveDeploymentEvidence({ targetFingerprint: digest, imageDigest: digest,
    observations: passingObservations(), requestCount: 1, zapReport: zapReport([instance])
  });
  const repeated = buildPassiveDeploymentEvidence({ targetFingerprint: digest, imageDigest: digest,
    observations: passingObservations(), requestCount: 1, zapReport: zapReport([instance, instance])
  });
  evidence.zap.alerts[0].count = 3;
  evidence.zap.alerts[0].ruleEvidence.matches.push(repeated.zap.alerts[0].ruleEvidence.matches[0]);

  // when / then
  assert.throws(() => assertPassiveDeploymentEvidence(evidence), /rule evidence/);
});

test("given non-canonical session evidence, when validating it, then equivalent facts cannot have two encodings", () => {
  // given
  const evidence = buildPassiveDeploymentEvidence({ targetFingerprint: digest, imageDigest: digest,
    observations: passingObservations(), requestCount: 1,
    zapReport: { version: "2.17.0", site: [{ alerts: [{ pluginid: "10112", riskcode: "0", confidence: "2",
      instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET", param: "__Host-SESSION", evidence: "__Host-SESSION",
        otherinfo: "cookie:__Host-SESSION\ncookie:__Host-XSRF-TOKEN" }] }] }] }
  });
  evidence.zap.alerts[0].ruleEvidence.tokenNames.reverse();

  // when / then
  assert.throws(() => assertPassiveDeploymentEvidence(evidence), /rule evidence/);
});

test("given a request count above the safe budget, when building evidence, then the run fails closed", () => {
  // when / then
  assert.throws(() => buildPassiveDeploymentEvidence({
    targetFingerprint: digest, imageDigest: digest, observations: [],
    zapReport: { version: "2.17.0", site: [{ alerts: [] }] }, requestCount: 1001
  }), /request budget/);
});

test("given missing or duplicate checks, when building evidence, then the run fails closed", () => {
  // given
  const observations = passingObservations();

  // when / then
  assert.throws(() => buildPassiveDeploymentEvidence({ targetFingerprint: digest, imageDigest: digest,
    observations: observations.slice(1), zapReport: { version: "2.17.0", site: [] }, requestCount: 1
  }), /missing required checks/);
  assert.throws(() => buildPassiveDeploymentEvidence({ targetFingerprint: digest, imageDigest: digest,
    observations: [...observations, observations[0]], zapReport: { version: "2.17.0", site: [] }, requestCount: 1
  }), /missing required checks/);
});

test("given malformed scanner output, when normalizing alerts, then the run fails closed", () => {
  // when / then
  assert.throws(() => normalizeZapAlerts({ site: [{ alerts: [{ pluginid: "secret", riskcode: 8,
    confidence: {}, instances: [] }] }] }), /invalid alert/);
});

test("given deployment qualification, when its digest or checks differ, then consumption fails closed", () => {
  // given
  const qualification = { schemaVersion: 1, status: "passed", manifestDigest: digest, architecture: "arm64",
    checks: { deployment: true, authentication: true, bookingPersistence: true, hardening: true } };

  // when / then
  assert.doesNotThrow(() => assertQualifiedImageEvidence(qualification, digest, "arm64"));
  assert.throws(() => assertQualifiedImageEvidence({ ...qualification,
    manifestDigest: `sha256:${"b".repeat(64)}` }, digest, "arm64"), /does not prove/);
  assert.throws(() => assertQualifiedImageEvidence({ ...qualification,
    checks: { ...qualification.checks, hardening: false } }, digest, "arm64"), /does not prove/);
  assert.throws(() => assertQualifiedImageEvidence(qualification, digest, "amd64"), /does not prove/);
});

test("given an emergency stop, when an owned scanner is running, then it is killed and cleaned up", async () => {
  // given
  const stopFile = join(mkdtempSync(join(tmpdir(), "courtside-passive-stop-")), "STOP");
  let cleaned = false;
  setTimeout(() => writeFileSync(stopFile, "stop"), 50);

  // when / then
  await assert.rejects(runOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    timeoutMilliseconds: 5_000,
    stopFile,
    cleanup: async () => { cleaned = true; }
  }), /Emergency stop requested/);
  assert.equal(cleaned, true);
});

test("given an emergency stop during native checks, when another request is considered, then it fails closed", async () => {
  // given
  const stopFile = join(mkdtempSync(join(tmpdir(), "courtside-native-stop-")), "STOP");
  const control = createAssessmentControl(stopFile, new Date(Date.now() + 5_000));
  writeFileSync(stopFile, "stop");

  // when / then
  assert.throws(() => control.beforeRequest(), /emergency stop/);
  assert.equal(control.signal.aborted, true);
  control.close();
});

test("given an expired assessment deadline, when a native request is considered, then it fails closed", () => {
  // given
  const stopFile = join(mkdtempSync(join(tmpdir(), "courtside-native-deadline-")), "STOP");
  const control = createAssessmentControl(stopFile, new Date(Date.now() - 1));

  // when / then
  assert.throws(() => control.beforeRequest(), /duration budget/);
  assert.equal(control.signal.aborted, true);
  control.close();
});

test("given a scanner failure, when the process exits, then transient resources are cleaned up", async () => {
  // given
  let cleaned = false;

  // when / then
  await assert.rejects(runOwnedProcess(process.execPath, ["-e", "process.exit(2)"], {
    timeoutMilliseconds: 5_000,
    stopFile: join(mkdtempSync(join(tmpdir(), "courtside-passive-failure-")), "STOP"),
    cleanup: async () => { cleaned = true; }
  }), /Owned security process failed/);
  assert.equal(cleaned, true);
});

test("given a scanner reaches its request boundary, when it is still running, then it is killed", async () => {
  // given
  let cleaned = false;

  // when / then
  await assert.rejects(runOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    timeoutMilliseconds: 5_000,
    stopFile: join(mkdtempSync(join(tmpdir(), "courtside-passive-budget-")), "STOP"),
    guard: () => true,
    guardFailure: "The scanner request budget was reached",
    cleanup: async () => { cleaned = true; }
  }), /request budget was reached/);
  assert.equal(cleaned, true);
});
