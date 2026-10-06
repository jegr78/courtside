import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { assessmentImages } from "./security-image-inventory.mjs";
import { securityImportSourceKey, securityImportSourceRequest } from "./security-openapi-fuzz.mjs";

const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");
const composeServices = yaml.load(readFileSync(new URL("../deploy/compose.security.yaml", import.meta.url), "utf8")).services;

test("given active assessment configuration, when resolving images, then all pinned runtime images are returned once", () => {
  // when
  const images = assessmentImages("active");

  // then
  assert.deepEqual(images.map((image) => image.split("@")[0]), [
    "axllent/mailpit:v1.31",
    "caddy:2-alpine",
    "postgres:18-alpine",
    "schemathesis/schemathesis:v4.28.0",
    "zaproxy/zap-stable:2.17.0",
  ]);
  assert.ok(images.every((image) => /@sha256:[a-f0-9]{64}$/.test(image)));
});

for (const profile of ["safe", "active", "destructive"]) {
  test(`given ${profile} assessment Compose runtime images, when resolving inventory, then include the pinned mail sink and exclude candidate variables`, () => {
    // given
    const mailImage = composeServices.mail.image;
    assert.match(mailImage, /^axllent\/mailpit:[^\s@]+@sha256:[a-f0-9]{64}$/);
    // when
    const images = assessmentImages(profile);
    // then
    assert.ok(images.includes(mailImage));
    assert.ok(images.every((image) => !image.includes("$")));
    assert.equal(images.some((image) => image.startsWith("grafana/k6:")), profile === "destructive");
  });
}

test("given an additional literal runtime image and candidate variables, when resolving inventory, then include arbitrary pinned infrastructure without pulling candidates", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "security-images-"));
  const compose = join(directory, "compose.yaml");
  const image = `example/runtime:1@sha256:${"a".repeat(64)}`;
  writeFileSync(compose, `services:\n  runtime:\n    image: '${image}'\n  app:\n    image: \${COURTSIDE_SECURITY_IMAGE:?required}\n  seeder:\n    image: \${COURTSIDE_SECURITY_FIXTURES_IMAGE:?required}\n`);
  // when / then
  assert.ok(assessmentImages("safe", { compose }).includes(image));
});

test("given infrastructure sharing an inactive scanner image, when resolving safe inventory, then retain infrastructure and omit only assessment-profile scanners", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "security-images-"));
  const compose = join(directory, "compose.yaml");
  const image = "grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34";
  writeFileSync(compose, `services:\n  runtime:\n    image: "${image}"\n  scanner:\n    profiles: [assessment]\n    image: "${image}"\n`);
  // when / then
  assert.ok(assessmentImages("safe", { compose }).includes(image));
  writeFileSync(compose, `services:\n  scanner:\n    profiles: [assessment]\n    image: "${image}"\n`);
  assert.ok(!assessmentImages("safe", { compose }).includes(image));
  assert.ok(assessmentImages("destructive", { compose }).includes(image));
});

for (const image of ["axllent/mailpit:v1.31", "example/runtime:latest", "${UNTRUSTED_IMAGE}", "${COURTSIDE_SECURITY_IMAGE:-foreign:latest}"]) {
  test(`given unsupported runtime image ${image}, when resolving inventory, then fail closed`, () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "security-images-"));
    const compose = join(directory, "compose.yaml");
    writeFileSync(compose, `services:\n  runtime:\n    image: '${image}'\n`);
    // when / then
    assert.throws(() => assessmentImages("safe", { compose }), /immutable sha256 digest|candidate image/);
  });
}

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
  writeFileSync(compose, "services:\n  database:\n    image: postgres:18-alpine\n");

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
