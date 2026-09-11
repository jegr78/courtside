import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { fixtureImagePlan, stageFixtureClasses, stagedFixtureClasses } from "./fixture-artifact.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

test("given an unpackaged checkout, when staging the fixture classes, then it says what is missing", () => {
  // given
  const workspace = mkdtempSync(join(tmpdir(), "courtside-fixtures-"));

  // when / then
  try {
    assert.throws(() => stageFixtureClasses(workspace),
      /Package the application before its fixture classes can be staged/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("given compiled fixture classes, when staging them, then they reach the image build context", () => {
  // given
  const workspace = mkdtempSync(join(tmpdir(), "courtside-fixtures-"));
  mkdirSync(join(workspace, "target", "fixtures-classes", "org", "courtside", "demo"), { recursive: true });
  writeFileSync(join(workspace, "target", "fixtures-classes", "org", "courtside", "demo", "Seeder.class"), "x");

  // when
  const staged = stageFixtureClasses(workspace);

  // then
  try {
    assert.equal(staged, stagedFixtureClasses(workspace));
    assert.equal(readFileSync(join(staged, "org", "courtside", "demo", "Seeder.class"), "utf8"), "x");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("given a base image, when planning the fixture image, then the staged classes are layered over it", () => {
  // given
  const dockerfile = readFileSync(join(root, "Dockerfile.fixtures"), "utf8");

  // when
  const plan = fixtureImagePlan("courtside:perf-local", "courtside:perf-base");

  // then
  assert.deepEqual(plan, {
    command: "docker",
    args: ["build", "-t", "courtside:perf-local", "--build-arg", "BASE_IMAGE=courtside:perf-base",
      "-f", "Dockerfile.fixtures", "."]
  });
  assert.match(dockerfile, /^ARG BASE_IMAGE$/m);
  assert.match(dockerfile, /^FROM \$\{BASE_IMAGE\}$/m);
  assert.match(dockerfile, /^COPY build\/fixtures\/classes\/ \.\/BOOT-INF\/classes\/$/m);
});
