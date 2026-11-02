import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const head = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");

test("given the page head, when a browser installs the app, then it reads the standard capable tag beside Apple's", () => {
  // then
  assert.match(head, /<meta name="mobile-web-app-capable" content="yes" \/>/, "Chrome deprecates the Apple-only tag");
  assert.match(head, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/, "older iOS still reads the Apple tag");
});
