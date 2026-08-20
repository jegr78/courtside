import { createHash } from "node:crypto";
import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { finalizeSupplyChainEvidence } from "./security-findings.mjs";

function parseArguments(args) {
  const values = {};
  const names = new Set([
    "record", "image", "sbom", "signature-proof", "provenance-proof", "sbom-proof", "output"
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    const name = option?.replace(/^--/, "");
    if (!names.has(name) || !value) throw new Error(`Invalid option ${option}`);
    values[name] = value;
  }
  for (const name of names) if (!values[name]) throw new Error(`Missing --${name}`);
  return values;
}

function fileDigest(path, name) {
  if (statSync(path).size === 0) throw new Error(`${name} proof is empty`);
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function jsonProof(path, name) {
  fileDigest(path, name);
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} proof contains no verification result`);
  return value;
}

function verifySignature(path, imageName, imageDigest) {
  const entries = jsonProof(path, "Signature");
  const matches = entries.some((entry) => entry?.critical?.type === "cosign container image signature"
    && entry.critical.identity?.["docker-reference"] === imageName
    && entry.critical.image?.["docker-manifest-digest"] === imageDigest);
  if (!matches) throw new Error("Signature proof does not match the release image");
  return { status: "verified", subjectDigest: imageDigest, proofDigest: fileDigest(path, "Signature") };
}

function verifiedStatement(path, name, imageName, imageDigest, predicateType) {
  const entries = jsonProof(path, name);
  const statements = entries.map((entry) => entry?.verificationResult?.statement).filter(Boolean);
  const statement = statements.find((candidate) => candidate.predicateType === predicateType
    && candidate.subject?.some((subject) => subject.name === imageName
      && subject.digest?.sha256 === imageDigest.slice("sha256:".length)));
  if (!statement) throw new Error(`${name} proof does not match the release image and predicate`);
  return statement;
}

function main(args) {
  const values = parseArguments(args);
  const imageDigest = values.image.split("@").at(-1);
  const imageName = values.image.slice(0, values.image.lastIndexOf("@"));
  verifiedStatement(values["provenance-proof"], "Provenance", imageName, imageDigest,
    "https://slsa.dev/provenance/v1");
  const sbomAttestation = verifiedStatement(values["sbom-proof"], "SBOM attestation", imageName, imageDigest,
    "https://spdx.dev/Document/v2.3");
  const sbom = JSON.parse(readFileSync(values.sbom, "utf8"));
  if (!isDeepStrictEqual(sbomAttestation.predicate, sbom)) {
    throw new Error("SBOM attestation does not match the release SBOM");
  }
  const proof = (path, name) => ({ status: "verified", subjectDigest: imageDigest, proofDigest: fileDigest(path, name) });
  const result = finalizeSupplyChainEvidence(JSON.parse(readFileSync(values.record, "utf8")), {
    image: values.image,
    sbomDigest: fileDigest(values.sbom, "SBOM"),
    signature: verifySignature(values["signature-proof"], imageName, imageDigest),
    provenance: proof(values["provenance-proof"], "Provenance"),
    sbom: proof(values["sbom-proof"], "SBOM attestation")
  });
  writeFileSync(values.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  chmodSync(values.output, 0o600);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = 1;
  }
}
