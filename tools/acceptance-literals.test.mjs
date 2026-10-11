import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

test("when the acceptance directory is looked up, then it exists", () => {
  // when / then
  assert.ok(existsSync(new URL("../acceptance/package.json", import.meta.url)));
});
