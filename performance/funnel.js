import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const contract = JSON.parse(open("/scripts/contract.json"));
const profile = contract.profiles["funnel-smoke"];
const target = __ENV.PERF_TARGET;
const unexpectedServerErrors = new Counter("unexpected_server_errors");
const technicalErrors = new Rate("technical_errors");
const readLatency = new Trend("read_only_api_duration", true);

export const options = {
  noCookiesReset: true,
  blacklistIPs: [
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
    "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15",
    "::1/128", "fc00::/7", "fe80::/10"
  ],
  vus: profile.virtualUsers,
  duration: profile.duration,
  thresholds: {
    technical_errors: [contract.thresholds.technicalErrorRate],
    unexpected_server_errors: [contract.thresholds.unexpectedServerErrors],
    read_only_api_duration: [
      `p(95)<${contract.thresholds.readOnlyApi.p95Milliseconds}`,
      `p(99)<${contract.thresholds.readOnlyApi.p99Milliseconds}`
    ]
  }
};

function record(response, expectedStatus, name, metric) {
  metric?.add(response.timings.duration);
  const expected = response.status === expectedStatus;
  const serverError = response.status >= 500;
  unexpectedServerErrors.add(serverError ? 1 : 0);
  technicalErrors.add(!expected || serverError);
  check(response, { [`${name} status ${expectedStatus}`]: () => expected });
  return expected;
}

function verify(response, name, predicate) {
  const valid = predicate(response);
  technicalErrors.add(!valid);
  check(response, { [name]: () => valid });
  return valid;
}

function shellJourney() {
  const shell = http.get(`${target}/`, { tags: { journey: "public-shell" } });
  if (record(shell, 200, "GET /", readLatency)) {
    verify(shell, "shell is HTML", response => response.headers["Content-Type"]?.includes("text/html"));
    const assetPaths = [];
    const assetPattern = /(?:src|href)="(\/assets\/[^"?]+)(?:\?[^"?]*)?"/g;
    let match;
    while ((match = assetPattern.exec(shell.body)) !== null) assetPaths.push(match[1]);
    verify(shell, "shell references generated assets", () => assetPaths.length > 0);
    http.batch([...new Set(assetPaths)].map(path => ({
      method: "GET", url: `${target}${path}`, params: { tags: { journey: "public-asset" } }
    }))).forEach(response => record(response, 200, "GET asset"));
  }
  record(http.get(`${target}/manifest.webmanifest`, { tags: { journey: "pwa-manifest" } }), 200,
    "GET /manifest.webmanifest");
}

function publicApiJourney() {
  const source = http.get(`${target}/api/source`, { tags: { journey: "source" } });
  if (record(source, 200, "GET /api/source", readLatency)) {
    verify(source, "source identifies UAT", response => response.json("environment") === "UAT");
  }
  record(http.get(`${target}/api/public/config`, { tags: { journey: "public-api" } }), 200,
    "GET /api/public/config", readLatency);
  record(http.get(`${target}/api/public/booking-grid`, { tags: { journey: "public-api" } }), 200,
    "GET /api/public/booking-grid", readLatency);
  const session = http.get(`${target}/api/session`, { tags: { journey: "session" } });
  if (record(session, 200, "GET /api/session", readLatency)) {
    verify(session, "session creates CSRF cookie", response => Boolean(response.cookies["XSRF-TOKEN"]?.length));
  }
}

function privateSurfaceJourney() {
  record(http.get(`${target}/api-ui/`, { tags: { journey: "private-surface" } }), 404, "GET /api-ui/");
  record(http.get(`${target}/api/openapi.yaml`, { tags: { journey: "private-surface" } }), 404,
    "GET /api/openapi.yaml");
  record(http.get(`${target}/actuator/health`, { tags: { journey: "private-surface" } }), 404,
    "GET /actuator/health");
}

export default function () {
  group("public shell", shellJourney);
  group("public API", publicApiJourney);
  group("private surface", privateSurfaceJourney);
  sleep(1);
}

function retainedSummary(data) {
  const names = [
    "checks", "http_req_duration", "http_reqs", "iterations", "technical_errors",
    "unexpected_server_errors", "read_only_api_duration"
  ];
  return {
    state: data.state,
    metrics: Object.fromEntries(names.filter(name => data.metrics[name]).map(name => [name, data.metrics[name]]))
  };
}

export function handleSummary(data) {
  const summary = retainedSummary(data);
  const requests = summary.metrics.http_reqs?.values.count ?? 0;
  const failures = summary.metrics.technical_errors?.values.rate ?? 0;
  const report = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Funnel smoke</title>`
    + `<h1>Funnel smoke</h1><dl><dt>Requests</dt><dd>${requests}</dd>`
    + `<dt>Technical error rate</dt><dd>${failures}</dd></dl></html>`;
  return {
    "/results/raw-summary.json": JSON.stringify(summary, null, 2),
    "/results/report.html": report
  };
}
