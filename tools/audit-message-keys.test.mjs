import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { localeKeys } from "./i18n-bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const eventTypes = () => readFileSync(join(root, "src/test/resources/domain-event-payload.properties"), "utf8")
  .split("\n")
  .filter((line) => line.trim() && !line.trim().startsWith("#"))
  .map((line) => line.slice(0, line.indexOf("=")).trim());

test("given every audited event type, when checking each locale of the web client bundle, then it carries that event's message", () => {
  // given
  const { de, en } = localeKeys();
  const types = eventTypes();

  // when
  const missingDe = types.filter((type) => !de.has(`audit.event.${type}`));
  const missingEn = types.filter((type) => !en.has(`audit.event.${type}`));

  // then
  assert.deepEqual(missingDe, [], `de is missing a message for these event types, add "audit.event.<type>" to the de block of frontend/src/i18n.ts: ${missingDe.join(", ")}`);
  assert.deepEqual(missingEn, [], `en is missing a message for these event types, add "audit.event.<type>" to the en block of frontend/src/i18n.ts: ${missingEn.join(", ")}`);
});
