import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const eventTypes = () => readFileSync(join(root, "src/test/resources/domain-event-payload.properties"), "utf8")
  .split("\n")
  .filter((line) => line.trim() && !line.trim().startsWith("#"))
  .map((line) => line.slice(0, line.indexOf("=")).trim());

const keysOf = (block) => new Set([...block.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]));

const localeKeys = () => {
  const source = readFileSync(join(root, "frontend/src/i18n.ts"), "utf8");
  const blocks = source.match(
    /^ {2}de: \{ translation: \{\n([\s\S]*?)\n {2}\} \},\n {2}en: \{ translation: \{\n([\s\S]*?)\n {2}\} \}\n\};/m
  );
  assert.ok(blocks, "could not locate the de and en translation blocks in i18n.ts");
  return { de: keysOf(blocks[1]), en: keysOf(blocks[2]) };
};

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
