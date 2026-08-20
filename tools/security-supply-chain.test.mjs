import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("given verified release proofs, when finalizing the record, then their digests and image identity are retained", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-supply-chain-"));
  const digest = `sha256:${"a".repeat(64)}`;
  const paths = Object.fromEntries(["record", "sbom", "signature", "provenance", "sbom-proof", "output"]
    .map((name) => [name, join(directory, `${name}.json`)]));
  writeFileSync(paths.record, JSON.stringify({
    schemaVersion: 1, scope: "release", subject: digest, status: "passed",
    sources: [], blockingFindings: [], acceptedFindings: [], informationalFindings: []
  }));
  const sbom = { spdxVersion: "SPDX-2.3", name: "courtside" };
  writeFileSync(paths.sbom, JSON.stringify(sbom));
  writeFileSync(paths.signature, JSON.stringify([{ critical: {
    identity: { "docker-reference": "ghcr.io/example/courtside" },
    image: { "docker-manifest-digest": digest }, type: "cosign container image signature"
  } }]));
  writeFileSync(paths.provenance, JSON.stringify([{ verificationResult: { statement: {
    subject: [{ name: "ghcr.io/example/courtside", digest: { sha256: digest.slice(7) } }],
    predicateType: "https://slsa.dev/provenance/v1", predicate: {}
  } } }]));
  writeFileSync(paths["sbom-proof"], JSON.stringify([{ verificationResult: { statement: {
    subject: [{ name: "ghcr.io/example/courtside", digest: { sha256: digest.slice(7) } }],
    predicateType: "https://spdx.dev/Document/v2.3", predicate: sbom
  } } }]));

  try {
    // when
    const result = spawnSync(process.execPath, [new URL("./security-supply-chain.mjs", import.meta.url).pathname,
      "--record", paths.record, "--image", `ghcr.io/example/courtside@${digest}`,
      "--sbom", paths.sbom, "--signature-proof", paths.signature,
      "--provenance-proof", paths.provenance, "--sbom-proof", paths["sbom-proof"], "--output", paths.output]);

    // then
    assert.equal(result.status, 0, result.stderr.toString());
    const record = JSON.parse(readFileSync(paths.output, "utf8"));
    assert.equal(record.supplyChain.imageDigest, digest);
    assert.match(record.supplyChain.signature.proofDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(statSync(paths.output).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("given a proof for another image, when finalizing the record, then publication fails closed", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-supply-chain-"));
  const digest = `sha256:${"a".repeat(64)}`;
  const record = join(directory, "record.json");
  const proof = join(directory, "proof.json");
  writeFileSync(record, JSON.stringify({
    schemaVersion: 1, scope: "release", subject: digest, status: "passed",
    sources: [], blockingFindings: [], acceptedFindings: [], informationalFindings: []
  }));
  writeFileSync(proof, JSON.stringify([{ critical: {
    identity: { "docker-reference": "ghcr.io/example/courtside" },
    image: { "docker-manifest-digest": `sha256:${"b".repeat(64)}` },
    type: "cosign container image signature"
  } }]));

  try {
    // when
    const result = spawnSync(process.execPath, [new URL("./security-supply-chain.mjs", import.meta.url).pathname,
      "--record", record, "--image", `ghcr.io/example/courtside@${digest}`,
      "--sbom", proof, "--signature-proof", proof, "--provenance-proof", proof,
      "--sbom-proof", proof, "--output", join(directory, "output.json")]);

    // then
    assert.equal(result.status, 1);
    assert.match(result.stderr.toString(), /does not match the release image/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("given an attestation for another SBOM, when finalizing the record, then publication fails closed", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-supply-chain-"));
  const digest = `sha256:${"a".repeat(64)}`;
  const paths = Object.fromEntries(["record", "sbom", "signature", "provenance", "sbom-proof", "output"]
    .map((name) => [name, join(directory, `${name}.json`)]));
  writeFileSync(paths.record, JSON.stringify({
    schemaVersion: 1, scope: "release", subject: digest, status: "passed",
    sources: [], blockingFindings: [], acceptedFindings: [], informationalFindings: []
  }));
  writeFileSync(paths.sbom, JSON.stringify({ spdxVersion: "SPDX-2.3", name: "courtside" }));
  writeFileSync(paths.signature, JSON.stringify([{ critical: {
    identity: { "docker-reference": "ghcr.io/example/courtside" },
    image: { "docker-manifest-digest": digest }, type: "cosign container image signature"
  } }]));
  const statement = (predicateType, predicate) => [{ verificationResult: { statement: {
    subject: [{ name: "ghcr.io/example/courtside", digest: { sha256: digest.slice(7) } }], predicateType, predicate
  } } }];
  writeFileSync(paths.provenance, JSON.stringify(statement("https://slsa.dev/provenance/v1", {})));
  writeFileSync(paths["sbom-proof"], JSON.stringify(statement(
    "https://spdx.dev/Document/v2.3", { spdxVersion: "SPDX-2.3", name: "another-image" })));

  try {
    // when
    const result = spawnSync(process.execPath, [new URL("./security-supply-chain.mjs", import.meta.url).pathname,
      "--record", paths.record, "--image", `ghcr.io/example/courtside@${digest}`,
      "--sbom", paths.sbom, "--signature-proof", paths.signature,
      "--provenance-proof", paths.provenance, "--sbom-proof", paths["sbom-proof"], "--output", paths.output]);

    // then
    assert.equal(result.status, 1);
    assert.match(result.stderr.toString(), /SBOM attestation does not match the release SBOM/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
