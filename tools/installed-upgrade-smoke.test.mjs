import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { comparablePersistedData, qualificationCandidate } from "./installed-upgrade-smoke.mjs";

const nightlySigner =
  "https://github.com/jegr78/courtside/.github/workflows/nightly-image.yml@refs/heads/main";

function fixture(signer) {
  const root = mkdtempSync(join(tmpdir(), "courtside-installed-upgrade-test-"));
  const candidate = join(root, "candidate");
  mkdirSync(candidate);
  writeFileSync(join(candidate, "manifest.json"), `${JSON.stringify({
    version: "0.1.0-nightly.123",
    signer,
  }, null, 2)}\n`);
  writeFileSync(join(candidate, "compose.yaml"), "services: {}\n");
  return { root, candidate };
}

test("given an official nightly, when installed upgrade qualification starts, then it uses the archive unchanged", () => {
  const context = fixture(nightlySigner);
  try {
    assert.equal(qualificationCandidate(context.candidate, context.root), context.candidate);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("given a manual branch nightly, when installed upgrade qualification starts, then only an ephemeral mirror claims the trusted signer", () => {
  const branchSigner =
    "https://github.com/jegr78/courtside/.github/workflows/nightly-image.yml@refs/heads/fix/postgresql-installed-upgrade";
  const context = fixture(branchSigner);
  try {
    const mirror = qualificationCandidate(context.candidate, context.root);

    assert.notEqual(mirror, context.candidate);
    assert.equal(JSON.parse(readFileSync(join(mirror, "manifest.json"), "utf8")).signer, nightlySigner);
    assert.equal(JSON.parse(readFileSync(join(context.candidate, "manifest.json"), "utf8")).signer,
      branchSigner);
    assert.equal(readFileSync(join(mirror, "compose.yaml"), "utf8"), "services: {}\n");
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("given a nightly from another signer, when installed upgrade qualification starts, then it is refused", () => {
  const context = fixture(
    "https://github.com/attacker/courtside/.github/workflows/nightly-image.yml@refs/heads/main");
  try {
    assert.throws(() => qualificationCandidate(context.candidate, context.root),
      /cannot qualify untrusted candidate signer/);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

const persisted = (keyCheck, installation = "b7d0fd17-1d30-44a4-bbc6-5be2a1c196a2") => ({
  accounts: 4,
  mfaInstanceKeyRows: [{ id: 1, installation_id: installation, key_check: keyCheck }]
});

test("given an origin release without an MFA key store, when the update writes a new key check, then only the key check is exempt", () => {
  // when
  const [before, after] = comparablePersistedData(persisted("51a9e8ad"), persisted("24f91e3c"), { originKeepsMfaKeys: false });
  // then
  assert.deepEqual(after, before, "an origin that kept its keys nowhere cannot prove their preservation");
});

test("given an origin release without an MFA key store, when the update changes the installation, then the update is refused", () => {
  // when / then
  assert.throws(() => comparablePersistedData(persisted("51a9e8ad"), persisted("24f91e3c", "00000000-0000-0000-0000-000000000000"),
    { originKeepsMfaKeys: false }), /installation/, "the database installation identity must survive the update");
  assert.throws(() => comparablePersistedData(persisted("51a9e8ad"), persisted(null), { originKeepsMfaKeys: false }),
    /key check/, "the updated instance must hold a key check");
});

test("given an origin release with an MFA key store, when the update writes a new key check, then the change stays visible", () => {
  // when
  const [before, after] = comparablePersistedData(persisted("51a9e8ad"), persisted("24f91e3c"), { originKeepsMfaKeys: true });
  // then
  assert.notDeepEqual(after, before, "a preserved key store must keep its key check");
});
