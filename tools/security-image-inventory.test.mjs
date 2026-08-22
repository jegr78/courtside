import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { assessmentImages } from "./security-image-inventory.mjs";
import { securityImportSourceKey, securityImportSourceRequest } from "./security-openapi-fuzz.mjs";

test("given active assessment configuration_whenResolvingImages_thenAllPinnedRuntimeImagesAreReturnedOnce", () => {
  // when
  const images = assessmentImages("active");

  // then
  assert.deepEqual(images.map((image) => image.split("@")[0]), [
    "caddy:2-alpine",
    "postgres:17-alpine",
    "schemathesis/schemathesis:4.25.0",
    "zaproxy/zap-stable:2.17.0",
  ]);
  assert.ok(images.every((image) => /@sha256:[a-f0-9]{64}$/.test(image)));
});

test("givenSafeAssessment_whenResolvingImages_thenDestructiveScannerIsExcluded", () => {
  // when
  const images = assessmentImages("safe");

  // then
  assert.equal(images.some((image) => image.startsWith("grafana/k6:")), false);
  assert.equal(images.some((image) => image.startsWith("schemathesis/")), false);
});

test("givenAnUnpinnedComposeImage_whenResolvingImages_thenResolutionFailsClosed", () => {
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

test("givenTwoAssessmentRuns_whenPreparingImportFixtures_thenTheirSourceKeysDoNotCollide", () => {
  // when
  const first = securityImportSourceKey("compare-base-123-1", 1);
  const second = securityImportSourceKey("compare-head-123-1", 1);

  // then
  assert.notEqual(first, second);
  assert.match(first, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(first.length <= 40);
});

test("givenAnAssessmentRun_whenPreparingItsImportSource_thenRequiredTransportFieldsAreExplicit", () => {
  // when
  const source = securityImportSourceRequest("compare-head-123-1", 1);

  // then
  assert.equal(source.separator, ";");
  assert.equal(source.encoding, "UTF-8");
});
