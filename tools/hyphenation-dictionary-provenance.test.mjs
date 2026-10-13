import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("given the vendored German hyphenation patterns, when they are hashed, then NOTICE states that hash", () => {
  // given
  const notice = readFileSync(join(root, "NOTICE"), "utf8");

  // when
  const actual = createHash("sha256").update(readFileSync(join(root, "frontend/e2e/hyphenation/hyph_de_DE.dic"))).digest("hex");

  // then
  assert.ok(notice.includes(actual), `NOTICE must state the SHA-256 of frontend/e2e/hyphenation/hyph_de_DE.dic, which is ${actual}`);
});
