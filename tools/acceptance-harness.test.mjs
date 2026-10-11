import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const json = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

test("given the acceptance package, when its browser dependencies are read, then they equal the frontend's pins", () => {
  // given
  const acceptance = json("acceptance/package.json");
  const frontend = json("frontend/package.json");
  // when
  const pins = ["@playwright/test", "@axe-core/playwright"].map((name) =>
    [acceptance.dependencies?.[name], frontend.devDependencies?.[name] ?? frontend.dependencies?.[name]]);
  // then
  for (const [own, theirs] of pins) assert.equal(own, theirs, "acceptance pins the frontend's exact version");
});
