import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { request } from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import { createSecurityMailCertificate } from "./security-mail-capture.mjs";
import { containerIdentity } from "./mail-relay-certificate.mjs";

const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");
const configuration = resolve("deploy/Caddyfile.security-password-breach");
function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function valuesOf(node, key) {
  if (Array.isArray(node)) return node.flatMap((item) => valuesOf(item, key));
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([name, value]) => name === key ? [value] : valuesOf(value, key));
}
function probe(port, ca, path, method = "GET", servername = "password-breach", headers = {}) {
  return new Promise((resolve_, reject) => {
    const req = request({ hostname: "127.0.0.1", port, servername, ca, path, method,
      headers: { Host: "password-breach", ...headers }, timeout: 6000 }, response => {
      response.resume();
      response.once("end", () => resolve_({ status: response.statusCode, headers: response.headers }));
    });
    req.once("error", reject);
    req.once("timeout", () => req.destroy(new Error("Bridge request exceeded its deadline")));
    req.end();
  });
}

test("given the pinned dependency bridge, when real HTTPS requests cross its matcher, then only uppercase GET prefixes with no query reach the fixed verified upstream", { timeout: 45000 }, async () => {
  // given
  assert.ok(existsSync(configuration), "the fixed provider boundary must have its own configuration");
  const compose = yaml.load(readFileSync(new URL("../deploy/compose.security.yaml", import.meta.url), "utf8"));
  const image = compose.services["password-breach"].image;
  const root = mkdtempSync(join(tmpdir(), "courtside-password-breach-"));
  const name = `courtside-password-breach-test-${randomUUID()}`;
  const network = `${name}-network`;
  let createdNetwork = false;
  let createdContainer = false;
  try {
    const trust = join(root, "trust");
    const { pem: ca } = createSecurityMailCertificate(trust);
    docker(["network", "create", "--label", "org.courtside.test=password-breach", network]);
    createdNetwork = true;
    docker(["image", "inspect", image]);
    docker(["run", "--pull", "never", "-d", "--name", name, "--network", network,
      "--add-host", "api.pwnedpasswords.com:127.0.0.1",
      "--label", "org.courtside.test=password-breach", "--read-only", "--user", containerIdentity(),
      "--cap-drop", "ALL", "--cap-add", "NET_BIND_SERVICE", "--security-opt", "no-new-privileges:true",
      "--memory", "128m", "--cpus", "0.25", "--pids-limit", "32",
      "--tmpfs", "/config:size=1m,mode=1777", "--tmpfs", "/data:size=1m,mode=1777", "--tmpfs", "/tmp:size=1m,mode=1777",
      "-v", `${configuration}:/etc/caddy/Caddyfile:ro`, "-v", `${trust}:/trust:ro`,
      "-p", "127.0.0.1::443", image]);
    createdContainer = true;
    const running = JSON.parse(docker(["inspect", name]))[0];
    assert.equal(running.State.Running, true, docker(["logs", name]));
    const bindings = running.NetworkSettings.Ports["443/tcp"] ?? [];
    assert.ok(bindings.length > 0, "the test bridge must publish its loopback listener");
    const port = Number(bindings[0].HostPort);
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
      try { ready = (await probe(port, ca, "/not-a-range")).status === 404; }
      catch { await delay(100); }
    }
    assert.ok(ready, "the pinned bridge must serve its real TLS listener");
    // when / then
    for (const [path, method] of [["/range/abcde", "GET"], ["/range/ABCDEF", "GET"],
      ["/range/ABCD", "GET"], ["/range/ABCDE/", "GET"], ["/range/ABCDE?x=1", "GET"],
      ["/range/ABCDE?https://example.org", "GET"], ["/range/ABCDE", "POST"],
      ["/range/ABCDE", "HEAD"], ["/range/ABCDE", "OPTIONS"], ["/", "GET"]]) {
      assert.equal((await probe(port, ca, path, method)).status, 404, `${method} ${path} must never reach the provider`);
    }
    assert.equal((await probe(port, ca, "/range/ABCDE", "GET", "password-breach", { Host: "foreign.example.org" })).status, 404);
    await assert.rejects(probe(port, ca, "/range/ABCDE", "GET", "foreign.example.org"),
      { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    assert.equal((await probe(port, ca, "/range/ABCDE")).status, 502,
      "a valid prefix reaches the upstream transport, which fails closed against the private local server");
    const adapted = JSON.parse(docker(["exec", name, "caddy", "adapt", "--config", "/etc/caddy/Caddyfile"]));
    const routes = adapted.apps.http.servers.srv0.routes;
    const encoded = JSON.stringify(routes);
    assert.deepEqual(valuesOf(routes, "dial"), ["api.pwnedpasswords.com:443"], "the provider is the only upstream");
    assert.deepEqual(valuesOf(routes, "server_name"), ["api.pwnedpasswords.com"]);
    assert.doesNotMatch(encoded, /insecure_skip_verify|tls_insecure_skip_verify/);
    assert.match(encoded, /"dial_timeout":3000000000/);
    assert.match(encoded, /"response_header_timeout":3000000000/);
    assert.match(encoded, /"read_timeout":3000000000/);
    assert.match(encoded, /"delete":\["Authorization","Cookie","Forwarded","X-Forwarded-\*"\]/);
  } finally {
    if (createdContainer) docker(["rm", "-f", name]);
    if (createdNetwork) docker(["network", "rm", network]);
    rmSync(root, { recursive: true, force: true });
  }
});
