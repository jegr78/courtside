import assert from "node:assert/strict";
import test from "node:test";

import { applyDeletionPlan, planNightlyImageRetention } from "./nightly-image-retention.mjs";

const now = "2026-09-13T12:00:00.000Z";
const old = "2026-09-11T12:00:00.000Z";

function version(id, digest, tags = [], updatedAt = old) {
  return { id, digest, tags, updatedAt };
}

function manifests(...digests) {
  return Object.fromEntries(digests.map((digest) => [digest, { children: [] }]));
}

test("given more than seven dated images, when retention is planned, then only the newest seven dates remain", () => {
  // given
  const versions = Array.from({ length: 9 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return version(index + 1, `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
      [`nightly-202609${day}-abc${String(index).padStart(4, "0")}`]);
  });

  // when
  const plan = planNightlyImageRetention({ versions,
    manifests: manifests(...versions.map(({ digest }) => digest)), now });

  // then
  assert.deepEqual(plan.deleteVersionIds, [1, 2]);
  assert.deepEqual(plan.keptDatedTags, versions.slice(2).map(({ tags }) => tags[0]).reverse());
});

test("given several publications on one date, when retention is planned, then registry time decides which is newest", () => {
  // given
  const versions = Array.from({ length: 8 }, (_, index) => version(index + 1,
    `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
    [`nightly-20260913-${index === 0 ? "fffffff" : String(index).padStart(7, "0")}`],
    `2026-09-13T${String(index).padStart(2, "0")}:00:00Z`));

  // when
  const plan = planNightlyImageRetention({ versions,
    manifests: manifests(...versions.map(({ digest }) => digest)), now: "2026-09-15T12:00:00Z" });

  // then
  assert.deepEqual(plan.deleteVersionIds, [1]);
  assert.equal(plan.keptDatedTags.includes("nightly-20260913-fffffff"), false);
});

test("given release and moving nightly tags, when retention is planned, then every named root remains", () => {
  // given
  const versions = [
    version(1, `sha256:${"1".repeat(64)}`, ["nightly"]),
    version(2, `sha256:${"2".repeat(64)}`, ["nightly-candidate"]),
    version(3, `sha256:${"3".repeat(64)}`, ["0.1.0"]),
    version(4, `sha256:${"4".repeat(64)}`, ["nightly-experimental"]),
  ];

  // when
  const plan = planNightlyImageRetention({ versions,
    manifests: manifests(...versions.map(({ digest }) => digest)), now });

  // then
  assert.deepEqual(plan.keepVersionIds, [1, 2, 3]);
  assert.deepEqual(plan.deleteVersionIds, [4]);
});

test("given a kept index, when retention follows its manifests, then every platform child remains", () => {
  // given
  const index = `sha256:${"a".repeat(64)}`;
  const amd64 = `sha256:${"b".repeat(64)}`;
  const arm64 = `sha256:${"c".repeat(64)}`;
  const versions = [version(1, index, ["nightly"]), version(2, amd64), version(3, arm64)];

  // when
  const plan = planNightlyImageRetention({ versions,
    manifests: { [index]: { children: [amd64, arm64] }, ...manifests(amd64, arm64) }, now });

  // then
  assert.deepEqual(plan.keepVersionIds, [1, 2, 3]);
  assert.deepEqual(plan.deleteVersionIds, []);
});

test("given signature and attestation tags for a kept digest, when closure stabilizes, then their children remain", () => {
  // given
  const image = `sha256:${"a".repeat(64)}`;
  const signature = `sha256:${"b".repeat(64)}`;
  const signatureChild = `sha256:${"c".repeat(64)}`;
  const versions = [
    version(1, image, ["nightly"]),
    version(2, signature, [`sha256-${"a".repeat(64)}`]),
    version(3, signatureChild),
  ];

  // when
  const plan = planNightlyImageRetention({ versions, manifests: {
    [image]: { children: [] }, [signature]: { children: [signatureChild] },
    [signatureChild]: { children: [] },
  }, now });

  // then
  assert.deepEqual(plan.keepVersionIds, [1, 2, 3]);
});

test("given a native OCI referrer for a kept digest, when closure stabilizes, then the referrer remains", () => {
  // given
  const image = `sha256:${"a".repeat(64)}`;
  const attestation = `sha256:${"b".repeat(64)}`;
  const versions = [version(1, image, ["nightly"]), version(2, attestation)];

  // when
  const plan = planNightlyImageRetention({ versions, manifests: {
    [image]: { children: [] },
    [attestation]: { children: [], subject: image },
  }, now });

  // then
  assert.deepEqual(plan.keepVersionIds, [1, 2]);
});

test("given evidence for an expired digest, when retention is planned, then the evidence expires with it", () => {
  // given
  const image = `sha256:${"a".repeat(64)}`;
  const signature = `sha256:${"b".repeat(64)}`;
  const versions = [version(1, image), version(2, signature, [`sha256-${"a".repeat(64)}.sig`])];

  // when
  const plan = planNightlyImageRetention({ versions, manifests: manifests(image, signature), now });

  // then
  assert.deepEqual(plan.deleteVersionIds, [1, 2]);
});

test("given a cosign signature for a release digest, when retention is planned, then both remain", () => {
  // given
  const image = `sha256:${"c".repeat(64)}`;
  const signature = `sha256:${"d".repeat(64)}`;
  const versions = [
    version(1, image, ["0.1.0"]),
    version(2, signature, [`sha256-${"c".repeat(64)}.sig`]),
  ];

  // when
  const plan = planNightlyImageRetention({ versions, manifests: manifests(image, signature), now });

  // then
  assert.deepEqual(plan.keepVersionIds, [1, 2]);
});

test("given a digest shared by nightly and a release tag, when nightly dates expire, then the version remains", () => {
  // given
  const digest = `sha256:${"d".repeat(64)}`;
  const versions = [version(8, digest, ["nightly-20260801-deadbee", "0.1.0"] )];

  // when
  const plan = planNightlyImageRetention({ versions, manifests: manifests(digest), now });

  // then
  assert.deepEqual(plan.keepVersionIds, [8]);
  assert.deepEqual(plan.deleteVersionIds, []);
});

test("given a failed release candidate outlives its evidence, when nightly retention runs, then its complete closure expires", () => {
  // given
  const image = `sha256:${"a".repeat(64)}`;
  const child = `sha256:${"b".repeat(64)}`;
  const signature = `sha256:${"c".repeat(64)}`;
  const versions = [
    version(1, image, [`release-candidate-${"d".repeat(40)}`], "2026-08-29T11:59:59.999Z"),
    version(2, child, [], "2026-08-29T11:59:59.999Z"),
    version(3, signature, [`sha256-${"a".repeat(64)}.sig`], "2026-08-29T11:59:59.999Z"),
  ];

  // when
  const plan = planNightlyImageRetention({ versions, manifests: {
    [image]: { children: [child] }, [child]: { children: [] }, [signature]: { children: [] },
  }, now });

  // then
  assert.deepEqual(plan.deleteVersionIds, [1, 2, 3]);
});

test("given a recent failed release candidate, when retention runs, then its diagnostic closure remains", () => {
  // given
  const image = `sha256:${"a".repeat(64)}`;
  const child = `sha256:${"b".repeat(64)}`;
  const versions = [
    version(1, image, [`release-candidate-${"d".repeat(40)}`], "2026-09-01T12:00:00.000Z"),
    version(2, child, [], "2026-09-01T12:00:00.000Z"),
  ];

  // when
  const plan = planNightlyImageRetention({ versions,
    manifests: { [image]: { children: [child] }, [child]: { children: [] } }, now });

  // then
  assert.deepEqual(plan.keepVersionIds, [1, 2]);
  assert.deepEqual(plan.deleteVersionIds, []);
});

test("given a published version shares its digest with a release candidate, when retention runs, then it remains", () => {
  // given
  const image = `sha256:${"a".repeat(64)}`;
  const versions = [version(1, image,
    [`release-candidate-${"d".repeat(40)}`, "0.1.0-rc.1"], "2026-08-01T12:00:00.000Z")];

  // when
  const plan = planNightlyImageRetention({ versions, manifests: manifests(image), now });

  // then
  assert.deepEqual(plan.keepVersionIds, [1]);
  assert.deepEqual(plan.deleteVersionIds, []);
});

test("given an old candidate digest whose tag moved, when retention is planned, then the orphan is deleted", () => {
  // given
  const current = `sha256:${"e".repeat(64)}`;
  const orphan = `sha256:${"f".repeat(64)}`;
  const versions = [version(1, current, ["nightly-candidate"]), version(2, orphan)];

  // when
  const plan = planNightlyImageRetention({ versions, manifests: manifests(current, orphan), now });

  // then
  assert.deepEqual(plan.deleteVersionIds, [2]);
});

test("given an unreferenced version at the age boundary, when retention is planned, then only an older version is deleted", () => {
  // given
  const boundary = "2026-09-12T12:00:00.000Z";
  const versions = [
    version(1, `sha256:${"1".repeat(64)}`, [], boundary),
    version(2, `sha256:${"2".repeat(64)}`, [], "2026-09-12T11:59:59.999Z"),
  ];

  // when
  const plan = planNightlyImageRetention({ versions,
    manifests: manifests(...versions.map(({ digest }) => digest)), now });

  // then
  assert.deepEqual(plan.deleteVersionIds, [2]);
});

test("given GitHub timestamps without milliseconds, when retention is planned, then they remain valid inputs", () => {
  // given
  const digest = `sha256:${"3".repeat(64)}`;

  // when
  const plan = planNightlyImageRetention({
    versions: [version(3, digest, [], "2026-09-11T12:00:00Z")],
    manifests: manifests(digest),
    now: "2026-09-13T12:00:00Z",
  });

  // then
  assert.deepEqual(plan.deleteVersionIds, [3]);
});

test("given the incident backlog, when retention is planned, then every eligible version is returned", () => {
  // given
  const versions = Array.from({ length: 64 }, (_, index) => version(index + 1,
    `sha256:${index.toString(16).padStart(64, "0")}`));

  // when
  const plan = planNightlyImageRetention({ versions,
    manifests: manifests(...versions.map(({ digest }) => digest)), now });

  // then
  assert.equal(plan.plannedDeletionCount, versions.length);
  assert.deepEqual(plan.deleteVersionIds, versions.map(({ id }) => id));
});

test("given an unreadable kept manifest, when retention is planned, then it refuses an unsafe deletion plan", () => {
  // given
  const digest = `sha256:${"a".repeat(64)}`;

  // when / then
  assert.throws(() => planNightlyImageRetention({ versions: [version(1, digest, ["nightly"])],
    manifests: {}, now }), /manifest .* is unavailable/);
});

test("given a tag moves after planning, when deletion starts, then no stale version id is deleted", async () => {
  // given
  const digest = `sha256:${"a".repeat(64)}`;
  const initial = [version(1, digest)];
  const changed = [version(1, digest, ["0.1.0"], "2026-09-13T12:01:00Z")];
  const deleted = [];

  // when / then
  await assert.rejects(() => applyDeletionPlan({
    expectedVersions: initial,
    deleteVersionIds: [1],
    loadVersions: async () => changed,
    deleteVersion: async (id) => deleted.push(id),
  }), /registry changed after retention planning/);
  assert.deepEqual(deleted, []);
});
