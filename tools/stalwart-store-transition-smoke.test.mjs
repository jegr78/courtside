import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateTransitionCandidate, snapshotTransitionCandidate, materializeTransitionCandidate, canRemoveQualificationVolume, pinnedRuntimeImage,
  qualificationSecrets, transitionFailureEvidence } from "./stalwart-store-transition-smoke.mjs";

const workflow = readFileSync(new URL("../.github/workflows/mail-smoke.yml", import.meta.url), "utf8");

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

test("given a symlinked candidate root, when transition qualification starts, then it refuses before copying", () => {
  candidate((root) => {
    // given
    const parent = mkdtempSync(join(tmpdir(), "courtside-transition-alias-"));
    const alias = join(parent, "candidate");
    symlinkSync(root, alias);
    try {
      // when / then
      assert.throws(() => validateTransitionCandidate(alias), /directory|symlink/);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
});

test("given a symlinked candidate manifest, when transition qualification starts, then it refuses before adapting", () => {
  candidate((root) => {
    // given
    const parent = mkdtempSync(join(tmpdir(), "courtside-transition-manifest-"));
    const manifest = join(parent, "manifest.json");
    writeFileSync(manifest, readFileSync(join(root, "manifest.json")));
    rmSync(join(root, "manifest.json"));
    symlinkSync(manifest, join(root, "manifest.json"));
    try {
      // when / then
      assert.throws(() => validateTransitionCandidate(root), /regular|symlink/);
    } finally { rmSync(parent, { recursive: true, force: true }); }
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
    writeFileSync(path, JSON.stringify({ ...manifest, signer: manifest.signer.replace("jegr78/courtside", "sample/courtside") }));
    assert.throws(() => validateTransitionCandidate(root), /identity/);
  });
});

test("given a validated candidate snapshot, when its source files and manifest change, then materialization retains only the validated bytes", () => {
  candidate((root) => {
    // given
    const original = readFileSync(join(root, "courtside"), "utf8");
    const snapshot = snapshotTransitionCandidate(root);
    const parent = mkdtempSync(join(tmpdir(), "courtside-transition-snapshot-"));
    const destination = join(parent, "candidate");
    writeFileSync(join(root, "courtside"), "changed executable\n");
    const changed = JSON.parse(readFileSync(join(root, "manifest.json")));
    changed.files.courtside = createHash("sha256").update("changed executable\n").digest("hex");
    writeFileSync(join(root, "manifest.json"), JSON.stringify(changed));
    try {
      // when
      materializeTransitionCandidate(snapshot, destination);
      // then
      assert.equal(readFileSync(join(destination, "courtside"), "utf8"), original);
      assert.deepEqual(validateTransitionCandidate(destination), snapshot.manifest);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
});

test("given a validated candidate snapshot, when source entries become external symlinks, then the private candidate contains regular validated files", () => {
  candidate((root) => {
    // given
    const snapshot = snapshotTransitionCandidate(root);
    const parent = mkdtempSync(join(tmpdir(), "courtside-transition-snapshot-links-"));
    const outside = join(parent, "outside.json");
    writeFileSync(outside, readFileSync(join(root, "manifest.json")));
    for (const path of ["courtside", "manifest.json"]) {
      rmSync(join(root, path));
      symlinkSync(outside, join(root, path));
    }
    const destination = join(parent, "candidate");
    try {
      // when
      materializeTransitionCandidate(snapshot, destination);
      // then
      assert.equal(lstatSync(join(destination, "manifest.json")).isSymbolicLink(), false);
      assert.equal(lstatSync(join(destination, "courtside")).isSymbolicLink(), false);
      assert.deepEqual(validateTransitionCandidate(destination), snapshot.manifest);
      assert.deepEqual(JSON.parse(readFileSync(outside)), snapshot.manifest);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
});

test("given a failed qualification, when its evidence is written, then every installation secret is redacted", () => {
  // given
  const installation = mkdtempSync(join(tmpdir(), "courtside-transition-secrets-"));
  const mailPassword = "a1".repeat(24);
  const setupPassword = "b2".repeat(24);
  const bootstrapPassword = "Bootstrap-Private-Value";
  try {
    mkdirSync(join(installation, "config"));
    mkdirSync(join(installation, "secrets"));
    mkdirSync(join(installation, ".courtside-mail-transition"));
    writeFileSync(join(installation, "config", ".env"), `COURTSIDE_DOMAIN="courts.example.org"\nCOURTSIDE_MAIL_PASSWORD="${mailPassword}"\n`);
    writeFileSync(join(installation, ".courtside-mail-transition", "setup.env"),
      `COURTSIDE_MAIL_SETUP_PASSWORD="${setupPassword}"\nCOURTSIDE_MAIL_RECOVERY_ADMIN="admin:${setupPassword}"\n`);
    writeFileSync(join(installation, "secrets", "bootstrap-admin-password"), `${bootstrapPassword}\n`);
    const error = Object.assign(new Error(`docker compose failed for ${mailPassword}`),
      { status: 9, signal: null, detail: `STALWART_PASSWORD=${setupPassword}\nbootstrap ${bootstrapPassword}` });
    const mailLog = `${"line\n".repeat(400)}auth admin:${setupPassword} for courts.example.org\n`;
    // when
    const evidence = transitionFailureEvidence({ stage: "transition preflight", error, mailLog,
      secrets: qualificationSecrets(installation) });
    // then
    const text = JSON.stringify(evidence);
    for (const secret of [mailPassword, setupPassword, bootstrapPassword]) {
      assert.ok(!text.includes(secret), "failure evidence must not carry an installation secret");
    }
    assert.equal(evidence.stage, "transition preflight");
    assert.deepEqual(evidence.exit, { status: 9, signal: null });
    assert.match(evidence.message, /docker compose failed for \[REDACTED\]/);
    assert.ok(evidence.mailLogTail.includes("for courts.example.org"), "non-secret context must survive redaction");
    assert.ok(evidence.mailLogTail.split("\n").length <= 200, "the mail log must be bounded to its tail");
    assert.equal(text.includes("COURTSIDE_DOMAIN"), false, "no environment file content may be copied");
  } finally { rmSync(installation, { recursive: true, force: true }); }
});

test("given the scheduled transition smoke, when it finishes either way, then its JSON evidence is uploaded", () => {
  // when / then
  assert.match(workflow, /if: always\(\)\n\s+uses: actions\/upload-artifact@[a-f0-9]{40}[^\n]*\n\s+with:\n\s+name: stalwart-store-transition\n\s+path: build\/stalwart-store-transition\/\*\.json/,
    "a failed transition must still upload failure.json");
});
