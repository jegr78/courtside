import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const digest = `sha256:${"a".repeat(64)}`;

function workspace(subject = digest) {
  const directory = mkdtempSync(join(tmpdir(), "courtside-supply-chain-"));
  const paths = Object.fromEntries(["record", "sbom", "signature", "provenance", "sbom-proof", "output"]
    .map((name) => [name, join(directory, `${name}.json`)]));
  writeFileSync(paths.record, JSON.stringify({
    schemaVersion: 1, scope: "release", subject, status: "passed",
    sources: [], blockingFindings: [], acceptedFindings: [], informationalFindings: []
  }));
  for (const name of ["sbom", "signature", "provenance", "sbom-proof"]) writeFileSync(paths[name], `${name} output`);
  return { directory, paths };
}

function run(paths) {
  return spawnSync(process.execPath, [new URL("./security-supply-chain.mjs", import.meta.url).pathname,
    "--record", paths.record, "--image", `ghcr.io/example/courtside@${digest}`,
    "--sbom", paths.sbom, "--signature-proof", paths.signature,
    "--provenance-proof", paths.provenance, "--sbom-proof", paths["sbom-proof"], "--output", paths.output]);
}

test("given verified release proofs in any format, when finalizing the record, then their digests and the image "
  + "identity are retained", () => {
  // given
  const { directory, paths } = workspace();

  try {
    // when
    const result = run(paths);

    // then
    assert.equal(result.status, 0, result.stderr.toString());
    const record = JSON.parse(readFileSync(paths.output, "utf8"));
    assert.equal(record.supplyChain.imageDigest, digest);
    assert.match(record.supplyChain.signature.proofDigest, /^sha256:[a-f0-9]{64}$/);
    assert.notEqual(record.supplyChain.signature.proofDigest, record.supplyChain.provenance.proofDigest,
      "each proof keeps the digest of its own file");
    assert.equal(statSync(paths.output).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("given a verification that wrote nothing, when finalizing the record, then publication fails closed", () => {
  // given
  const { directory, paths } = workspace();
  writeFileSync(paths.signature, "");

  try {
    // when
    const result = run(paths);

    // then
    assert.equal(result.status, 1);
    assert.match(result.stderr.toString(), /Signature proof is empty/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("given a security record for another image, when finalizing it, then publication fails closed", () => {
  // given
  const { directory, paths } = workspace(`sha256:${"b".repeat(64)}`);

  try {
    // when
    const result = run(paths);

    // then
    assert.equal(result.status, 1);
    assert.match(result.stderr.toString(), /Supply-chain digest mismatch/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
