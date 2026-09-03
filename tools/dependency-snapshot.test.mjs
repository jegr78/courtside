import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot, packageUrl, parseDependencyList, submitSnapshot } from "./dependency-snapshot.mjs";

const resolvedList = `The following files have been resolved:
   org.springframework.boot:spring-boot-starter-webmvc:jar:4.1.1:compile -- module spring.boot.starter.webmvc [auto]
   org.apache.tomcat.embed:tomcat-embed-core:jar:11.0.25:compile -- module org.apache.tomcat.embed.core
   org.junit.jupiter:junit-jupiter:jar:6.1.0:test
   org.example:native:jar:linux-x86_64:2.0.0:runtime
`;
const directList = `The following files have been resolved:
   org.springframework.boot:spring-boot-starter-webmvc:jar:4.1.1:compile -- module spring.boot.starter.webmvc [auto]
`;

function snapshotOf(overrides = {}) {
  return buildSnapshot({
    resolved: parseDependencyList(resolvedList),
    direct: parseDependencyList(directList),
    sha: "a".repeat(40),
    ref: "refs/heads/main",
    runId: 42,
    correlator: "dependency graph/submit",
    repository: "example/courtside",
    scanned: "2026-09-03T10:00:00.000Z",
    ...overrides
  });
}

test("given a dependency list, when it is parsed, then the module suffix and the header are not coordinates", () => {
  // when
  const parsed = parseDependencyList(resolvedList);

  // then
  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed[1], { group: "org.apache.tomcat.embed", artifact: "tomcat-embed-core",
    version: "11.0.25", scope: "compile" });
});

test("given a coordinate carrying a classifier, when it is parsed, then version and scope are read from the end", () => {
  // when
  const parsed = parseDependencyList(resolvedList);

  // then
  assert.deepEqual(parsed[3], { group: "org.example", artifact: "native", version: "2.0.0", scope: "runtime" });
});

test("given a line Maven would never print, when it is parsed, then the snapshot is refused rather than guessed", () => {
  // when / then
  assert.throws(() => parseDependencyList("   org.example:broken:jar:1.0.0\n"), /is not a coordinate/);
  assert.throws(() => parseDependencyList("   a:b:jar:1:c:d:e:f\n"), /is not a coordinate/);
  assert.throws(() => parseDependencyList("   org.example:a:jar:1.0.0:imaginary\n"), /has an unknown scope/);
  assert.throws(() => parseDependencyList("   org.example:a:jar:1.0.0:\n"), /is not a coordinate/);
  assert.deepEqual(parseDependencyList("The following files have been resolved:\n"), []);
});

test("given anything but a created snapshot, when GitHub answers, then the submission is a failure", async () => {
  // given
  const snapshot = { version: 0 };
  const answering = (status) => async () => ({ status });

  // when / then
  await assert.rejects(() => submitSnapshot(snapshot, "example/courtside", "token", answering(202)),
    /GitHub API returned 202/);
  await assert.rejects(() => submitSnapshot(snapshot, "example/courtside", "token", answering(403)),
    /GitHub API returned 403/);
  assert.equal((await submitSnapshot(snapshot, "example/courtside", "token", answering(201))).status, 201);
});

test("given the dependency Maven resolved transitively, when the snapshot is built, then it is reported as indirect", () => {
  // when
  const resolved = snapshotOf().manifests["pom.xml"].resolved;

  // then
  assert.equal(resolved["org.apache.tomcat.embed:tomcat-embed-core"].relationship, "indirect");
  assert.equal(resolved["org.springframework.boot:spring-boot-starter-webmvc"].relationship, "direct");
});

test("given a test-scoped dependency, when the snapshot is built, then it is reported as development", () => {
  // when
  const resolved = snapshotOf().manifests["pom.xml"].resolved;

  // then
  assert.equal(resolved["org.junit.jupiter:junit-jupiter"].scope, "development");
  assert.equal(resolved["org.apache.tomcat.embed:tomcat-embed-core"].scope, "runtime");
});

test("given a coordinate, when its package URL is written, then it names the Maven package GitHub matches advisories against", () => {
  // when / then
  assert.equal(packageUrl({ group: "org.apache.tomcat.embed", artifact: "tomcat-embed-core", version: "11.0.25" }),
    "pkg:maven/org.apache.tomcat.embed/tomcat-embed-core@11.0.25");
});

test("given a commit, a ref, a run or a correlator the API would reject, when the snapshot is built, then it is refused here", () => {
  // when / then
  assert.throws(() => snapshotOf({ sha: "abc" }), /sha is invalid/);
  assert.throws(() => snapshotOf({ ref: "main" }), /ref is invalid/);
  assert.throws(() => snapshotOf({ runId: 0 }), /run is invalid/);
  assert.throws(() => snapshotOf({ correlator: "" }), /correlator is invalid/);
  assert.throws(() => snapshotOf({ resolved: [] }), /resolves no dependency/);
});

test("given a submitted snapshot, when GitHub reads it, then every field the API requires is present", () => {
  // when
  const snapshot = snapshotOf();

  // then
  assert.deepEqual(Object.keys(snapshot).sort(),
    ["detector", "job", "manifests", "ref", "scanned", "sha", "version"]);
  assert.deepEqual(Object.keys(snapshot.job).sort(), ["correlator", "id"]);
  assert.deepEqual(Object.keys(snapshot.detector).sort(), ["name", "url", "version"]);
  assert.equal(snapshot.version, 0);
  assert.equal(snapshot.manifests["pom.xml"].file.source_location, "pom.xml");
});
