import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// A placeholder the view derives from a field rather than rendering it directly.
const DERIVED_PLACEHOLDERS = { weekday: "dayOfWeek" };

// Every payload field whose value can be null, so a message interpolating it is a decision, not an accident.
const NULLABLE_FIELDS = {
  "card.participantCard.added": ["capacity"],
  "card.participantCard.changed": ["capacity"],
  "roster.membership.written": ["startedOn", "endedOn"]
};

const eventFields = () => new Map(
  readFileSync(join(root, "src/test/resources/domain-event-payload.properties"), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      const type = line.slice(0, separator).trim();
      const fields = line.slice(separator + 1).split(",").map((field) => field.trim()).filter(Boolean);
      return [type, new Set(fields)];
    })
);

const auditMessages = (source) => {
  const blocks = source.match(
    /^ {2}de: \{ translation: \{\n([\s\S]*?)\n {2}\} \},\n {2}en: \{ translation: \{\n([\s\S]*?)\n {2}\} \}\n\};/m
  );
  assert.ok(blocks, "could not locate the de and en translation blocks in i18n.ts");
  const messagesOf = (block) => new Map(
    [...block.matchAll(/^\s*"(audit\.event\.[^"]+)":\s*"([^"]*)"/gm)].map((match) => [match[1], match[2]])
  );
  return { de: messagesOf(blocks[1]), en: messagesOf(blocks[2]) };
};

test("given every audit message, when checking its placeholders, then each names a field the event carries or a known derived value", () => {
  // given
  const source = readFileSync(join(root, "frontend/src/i18n.ts"), "utf8");
  const { de, en } = auditMessages(source);
  const fields = eventFields();

  // when
  const problems = [];
  for (const [locale, messages] of [["de", de], ["en", en]]) {
    for (const [key, text] of messages) {
      const eventType = key.slice("audit.event.".length).replace(/_[^.]+$/, "");
      const known = fields.get(eventType) ?? new Set();
      for (const [, placeholder] of text.matchAll(/\{\{(\w+)\}\}/g)) {
        const derivedFrom = DERIVED_PLACEHOLDERS[placeholder];
        if (known.has(placeholder) || (derivedFrom && known.has(derivedFrom))) continue;
        problems.push(`${locale} ${key}: {{${placeholder}}} is not a field of ${eventType}`);
      }
    }
  }

  // then
  assert.deepEqual(problems, []);
});

test("given a message that interpolates a nullable field, when checking its variants, then a null-safe one exists", () => {
  // given
  const source = readFileSync(join(root, "frontend/src/i18n.ts"), "utf8");
  const { de, en } = auditMessages(source);

  // when
  const problems = [];
  for (const [locale, messages] of [["de", de], ["en", en]]) {
    for (const [eventType, nullableFields] of Object.entries(NULLABLE_FIELDS)) {
      const baseKey = `audit.event.${eventType}`;
      const baseText = messages.get(baseKey);
      if (baseText === undefined) continue;
      for (const field of nullableFields) {
        if (!baseText.includes(`{{${field}}}`)) continue;
        const hasNullSafeVariant = [...messages.entries()].some(([key, text]) =>
          key !== baseKey && key.startsWith(`${baseKey}_`) && !text.includes(`{{${field}}}`));
        if (!hasNullSafeVariant) {
          problems.push(`${locale} ${baseKey}: {{${field}}} is nullable and has no null-safe variant`);
        }
      }
    }
  }

  // then
  assert.deepEqual(problems, []);
});
