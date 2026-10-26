import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareTrivyDatabases } from "./security-trivy-database.mjs";

function nativeTrivy(results) {
  const calls = [];
  return { calls, execute: (command, args, options) => {
    calls.push({ command, args, options });
    return { status: results.shift() ?? 0 };
  } };
}

function sources(calls) {
  return calls.map(({ args }) => args.at(-1));
}

test("given a primary database layer returns 404, when preparing Trivy, then the independent source supplies the database", () => {
  // given
  const native = nativeTrivy([1, 0, 0]);

  // when
  prepareTrivyDatabases({ cacheDir: "/tmp/example-cache", execute: native.execute });

  // then
  assert.deepEqual(sources(native.calls), ["ghcr.io/aquasecurity/trivy-db:2",
    "mirror.gcr.io/aquasec/trivy-db:2", "ghcr.io/aquasecurity/trivy-java-db:1"]);
  assert.ok(native.calls.every(({ args }) => args.includes("--download-db-only") || args.includes("--download-java-db-only")),
    "fallback must only retry database preparation, never a scan with findings");
});

test("given the primary databases are available or cached, when preparing Trivy, then no alternate source is attempted", () => {
  // given
  const native = nativeTrivy([0, 0]);

  // when
  prepareTrivyDatabases({ cacheDir: "/tmp/example-cache", execute: native.execute });

  // then
  assert.deepEqual(sources(native.calls), ["ghcr.io/aquasecurity/trivy-db:2", "ghcr.io/aquasecurity/trivy-java-db:1"]);
  assert.ok(native.calls.every(({ command, args, options }) => command === "trivy"
    && args.includes("/tmp/example-cache") && options.timeout === 300_000));
  assert.ok(native.calls[0].args.includes("--skip-db-update=false"), "a previous skip setting must not bypass freshness checks");
  assert.ok(native.calls[1].args.includes("--skip-java-db-update=false"));
});

test("given both vulnerability database sources fail, when preparing Trivy, then no Java preparation or scan follows", () => {
  // given
  const native = nativeTrivy([1, 1]);

  // when / then
  assert.throws(() => prepareTrivyDatabases({ cacheDir: "/tmp/example-cache", execute: native.execute }),
    /vulnerability database is unavailable from every source/);
  assert.equal(native.calls.length, 2, "each source is attempted once without accepting an old cached database");
});

test("given the Java database primary fails, when preparing Trivy, then only the Java download uses its alternate source", () => {
  // given
  const native = nativeTrivy([0, 1, 0]);

  // when
  prepareTrivyDatabases({ cacheDir: "/tmp/example-cache", execute: native.execute });

  // then
  assert.deepEqual(sources(native.calls), ["ghcr.io/aquasecurity/trivy-db:2",
    "ghcr.io/aquasecurity/trivy-java-db:1", "mirror.gcr.io/aquasec/trivy-java-db:1"]);
  assert.ok(native.calls.slice(1).every(({ args }) => args.includes("--download-java-db-only")));
});

test("given both Java database sources fail, when preparing Trivy, then the preparation fails", () => {
  // given
  const native = nativeTrivy([0, 1, 1]);

  // when / then
  assert.throws(() => prepareTrivyDatabases({ cacheDir: "/tmp/example-cache", execute: native.execute }),
    /Java database is unavailable from every source/);
  assert.equal(native.calls.length, 3);
});

test("given a native download times out, when the other source also fails, then preparation remains bounded and fails", () => {
  // given
  let calls = 0;
  const execute = () => { calls++; return { status: null, error: new Error("ETIMEDOUT") }; };

  // when / then
  assert.throws(() => prepareTrivyDatabases({ cacheDir: "/tmp/example-cache", execute }), /unavailable from every source/);
  assert.equal(calls, 2);
});
