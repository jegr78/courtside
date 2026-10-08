import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { createServer, request } from "node:http";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const gateway = fileURLToPath(new URL("security-request-gateway.py", import.meta.url));

async function startGateway(metricsDirectory, upstreamPort) {
  const arguments_ = metricsDirectory ? ["-c", [
    "import importlib.util, http.server, sys",
    "spec = importlib.util.spec_from_file_location('gateway', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "module.METRICS_PATH = sys.argv[2]",
    "if len(sys.argv) > 3: module.UPSTREAM_HOST, module.UPSTREAM_PORT = '127.0.0.1', int(sys.argv[3])",
    "server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), module.RequestHandler)",
    "print('listening', server.server_address[1], flush=True)",
    "server.serve_forever()"
  ].join("\n"), gateway, join(metricsDirectory, "metrics"),
  ...(upstreamPort === undefined ? [] : [String(upstreamPort)])] : [gateway];
  const gatewayProcess = spawn("python3", arguments_, {
    env: {
      ...process.env,
      COURTSIDE_SECURITY_GATEWAY_PORT: "0",
      COURTSIDE_SECURITY_MAX_REQUESTS: "50",
      COURTSIDE_SECURITY_MAX_CONCURRENCY: "2",
      COURTSIDE_SECURITY_MAX_GENERATED_BYTES: metricsDirectory ? "50000000" : "1000000",
      COURTSIDE_SECURITY_ALLOWED_METHODS: "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
      COURTSIDE_SECURITY_ALLOWED_PATH_PREFIXES: "/api"
    },
    stdio: ["ignore", "pipe", "inherit"]
  });
  const lines = createInterface({ input: gatewayProcess.stdout });
  const [announcement] = await once(lines, "line");
  lines.close();
  return { gatewayProcess, port: Number(announcement.split(" ")[1]) };
}

async function send(port, method) {
  const attempt = request({ host: "127.0.0.1", port, method, path: "/api/public/config" });
  attempt.end();
  const [response] = await once(attempt, "response");
  response.resume();
  return response.statusCode;
}

test("given a method the gateway does not relay, when it arrives, then it is refused rather than answered as a server error",
  async () => {
    // given
    const { gatewayProcess, port } = await startGateway();

    // when / then
    try {
      assert.equal(await send(port, "TRACE"), 421);
      assert.equal(await send(port, "PROPFIND"), 421);
      assert.equal(await send(port, "QUERY"), 421);
    } finally {
      gatewayProcess.kill();
      await once(gatewayProcess, "exit");
    }
  });

test("given a method the gateway relays, when it arrives, then it reaches for its upstream", async () => {
  // given
  const { gatewayProcess, port } = await startGateway();

  // when / then - no upstream is running, so the relay attempt is what 502 reports
  try {
    assert.equal(await send(port, "GET"), 502);
  } finally {
    gatewayProcess.kill();
    await once(gatewayProcess, "exit");
  }
});

test("given a private journal header on an ordinary request, when the native gateway forwards it, then no correlation metadata reaches the application", async () => {
  // given
  let received;
  const upstream = createServer((req, response) => {
    received = req.headers;
    response.writeHead(200, { "Content-Length": "0" });
    response.end();
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const directory = mkdtempSync(join(tmpdir(), "courtside-gateway-private-header-"));
  const { gatewayProcess, port } = await startGateway(directory, upstream.address().port);
  // when
  const attempt = request({ host: "127.0.0.1", port, method: "GET", path: "/api/public/config",
    headers: { "X-Courtside-Journal-Operation": "14:1" } });
  attempt.end();
  const [response] = await once(attempt, "response");
  response.resume();
  // then
  try {
    assert.equal(response.statusCode, 200);
    assert.equal(received["x-courtside-journal-operation"], undefined);
    assert.equal(JSON.parse(readFileSync(join(directory, "metrics"), "utf8")).bodyLimitReceipts.length, 0);
  } finally {
    gatewayProcess.kill();
    await once(gatewayProcess, "exit");
    await new Promise(resolve => upstream.close(resolve));
  }
});

test("given an oversized correlated request, when the native gateway rejects it, then its bounded receipt proves it never reached upstream", async () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-gateway-receipt-"));
  const { gatewayProcess, port } = await startGateway(directory);
  const attempt = request({ host: "127.0.0.1", port, method: "POST", path: "/api/session",
    headers: { "Content-Length": "2000001", "Content-Type": "application/x-www-form-urlencoded",
      "X-Courtside-Journal-Operation": "14:1" } });
  const startedAt = Math.floor(performance.timeOrigin + performance.now());
  // when
  attempt.end();
  const [response] = await once(attempt, "response");
  response.resume();
  // then
  try {
    assert.equal(response.statusCode, 413);
    const metrics = JSON.parse(readFileSync(join(directory, "metrics"), "utf8"));
    assert.equal(metrics.requests, 1);
    assert.equal(metrics.requestBytes, 2000001);
    assert.equal(metrics.upstreamErrors, 0);
    assert.equal(metrics.bodyLimitReceiptsComplete, true);
    const receipt = metrics.bodyLimitReceipts[0];
    assert.deepEqual({ ...receipt, observedAt: null }, { operationId: "14:1", method: "POST", path: "/api/session",
      status: 413, bodyBytes: 2000001, contentType: "application/x-www-form-urlencoded",
      maximumBodyBytes: 2000000, forwarded: false, observedAt: null });
    assert.ok(Date.parse(receipt.observedAt) >= startedAt
      && Date.parse(receipt.observedAt) <= Math.floor(performance.timeOrigin + performance.now()));
    assert.equal(metrics.bodyLimitReceipts.length, 1);
  } finally {
    gatewayProcess.kill();
    await once(gatewayProcess, "exit");
  }
});

test("given repeated oversized requests, when native receipt storage fills, then keep the cap and report incomplete capture", async () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-gateway-receipt-cap-"));
  const { gatewayProcess, port } = await startGateway(directory);
  // when / then
  try {
    for (let index = 1; index <= 17; index++) {
      const attempt = request({ host: "127.0.0.1", port, method: "POST", path: "/api/session",
        headers: { "Content-Length": "2000001", "Content-Type": "application/x-www-form-urlencoded",
          "X-Courtside-Journal-Operation": `14:${index}` } });
      attempt.end();
      const [response] = await once(attempt, "response");
      response.resume();
      assert.equal(response.statusCode, 413);
    }
    const metrics = JSON.parse(readFileSync(join(directory, "metrics"), "utf8"));
    assert.equal(metrics.requests, 17);
    assert.equal(metrics.bodyLimitReceipts.length, 16);
    assert.equal(metrics.bodyLimitReceiptsComplete, false);
    assert.equal(metrics.upstreamErrors, 0);
  } finally {
    gatewayProcess.kill();
    await once(gatewayProcess, "exit");
  }
});

for (const fixture of [
  { name: "an uncorrelated request", headers: {}, complete: true },
  { name: "a malformed correlation", headers: { "X-Courtside-Journal-Operation": "14:1,14:2" }, complete: false },
  { name: "duplicate correlations", headers: { "X-Courtside-Journal-Operation": ["14:1", "14:2"] }, complete: false },
  { name: "a mismatched content type", headers: { "Content-Type": "application/json",
    "X-Courtside-Journal-Operation": "14:1" }, complete: false },
  { name: "a query-bearing target", path: "/api/session?probe=1",
    headers: { "X-Courtside-Journal-Operation": "14:1" }, complete: false }
]) {
  test(`given ${fixture.name}, when the native gateway rejects an oversized body, then it creates no usable correlated receipt`, async () => {
    // given
    let upstreamRequests = 0;
    const upstream = createServer((req, response) => {
      upstreamRequests++;
      response.writeHead(200, { "Content-Length": "0" });
      response.end();
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const directory = mkdtempSync(join(tmpdir(), "courtside-gateway-invalid-receipt-"));
    const { gatewayProcess, port } = await startGateway(directory, upstream.address().port);
    try {
      // when
      const attempt = request({ host: "127.0.0.1", port, method: "POST", path: fixture.path ?? "/api/session",
        headers: { "Content-Length": "2000001", "Content-Type": "application/x-www-form-urlencoded", ...fixture.headers } });
      attempt.end();
      const [response] = await once(attempt, "response");
      response.resume();
      // then
      assert.equal(response.statusCode, 413);
      const metrics = JSON.parse(readFileSync(join(directory, "metrics"), "utf8"));
      assert.deepEqual(metrics.bodyLimitReceipts, []);
      assert.equal(metrics.bodyLimitReceiptsComplete, fixture.complete);
      assert.equal(metrics.requests, 1);
      assert.equal(upstreamRequests, 0);
    } finally {
      gatewayProcess.kill();
      await once(gatewayProcess, "exit");
      await new Promise(resolve => upstream.close(resolve));
    }
  });
}

test("given upstream refusals, when the gateway relays them, then only a typed admission refusal is counted", async () => {
  // given
  const answers = [
    [429, "application/problem+json", { type: "urn:courtside:error:request-rate-limited" }],
    [429, "application/problem+json", { type: "urn:courtside:error:operation-capacity-exhausted" }],
    [429, "application/problem+json", { type: "urn:courtside:error:login-rate-limited" }],
    [429, "text/plain", null],
    [200, "application/json", { type: "urn:courtside:error:request-rate-limited" }]
  ];
  let answered = 0;
  const upstream = createServer((req, response) => {
    const [status, contentType, body] = answers[answered++];
    const payload = body ? JSON.stringify(body) : "";
    response.writeHead(status, { "Content-Type": contentType, "Content-Length": String(Buffer.byteLength(payload)) });
    response.end(payload);
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const directory = mkdtempSync(join(tmpdir(), "courtside-gateway-admission-"));
  const { gatewayProcess, port } = await startGateway(directory, upstream.address().port);
  try {
    // when
    const statuses = [];
    for (let index = 0; index < answers.length; index++) statuses.push(await send(port, "GET"));

    // then
    assert.deepEqual(statuses, [429, 429, 429, 429, 200]);
    const metrics = JSON.parse(readFileSync(join(directory, "metrics"), "utf8"));
    assert.equal(metrics.admissionRefusals, 2,
      "a login limit, an untyped 429 and a success carrying the type are not admission refusals");
  } finally {
    gatewayProcess.kill();
    await once(gatewayProcess, "exit");
    await new Promise(resolve => upstream.close(resolve));
  }
});
