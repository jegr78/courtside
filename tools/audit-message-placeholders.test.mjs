import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// A placeholder the view derives from a field rather than rendering it directly.
const DERIVED_PLACEHOLDERS = { weekday: "dayOfWeek" };

const fieldsPerEventType = (inventory) => new Map(
  readFileSync(join(root, "src/test/resources", inventory), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      const type = line.slice(0, separator).trim();
      const fields = line.slice(separator + 1).split(",").map((field) => field.trim()).filter(Boolean);
      return [type, new Set(fields)];
    })
);

// The view returns one of these contexts for a null field; any other sibling key it cannot reach.
const nullSafeContexts = () => {
  const source = readFileSync(join(root, "frontend/src/views/AdminAuditView.tsx"), "utf8");
  const block = source.match(/const nullSafeContexts[^=]*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(block, "could not locate nullSafeContexts in AdminAuditView.tsx");
  const contexts = [...block[1].matchAll(
    /\{\s*eventType:\s*"([^"]+)",\s*field:\s*"([^"]+)",\s*context:\s*"([^"]+)"\s*\}/g
  )].map(([, eventType, field, context]) => ({ eventType, field, context }));
  assert.ok(contexts.length > 0, "nullSafeContexts in AdminAuditView.tsx lists no context");
  return contexts;
};

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
  const fields = fieldsPerEventType("domain-event-payload.properties");

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

test("given a message that interpolates a nullable field, when checking its variants, then the view reaches a null-safe one", () => {
  // given
  const source = readFileSync(join(root, "frontend/src/i18n.ts"), "utf8");
  const { de, en } = auditMessages(source);
  const nullableFields = fieldsPerEventType("domain-event-nullable-field.properties");
  const contexts = nullSafeContexts();

  // when
  const problems = [];
  for (const [locale, messages] of [["de", de], ["en", en]]) {
    for (const [eventType, fields] of nullableFields) {
      const baseKey = `audit.event.${eventType}`;
      const baseText = messages.get(baseKey);
      if (baseText === undefined) continue;
      for (const field of fields) {
        if (!baseText.includes(`{{${field}}}`)) continue;
        const reachable = contexts.find((entry) => entry.eventType === eventType && entry.field === field);
        if (!reachable) {
          problems.push(`${locale} ${baseKey}: {{${field}}} is nullable and the view returns no context for it`);
          continue;
        }
        const variant = messages.get(`${baseKey}_${reachable.context}`);
        if (variant === undefined) {
          problems.push(`${locale} ${baseKey}_${reachable.context}: the context the view returns has no message`);
        } else if (variant.includes(`{{${field}}}`)) {
          problems.push(`${locale} ${baseKey}_${reachable.context}: still interpolates the nullable {{${field}}}`);
        }
      }
    }
  }

  // then
  assert.deepEqual(problems, []);
});
