import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function prepare(fail = false) {
  const directory = mkdtempSync(join(tmpdir(), "courtside-image-setup-"));
  const calls = join(directory, "calls");
  writeFileSync(join(directory, "docker"), `#!/bin/sh
printf '%s\\n' "$*" >> "$COURTSIDE_IMAGE_TEST_CALLS"
if [ "$1" = image ]; then
  [ "$3" = cached ] && exit 0
  echo "Error response from daemon: No such image: $3" >&2
  exit 1
fi
echo "layer progress"
echo "registry progress" >&2
if [ "$COURTSIDE_IMAGE_TEST_FAIL" = true ]; then
  echo "manifest unavailable" >&2
  exit 1
fi
`);
  chmodSync(join(directory, "docker"), 0o755);
  const module = new URL("../frontend/e2e/image-preparation.ts", import.meta.url).href;
  const source = `import {prepareBrowserImages} from ${JSON.stringify(module)}; await prepareBrowserImages(["cached","browser","browser","mail"]);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, COURTSIDE_IMAGE_TEST_CALLS: calls,
      COURTSIDE_IMAGE_TEST_FAIL: String(fail) }, encoding: "utf8"
  });
  try { return { ...result, calls: readFileSync(calls, "utf8").trim().split("\n") }; }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("given Docker has cached and missing images, when setup runs its real command boundary, then progress is visible and missing images pull once", () => {
  // given
  const fail = false;

  // when
  const result = prepare(fail);

  // then
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ["image inspect cached", "image inspect browser", "pull browser", "image inspect mail", "pull mail"]);
  assert.match(result.stdout, /layer progress/);
  assert.match(result.stderr, /Pulling browser[\s\S]*registry progress/);
});

test("given Docker rejects a pull, when setup runs its real command boundary, then the exact image and registry error stop later images", () => {
  // given
  const fail = true;

  // when
  const result = prepare(fail);

  // then
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not pull browser: registry progress\nmanifest unavailable/);
  assert.deepEqual(result.calls, ["image inspect cached", "image inspect browser", "pull browser"]);
});
