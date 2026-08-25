import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertPassiveDeploymentEvidence, assertQualifiedImageEvidence, buildPassiveDeploymentEvidence, createAssessmentControl,
  evaluatePublicResponseHeaders, normalizeZapAlerts, passiveDeploymentSummary, passiveScannerOrigin, requiredPassiveCheckIds,
  runOwnedProcess
} from "./security-passive-deployment.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const schema = JSON.parse(readFileSync(new URL(
  "../security/passive-deployment-evidence.schema.json", import.meta.url)));
const digest = `sha256:${"a".repeat(64)}`;
const observationById = {
  "body-limit": "proxy-body-limit-enforced", "certificate-trust": "certificate-chain-and-host-valid",
  "direct-forwarded-behavior": "direct-app-distinguished-from-proxy", "forwarded-boundary": "spoofed-host-rejected",
  "header-limit": "oversized-header-rejected", "http-redirect": "http-port-not-published",
  "host-boundary": "upstream-host-canonicalized",
  "loopback-publication": "proxy-loopback-only", "management-separation": "management-internal-only",
  "qualified-image-evidence": "covered-by-image-qualification", "runtime-hardening": "runtime-controls-present",
  "scanner-runtime-hardening": "scanner-runtime-controls-present",
  "secure-cookie-delivery": "issued-cookies-secure", "tls-versions": "tls12-and-tls13-only",
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

test("given the public response boundary, when CSP or proxy disclosure is broader than intended, then it fails closed", () => {
  // given
  const headers = new Map([
    ["content-security-policy", "default-src 'self'; object-src 'none'; img-src 'self' https:; "
      + "style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; "
      + "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"],
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
      { uri: `${passiveScannerOrigin}/api/source`, method: "GET", param: "XSRF-TOKEN",
        evidence: "Set-Cookie: XSRF-TOKEN", otherinfo: "" },
      { uri: `${passiveScannerOrigin}/api/source`, method: "GET", param: "XSRF-TOKEN",
        evidence: "Set-Cookie: XSRF-TOKEN", otherinfo: "" },
      { uri: `${passiveScannerOrigin}/assets/index-a1b2c3.js`, method: "GET", param: "XSRF-TOKEN",
        evidence: "Set-Cookie: XSRF-TOKEN", otherinfo: "" }
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
  assert.doesNotMatch(JSON.stringify(alerts), /localhost|secret|SESSION/);
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
      param: "XSRF-TOKEN", evidence: "Set-Cookie: XSRF-TOKEN", otherinfo: "" }] },
    { pluginid: "10055", riskcode: "2", confidence: "3", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "Content-Security-Policy", evidence: "policy-value", otherinfo: "Broad directives:\nimg-src" }] },
    { pluginid: "10109", riskcode: "0", confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "", evidence: "<script src=secret>",
      otherinfo: "No links have been found while there are scripts, indicating a modern application." }] },
    { pluginid: "10112", riskcode: "0", confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET",
      param: "SESSION", evidence: "SESSION", otherinfo: "cookie:SESSION\ncookie:XSRF-TOKEN" }] }
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

test("given session fields that name different tokens, when normalizing them, then the evidence fails closed", () => {
  // given
  const report = { site: [{ alerts: [{ pluginid: "10112", riskcode: "0", confidence: "2",
    instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET", param: "SESSION", evidence: "SESSION",
      otherinfo: "cookie:XSRF-TOKEN" }] }] }] };

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
  const instance = { uri: `${passiveScannerOrigin}/api/source`, method: "GET", param: "XSRF-TOKEN",
    evidence: "Set-Cookie: XSRF-TOKEN", otherinfo: "" };
  const report = { site: [{ alerts: [
    { pluginid: "10010", riskcode: "1", confidence: "2", instances: [instance] },
    { pluginid: "10010", riskcode: "2", confidence: "3", instances: [instance] }
  ] }] };

  // when / then
  assert.throws(() => normalizeZapAlerts(report), /contradictory alert/);
});

test("given an untriaged ZAP candidate, when building evidence, then the assessment is incomplete", () => {
  // when
  const evidence = buildPassiveDeploymentEvidence({
    targetFingerprint: digest, imageDigest: digest,
    observations: passingObservations(),
    zapReport: { version: "2.17.0", site: [{ alerts: [{ pluginid: "10010", riskcode: "1",
      confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET", param: "XSRF-TOKEN",
        evidence: "Set-Cookie: XSRF-TOKEN", otherinfo: "" }] }] }] }, requestCount: 1
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
      confidence: "2", instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET", param: "XSRF-TOKEN",
        evidence: "Set-Cookie: XSRF-TOKEN", otherinfo: "" }] }] }] }
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
      instances: [{ uri: `${passiveScannerOrigin}/`, method: "GET", param: "SESSION", evidence: "SESSION",
        otherinfo: "cookie:SESSION\ncookie:XSRF-TOKEN" }] }] }] }
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
