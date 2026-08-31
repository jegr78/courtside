import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateNodeToolchain, writeGitHubOutputs } from "./node-toolchain.mjs";

test("given exact versions, when validating the toolchain, then both versions are retained", () => {
  // given
  const toolchain = { node: "26.5.1", npm: "11.17.0" };

  // when
  const result = validateNodeToolchain(toolchain);

  // then
  assert.deepEqual(result, toolchain);
});

for (const candidate of [
  { node: "26.5.1", npm: "11.17.0", command: "ignored" },
  { node: "26.5.1\nforged=true", npm: "11.17.0" },
  { node: "26.5.1", npm: "11.17.0; touch marker" }
]) {
  test("given an unsafe toolchain value, when validating, then it fails closed", () => {
    // when / then
    assert.throws(() => validateNodeToolchain(candidate), /contract is invalid/i);
  });
}

test("given a valid toolchain, when writing GitHub outputs, then only validated values are emitted", () => {
  // given
  const output = join(mkdtempSync(join(tmpdir(), "courtside-toolchain-")), "output");

  // when
  writeGitHubOutputs({ node: "26.5.1", npm: "11.17.0" }, output);

  // then
  assert.equal(readFileSync(output, "utf8"), "node=26.5.1\nnpm=11.17.0\n");
});
