import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateTransitionCandidate, canRemoveQualificationVolume, pinnedRuntimeImage } from "./stalwart-store-transition-smoke.mjs";

function candidate(use) {
  const root = mkdtempSync(join(tmpdir(), "courtside-transition-input-"));
  const content = "#!/bin/bash\nexit 0\n";
  writeFileSync(join(root, "courtside"), content);
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ schema: 1, version: "0.4.0-rc.1",
    revision: "a".repeat(40), image: `ghcr.io/jegr78/courtside@sha256:${"b".repeat(64)}`,
    signer: "https://github.com/jegr78/courtside/.github/workflows/release.yml@refs/tags/v0.4.0-rc.1",
    files: { courtside: createHash("sha256").update(content).digest("hex") } }));
  try { use(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("given an intact candidate archive, when transition qualification starts, then it binds to the supplied image", () => {
  candidate((root) => {
    // when
    const manifest = validateTransitionCandidate(root);
    // then
    assert.equal(manifest.image, `ghcr.io/jegr78/courtside@sha256:${"b".repeat(64)}`);
  });
});

test("given a changed candidate file, when transition qualification starts, then it refuses before fixture adaptation", () => {
  candidate((root) => {
    // given
    writeFileSync(join(root, "courtside"), "changed\n");
    // when / then
    assert.throws(() => validateTransitionCandidate(root), /integrity/);
  });
});

test("given a symlinked candidate file, when transition qualification starts, then it refuses the file", () => {
  candidate((root) => {
    // given
    rmSync(join(root, "courtside"));
    symlinkSync("manifest.json", join(root, "courtside"));
    // when / then
    assert.throws(() => validateTransitionCandidate(root), /regular|symlink/);
  });
});

test("given foreign or unlabelled volumes, when qualification cleans up, then it retains them", () => {
  // when / then
  assert.equal(canRemoveQualificationVolume("mail-data", {}, "courtside-transition-test"), false);
  assert.equal(canRemoveQualificationVolume("foreign_mail-data", { "com.docker.compose.project": "foreign" }, "courtside-transition-test"), false);
  assert.equal(canRemoveQualificationVolume("courtside-transition-test_mail-data", { "com.docker.compose.project": "foreign" }, "courtside-transition-test"), false);
  assert.equal(canRemoveQualificationVolume("foreign_mail-data", { "com.docker.compose.project": "courtside-transition-test" }, "courtside-transition-test"), false);
  assert.equal(canRemoveQualificationVolume("courtside-transition-test_mail-data", { "com.docker.compose.project": "courtside-transition-test" }, "courtside-transition-test"), true);
});

test("given an undeclared candidate file, when transition qualification starts, then it refuses the incomplete inventory", () => {
  candidate((root) => {
    // given
    writeFileSync(join(root, "extra.conf"), "untracked");
    // when / then
    assert.throws(() => validateTransitionCandidate(root), /inventory/);
  });
});

test("given a candidate signer names another release, when qualification starts, then it refuses the identity", () => {
  candidate((root) => {
    // given
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json")));
    manifest.signer = manifest.signer.replace("v0.4.0-rc.1", "v0.3.0");
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    // when / then
    assert.throws(() => validateTransitionCandidate(root), /identity/);
  });
});

test("given the published runtime baseline, when qualification resolves it, then both fixtures use one exact digest", () => {
  // when / then
  const image = `ghcr.io/jegr78/courtside@sha256:${"a".repeat(64)}`;
  assert.equal(pinnedRuntimeImage(["ghcr.io/jegr78/courtside:nightly", image]), image);
  assert.throws(() => pinnedRuntimeImage(["ghcr.io/jegr78/courtside:nightly"]), /digest/);
  assert.throws(() => pinnedRuntimeImage([`registry.example.org/courtside@sha256:${"a".repeat(64)}`]), /digest/);
});

test("given a manual branch nightly, when its archive is qualified, then its image and revision remain bound", () => {
  candidate((root) => {
    // given
    const path = join(root, "manifest.json");
    const manifest = JSON.parse(readFileSync(path));
    manifest.version = "0.4.0-nightly.7";
    manifest.signer = "https://github.com/jegr78/courtside/.github/workflows/nightly-image.yml@refs/heads/feat/mail-transition";
    writeFileSync(path, JSON.stringify(manifest));
    // when
    const actual = validateTransitionCandidate(root);
    // then
    assert.equal(actual.image, manifest.image);
    assert.equal(actual.revision, manifest.revision);
    writeFileSync(path, JSON.stringify({ ...manifest, signer: manifest.signer.replace("jegr78/courtside", "example/courtside") }));
    assert.throws(() => validateTransitionCandidate(root), /identity/);
  });
});
