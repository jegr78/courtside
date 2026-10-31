import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { archiveArguments, gateJourney, verifyTransitionBinding, registryAddress, servedReference, withRegistryHost, withoutRegistryHost }
  from "./installed-upgrade-gate.mjs";

const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");
const digest = "a".repeat(64);

test("given a Stalwart artifact gate, when its journey is selected, then it uses the bound candidate and full mail recipe", () => {
  // when
  const journey = gateJourney("stalwart-store-transition", "/tmp/candidate");
  // then
  assert.equal(journey.recipe, "full-self-hosted");
  assert.deepEqual(journey.arguments, ["tools/stalwart-store-transition-smoke.mjs", "--candidate", "/tmp/candidate"]);
  assert.equal(gateJourney(undefined, "/tmp/candidate").recipe, "funnel");
  assert.throws(() => gateJourney("../../bin/sh", "/tmp/candidate"), /unknown.*journey/);
});

test("given another runtime image, when the transition evidence is bound, then the candidate cannot inherit its result", () => {
  // given
  const expected = { image: `ghcr.io/jegr78/courtside@sha256:${digest}`, revision: "f".repeat(40) };
  const report = { status: "passed", runtimeImage: expected.image, candidateRevision: expected.revision };
  // when / then
  assert.doesNotThrow(() => verifyTransitionBinding(report, expected));
  assert.throws(() => verifyTransitionBinding({ ...report, runtimeImage: `ghcr.io/jegr78/courtside@sha256:${"b".repeat(64)}` }, expected), /runtime image/);
  assert.throws(() => verifyTransitionBinding({ ...report, candidateRevision: "e".repeat(40) }, expected), /revision/);
  assert.throws(() => verifyTransitionBinding({ ...report, status: "failed" }, expected), /did not pass/);
});

test("given a hosts file, when the stand-in registry is announced, then ghcr.io resolves to loopback exactly once", () => {
  // given
  const hosts = "127.0.0.1 localhost\n::1 localhost";

  // when
  const announced = withRegistryHost(withRegistryHost(hosts));

  // then
  const entries = announced.split("\n").filter((line) => /\sghcr\.io(\s|$)/.test(line));
  assert.equal(entries.length, 1, "a second announcement must not add a second entry");
  assert.match(entries[0], /^127\.0\.0\.1 ghcr\.io /);
  assert.ok(announced.startsWith(`${hosts}\n`), "the existing entries stay untouched");
});

test("given an announced stand-in, when it is withdrawn, then only its own entry leaves the hosts file", () => {
  // given
  const hosts = "127.0.0.1 localhost\n";
  const edited = `${withRegistryHost(hosts)}10.0.0.2 example.org\n`;

  // when
  const withdrawn = withoutRegistryHost(edited);

  // then
  assert.equal(withdrawn, `${hosts}10.0.0.2 example.org\n`, "an entry written meanwhile is not the stand-in's to remove");
});

test("given a hosts file that already routes ghcr.io, when the stand-in is announced, then it refuses to shadow it", () => {
  // when / then
  assert.throws(() => withRegistryHost("10.0.0.1 ghcr.io\n"), /already resolves ghcr\.io/);
});

test("given the registry's answer for the pushed tag, when the served reference is read, then the official name carries its digest", () => {
  // given
  const recorded = ["content-type: application/vnd.oci.image.manifest.v1+json",
    "docker-content-digest: sha256:c26612752c78b18faacd63c7d50f4592c2e7b0f25e0e20e82bd74e465c57ab0d",
    "docker-distribution-api-version: registry/2.0",
    'etag: "sha256:c26612752c78b18faacd63c7d50f4592c2e7b0f25e0e20e82bd74e465c57ab0d"'];
  const answer = Object.fromEntries(recorded.map((line) => line.split(/: (.*)/s).slice(0, 2)));

  // when
  const reference = servedReference("ghcr.io/example/courtside", answer);

  // then
  assert.equal(reference,
    "ghcr.io/example/courtside@sha256:c26612752c78b18faacd63c7d50f4592c2e7b0f25e0e20e82bd74e465c57ab0d",
    "registry:3.1 answered this HEAD for a pushed image whose local index digest was be2656061b53");
});

test("given a registry answer without a digest, when it is read, then the gate names what is missing", () => {
  // when / then
  assert.throws(() => servedReference("ghcr.io/example/courtside", { "content-type": "application/json" }),
    /no digest for ghcr\.io\/example\/courtside/);
});

test("given served references, when the candidate archive is described, then it binds both and the run's identity", () => {
  // given
  const candidate = { image: `ghcr.io/example/courtside@sha256:${digest}`,
    bookingSeedImage: `ghcr.io/example/courtside@sha256:${"c".repeat(64)}`, version: "0.4.0-nightly.7",
    revision: "f".repeat(40), repository: "example/courtside", workflow: "nightly-image.yml",
    ref: "refs/heads/feature", output: "build/archive" };

  // when
  const parameters = archiveArguments(candidate);

  // then
  const value = (flag) => parameters[parameters.indexOf(flag) + 1];
  assert.equal(parameters[0], "tools/deployment-archive.mjs");
  assert.equal(value("--image"), candidate.image, "the launcher pulls exactly the served digest");
  assert.equal(value("--booking-seed-image"), candidate.bookingSeedImage);
  assert.equal(value("--version"), candidate.version);
  assert.equal(value("--revision"), candidate.revision);
  assert.equal(value("--ref"), candidate.ref);
  assert.equal(value("--workflow"), candidate.workflow);
  assert.equal(value("--output"), candidate.output);
});

test("given the stand-in registry's Compose file, when it is read, then it answers on loopback 443 only", () => {
  // given
  const compose = yaml.load(readFileSync(new URL("../deploy/compose.installed-upgrade-registry.yaml", import.meta.url),
    "utf8"));

  // when
  const ports = compose.services.registry.ports;

  // then
  assert.equal(registryAddress, "127.0.0.1");
  assert.deepEqual(ports, [`${registryAddress}:443:5000`], "the official name has no port, and nothing else may reach it");
  assert.match(compose.services.registry.image, /^registry:[^@]+@sha256:[0-9a-f]{64}$/);
});
