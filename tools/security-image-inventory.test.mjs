import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { assessmentImages } from "./security-image-inventory.mjs";
import { securityImportSourceKey, securityImportSourceRequest } from "./security-openapi-fuzz.mjs";

test("given active assessment configuration, when resolving images, then all pinned runtime images are returned once", () => {
  // when
  const images = assessmentImages("active");

  // then
  assert.deepEqual(images.map((image) => image.split("@")[0]), [
    "caddy:2-alpine",
    "postgres:17-alpine",
    "schemathesis/schemathesis:4.25.2",
    "zaproxy/zap-stable:2.17.0",
  ]);
  assert.ok(images.every((image) => /@sha256:[a-f0-9]{64}$/.test(image)));
});

test("given safe assessment, when resolving images, then destructive scanner is excluded", () => {
  // when
  const images = assessmentImages("safe");

  // then
  assert.equal(images.some((image) => image.startsWith("grafana/k6:")), false);
  assert.equal(images.some((image) => image.startsWith("schemathesis/")), false);
});

test("given an unpinned compose image, when resolving images, then resolution fails closed", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "security-images-"));
  const compose = join(directory, "compose.yaml");
  writeFileSync(compose, "services:\n  database:\n    image: postgres:17-alpine\n");

  // when / then
  assert.throws(
    () => assessmentImages("safe", { compose }),
    /must use an immutable sha256 digest/,
  );
});

test("given two assessment runs, when preparing import fixtures, then their source keys do not collide", () => {
  // when
  const first = securityImportSourceKey("compare-base-123-1", 1);
  const second = securityImportSourceKey("compare-head-123-1", 1);

  // then
  assert.notEqual(first, second);
  assert.match(first, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(first.length <= 40);
});

test("given an assessment run, when preparing its import source, then required transport fields are explicit", () => {
  // when
  const source = securityImportSourceRequest("compare-head-123-1", 1);

  // then
  assert.equal(source.separator, ";");
  assert.equal(source.encoding, "UTF-8");
});
