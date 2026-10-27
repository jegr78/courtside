import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertSecurityRecoveryOwnership } from "./security-environment.mjs";

const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");

test("given read-only SECURITY runtimes, when selecting application key storage, then only app and seeder share the private local volume", () => {
  // given
  const topology = yaml.load(readFileSync(new URL("../deploy/compose.security.yaml", import.meta.url), "utf8"));
  // when
  const consumers = Object.entries(topology.services).filter(([, service]) =>
    service.volumes?.some(mount => mount.split(":")[0] === "mfa-keys")).map(([name]) => name).sort();
  // then
  assert.deepEqual(consumers, ["app", "seeder"]);
  assert.deepEqual(Object.keys(topology.volumes), ["mfa-keys"]);
  assert.deepEqual(Object.keys(topology.volumes["mfa-keys"]), ["labels"]);
  for (const name of consumers) {
    const service = topology.services[name];
    assert.equal(service.environment.COURTSIDE_MFA_KEY_ROOT, "/var/lib/courtside/mfa-keys");
    assert.deepEqual(service.volumes.filter(mount => mount.startsWith("mfa-keys:")),
      ["mfa-keys:/var/lib/courtside/mfa-keys"]);
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ["ALL"]);
    assert.deepEqual(service.security_opt, ["no-new-privileges:true"]);
  }
});

test("given SECURITY application key storage, when recovery checks ownership, then its declared labels bind every retained identity", () => {
  // given
  const topology = yaml.load(readFileSync(new URL("../deploy/compose.security.yaml", import.meta.url), "utf8"));
  const expected = { runId: "storage-proof", seedFingerprint: `sha256:${"a".repeat(64)}`,
    instanceFingerprint: `sha256:${"b".repeat(64)}` };
  const values = { COURTSIDE_SECURITY_RUN_ID: expected.runId,
    COURTSIDE_SECURITY_SEED_FINGERPRINT: expected.seedFingerprint,
    COURTSIDE_SECURITY_INSTANCE_FINGERPRINT: expected.instanceFingerprint };
  assert.ok(topology.volumes?.["mfa-keys"], "key storage must declare an owned volume");
  const labels = Object.fromEntries(Object.entries(topology.volumes["mfa-keys"].labels).map(([name, value]) =>
    [name, value.replace(/\$\{([A-Z_]+):\?required\}/g, (_, variable) => values[variable])]));
  labels["com.docker.compose.project"] = "courtside-security-storage-proof";
  const volume = { type: "volume", id: "courtside-security-storage-proof_mfa-keys", labels };
  // when / then
  assert.doesNotThrow(() => assertSecurityRecoveryOwnership([volume], expected));
  assert.deepEqual(Object.keys(labels).sort(), ["com.docker.compose.project", "org.courtside.environment",
    "org.courtside.security.instance-fingerprint", "org.courtside.security.run-id",
    "org.courtside.security.seed-fingerprint"]);
  for (const name of Object.keys(labels)) {
    assert.throws(() => assertSecurityRecoveryOwnership([{ ...volume, labels: { ...labels, [name]: "foreign" } }], expected),
      /does not belong to the retained run identity/);
  }
});
