import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const contractPath = new URL("../performance/contract.json", import.meta.url);
const resultSchemaPath = new URL("../performance/result.schema.json", import.meta.url);
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;

function readJson(url) {
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

test("given the reference workload, when reading the performance contract, then club shape and traffic stay configurable", () => {
  // given
  const contract = readJson(contractPath);

  // when
  const dataset = contract.datasets.reference;
  const workload = contract.workloads.reference;

  // then
  assert.deepEqual(dataset, { members: 1000, courts: 8 });
  assert.equal(workload.dataset, "reference");
  assert.equal(workload.readShare, 0.9);
  assert.equal(workload.writeShare, 0.1);
  assert.equal(workload.normalVirtualUsers, 50);
  assert.equal(workload.peakVirtualUsers, 100);
});

test("given pinned performance tooling, when reading image references, then mutable tags are bound to approved digests", () => {
  // given
  const contract = readJson(contractPath);

  // when / then
  assert.deepEqual(contract.tooling.protocolImage, {
    reference: "grafana/k6:2.2.0",
    digest: "sha256:9bd01d6941fca969cb61bb57d2da5ee9b385fe2aa8881df3798c196564d6ace6"
  });
  assert.deepEqual(contract.tooling.browserImage, {
    reference: "grafana/k6:2.2.0-with-browser",
    digest: "sha256:defdc0a3e70c46bce010bfc10dedc03e335cc7febe01f6359552fe72827c2aa2"
  });
});

test("given supported performance profiles, when reading their execution limits, then every run is bounded", () => {
  // given
  const contract = readJson(contractPath);
  const expectedProfiles = ["smoke", "baseline", "peak", "stress", "soak", "browser", "funnel-smoke"];

  // when / then
  assert.deepEqual(Object.keys(contract.profiles), expectedProfiles);
  for (const profile of Object.values(contract.profiles)) {
    assert.equal(Number.isInteger(profile.limits.maximumVirtualUsers), true);
    assert.match(profile.limits.maximumDuration, /^\d+[smh]$/);
    assert.equal(typeof profile.manual, "boolean");
  }
  assert.deepEqual(contract.profiles["funnel-smoke"].limits, {
    maximumVirtualUsers: 2,
    maximumDuration: "2m"
  });
  assert.equal(contract.profiles["funnel-smoke"].readOnly, true);
  assert.equal(contract.profiles["funnel-smoke"].manual, true);
});

test("given performance thresholds, when classifying outcomes, then domain conflicts stay separate from failures", () => {
  // given
  const contract = readJson(contractPath);

  // when / then
  assert.equal(contract.thresholds.technicalErrorRate, "rate<0.01");
  assert.equal(contract.thresholds.unexpectedServerErrors, "count==0");
  assert.deepEqual(contract.thresholds.readOnlyApi, { p95Milliseconds: 500, p99Milliseconds: 1000 });
  assert.deepEqual(contract.thresholds.booking, { p95Milliseconds: 1000, p99Milliseconds: 2000 });
  assert.deepEqual(contract.thresholds.webVitals, {
    percentile: 75,
    lcpMilliseconds: 2500,
    inpMilliseconds: 200,
    cls: 0.1
  });
  assert.deepEqual(contract.expectedDomainOutcomes.bookingConflict, {
    status: 409,
    metric: "booking_conflicts"
  });
});

test("given resource and target safety boundaries, when reading the contract, then load cannot default to a remote environment", () => {
  // given
  const contract = readJson(contractPath);

  // when / then
  assert.deepEqual(contract.resources.application, { cpu: 2, memoryMegabytes: 1024 });
  assert.deepEqual(contract.resources.database, { cpu: 2, memoryMegabytes: 2048 });
  assert.deepEqual(contract.resources.proxy, { cpu: 0.5, memoryMegabytes: 256 });
  assert.equal(contract.targets.default, "system");
  assert.equal(contract.targets.system.environment, "PERFORMANCE");
  assert.equal(contract.targets.system.remote, false);
  assert.equal(contract.targets.funnel.profiles[0], "funnel-smoke");
  assert.equal(contract.targets.funnel.requiresExplicitConfirmation, true);
  assert.equal(contract.safety.disposableConfirmation, "courtside-perf");
  assert.equal(contract.safety.allowOrdinaryLimitOverrides, false);
});

test("given a performance result, when validating its documented shape, then comparison metadata is mandatory", () => {
  // given
  const schema = readJson(resultSchemaPath);

  // when / then
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "schemaVersion", "contract", "build", "runtime", "profile", "load", "resources", "thresholds", "metrics"
  ]);
  assert.deepEqual(schema.properties.contract.required, ["schemaVersion", "digest"]);
  assert.deepEqual(schema.properties.build.required, ["applicationVersion", "gitCommit"]);
  assert.deepEqual(schema.properties.runtime.required, ["k6Version", "operatingSystem", "architecture"]);
  assert.deepEqual(schema.properties.metrics.required, [
    "iterations", "requests", "throughputPerSecond", "technicalErrorRate", "unexpectedServerErrors", "latencyMilliseconds"
  ]);
  assert.deepEqual(schema.allOf[2].then.properties.metrics.required, ["bookingConflicts", "bookingConflictRate"]);
  assert.deepEqual(schema.properties.metrics.properties.latencyMilliseconds.required, ["p50", "p90", "p95", "p99"]);
});

test("given incomplete or unsafe result claims, when validating them, then the schema rejects them", () => {
  // given
  const schema = readJson(resultSchemaPath);
  const validate = new Ajv({ strict: true, strictRequired: false, formats: { "date-time": true } }).compile(schema);
  const valid = {
    schemaVersion: 1,
    contract: {
      schemaVersion: 1,
      digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    build: { applicationVersion: "1.0.0", gitCommit: "abcdef0" },
    runtime: { k6Version: "2.2.0", operatingSystem: "linux", architecture: "arm64" },
    profile: {
      name: "baseline",
      workload: "reference",
      target: "system",
      environment: "PERFORMANCE",
      startedAt: "2026-01-01T00:00:00Z",
      durationSeconds: 600
    },
    load: {
      dataset: { members: 1000, courts: 8 },
      readShare: 0.9,
      writeShare: 0.1,
      virtualUsers: 50
    },
    resources: {
      application: { cpu: 2, memoryMegabytes: 1024 },
      database: { cpu: 2, memoryMegabytes: 2048 },
      proxy: { cpu: 0.5, memoryMegabytes: 256 }
    },
    thresholds: {
      technicalErrorRate: true,
      unexpectedServerErrors: true,
      readOnlyApi: true,
      login: true,
      booking: true
    },
    metrics: {
      iterations: 1,
      requests: 1,
      throughputPerSecond: 1,
      technicalErrorRate: 0,
      unexpectedServerErrors: 0,
      bookingConflicts: 0,
      bookingConflictRate: 0,
      latencyMilliseconds: { p50: 1, p90: 1, p95: 1, p99: 1 }
    }
  };

  // when / then
  assert.equal(validate(valid), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...valid, thresholds: {} }), false);
  assert.equal(validate({ ...valid, contract: { schemaVersion: 1 } }), false);
  assert.equal(validate({ ...valid, load: { ...valid.load, virtualUsers: undefined } }), false);
  assert.equal(validate({ ...valid, profile: { ...valid.profile, target: "funnel" } }), false);
  assert.equal(validate({ ...valid, profile: { ...valid.profile, environment: "UAT" } }), false);
  assert.equal(validate({
    ...valid,
    profile: { ...valid.profile, name: "funnel-smoke", target: "system", environment: "PERFORMANCE" }
  }), false);
  assert.equal(validate({
    ...valid,
    profile: { ...valid.profile, name: "browser" },
    thresholds: { technicalErrorRate: true, unexpectedServerErrors: true }
  }), false);

  const funnel = {
    ...valid,
    profile: {
      ...valid.profile,
      name: "funnel-smoke",
      target: "funnel",
      environment: "UAT",
      durationSeconds: 120
    },
    load: { ...valid.load, readShare: 1, writeShare: 0, virtualUsers: 2 },
    thresholds: { technicalErrorRate: true, unexpectedServerErrors: true, readOnlyApi: true }
  };
  assert.equal(validate(funnel), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...funnel, load: { ...funnel.load, virtualUsers: 3 } }), false);
  assert.equal(validate({ ...funnel, profile: { ...funnel.profile, durationSeconds: 121 } }), false);
  assert.equal(validate({ ...funnel, load: { ...funnel.load, readShare: 0.9 } }), false);
  assert.equal(validate({ ...funnel, load: { ...funnel.load, writeShare: 0.1 } }), false);
  assert.equal(validate({
    ...funnel,
    load: {
      dataset: funnel.load.dataset,
      readShare: 1,
      writeShare: 0,
      stages: [{ targetVirtualUsers: 2, durationSeconds: 120 }]
    }
  }), false);
});
