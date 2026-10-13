import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("given every booking-module event the server audits, when the change log names its subject, then the web client says what kind of subject it is", () => {
  // given
  const recorded = readFileSync(join(root, "src/test/resources/domain-event-payload.properties"), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => line.slice(0, line.indexOf("=")).trim())
    .filter((type) => type.startsWith("booking."));
  const source = readFileSync(join(root, "frontend/src/audit/auditText.ts"), "utf8");
  const map = source.slice(source.indexOf("BOOKING_MODULE_SUBJECTS"), source.indexOf("};", source.indexOf("BOOKING_MODULE_SUBJECTS")));
  const named = new Set([...map.matchAll(/"(booking\.[^"]+)":/g)].map((match) => match[1]));

  // when
  const unnamed = recorded.filter((type) => !named.has(type));

  // then
  assert.ok(recorded.length > 0, "the server's event inventory must list booking-module events");
  assert.deepEqual(unnamed, [], `add these event types to BOOKING_MODULE_SUBJECTS in frontend/src/audit/auditText.ts, or the change log reports them as a missing booking: ${unnamed.join(", ")}`);
});
