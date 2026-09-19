import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const YAML = require("yaml");

function document(path) {
  return YAML.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
}

const base = document("deploy/compose.yaml");
const caddy = document("deploy/compose.caddy.yaml");
const uat = document("deploy/compose.uat.yaml");
const customImage = document("deploy/compose.custom-image.yaml");
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

function assertSyslog(service, tag, port) {
  assert.equal(service.logging.driver, "syslog");
  assert.equal(service.logging.options["syslog-address"], `udp://127.0.0.1:${port}`);
  assert.equal(service.logging.options["syslog-format"], "rfc5424micro");
  assert.equal(service.logging.options.tag, tag);
}

function assertCollector(stack, port) {
  const collector = stack.services["log-collector"];
  assert.equal(collector.image, stack.services.app.image);
  assert.deepEqual(collector.command, ["--collect-operational-logs"]);
  assert.deepEqual(collector.ports, [`127.0.0.1:${port}:${port}/udp`]);
  assert.ok(collector.read_only);
  assert.deepEqual(collector.cap_drop, ["ALL"]);
  assert.deepEqual(collector.security_opt, ["no-new-privileges:true"]);
  assert.ok(collector.volumes.includes("operational-logs:/var/lib/courtside/operational-logs"));
  assert.match(collector.healthcheck.test.join(" "), /collector-status\.json/);
  assert.match(collector.healthcheck.test.join(" "), /-mmin -1/);
  assert.equal(collector.healthcheck.interval, "10s");
  assert.equal(collector.healthcheck.timeout, "3s");
  assert.equal(collector.healthcheck.retries, 3);
  assert.notEqual(collector.logging.driver, "syslog", "the collector must not feed its own output back to itself");
}

test("given the reference deployment, operational logs are collected without Docker control access", () => {
  assertSyslog(base.services.app, "courtside-application", "${COURTSIDE_OPERATIONAL_LOG_PORT:-1514}");
  assertSyslog(base.services.db, "courtside-database", "${COURTSIDE_OPERATIONAL_LOG_PORT:-1514}");
  assertSyslog(caddy.services.proxy, "courtside-proxy", "${COURTSIDE_OPERATIONAL_LOG_PORT:-1514}");
  assertCollector(base, "${COURTSIDE_OPERATIONAL_LOG_PORT:-1514}");
  assert.equal(base.services.db.depends_on["log-collector"].condition, "service_healthy");
  assert.equal(caddy.services.proxy.depends_on["log-collector"].condition, "service_healthy");
  assert.ok(base.services.app.volumes.includes("operational-logs:/var/lib/courtside/operational-logs:ro"));
  assert.ok(Object.hasOwn(base.volumes, "operational-logs"));
  assert.doesNotMatch(JSON.stringify([base, caddy]), /docker\.sock/);
  assert.match(dockerfile, /\/var\/lib\/courtside\/operational-logs/);
  assert.equal(customImage.services["log-collector"].image, customImage.services.app.image);
});

test("given the UAT deployment, the same bounded collector path is exercised", () => {
  assertSyslog(uat.services.app, "courtside-application", "${COURTSIDE_OPERATIONAL_LOG_PORT:-1515}");
  assertSyslog(uat.services.db, "courtside-database", "${COURTSIDE_OPERATIONAL_LOG_PORT:-1515}");
  assertSyslog(uat.services.proxy, "courtside-proxy", "${COURTSIDE_OPERATIONAL_LOG_PORT:-1515}");
  assertCollector(uat, "${COURTSIDE_OPERATIONAL_LOG_PORT:-1515}");
  assert.equal(uat.services.db.depends_on["log-collector"].condition, "service_healthy");
  assert.equal(uat.services.proxy.depends_on["log-collector"].condition, "service_healthy");
  assert.ok(uat.services.app.volumes.includes("operational-logs:/var/lib/courtside/operational-logs:ro"));
});
