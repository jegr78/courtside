import { createHash } from "node:crypto";
import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
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

function main(args) {
  const values = parseArguments(args);
  const imageDigest = values.image.split("@").at(-1);
  const proof = (path, name) => ({
    status: "verified", subjectDigest: imageDigest, proofDigest: fileDigest(path, name)
  });
  const result = finalizeSupplyChainEvidence(JSON.parse(readFileSync(values.record, "utf8")), {
    image: values.image,
    sbomDigest: fileDigest(values.sbom, "SBOM"),
    signature: proof(values["signature-proof"], "Signature"),
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
