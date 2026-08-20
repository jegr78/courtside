import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { localeKeys } from "./i18n-bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function availabilityChangedFlags() {
  return readFileSync(join(root, "src/test/resources/domain-event-payload.properties"), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const [type, fields] = line.split("=");
      return { type: type.trim(), flag: fields.trim().split(",").pop() };
    })
    .filter(({ type }) => type.endsWith(".availabilityChanged"));
}

function viewFlagByEventType() {
  const source = readFileSync(join(root, "frontend/src/views/AdminAuditView.tsx"), "utf8");
  const block = source.match(/enabledFlagByEventType: Record<string, string> = \{([\s\S]*?)\};/);
  assert.ok(block, "could not locate enabledFlagByEventType in AdminAuditView.tsx");
  return new Map([...block[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((match) => [match[1], match[2]]));
}

test("given every availabilityChanged event type, when checking each locale, then it carries active and inactive messages", () => {
  // given
  const { de, en } = localeKeys();
  const types = availabilityChangedFlags().map(({ type }) => type);

  // when
  const missing = (locale) => types.flatMap((type) =>
    ["active", "inactive"].filter((variant) => !locale.has(`audit.event.${type}_${variant}`))
      .map((variant) => `audit.event.${type}_${variant}`));

  // then
  assert.deepEqual(missing(de), [], "de is missing an _active/_inactive variant for an availabilityChanged type");
  assert.deepEqual(missing(en), [], "en is missing an _active/_inactive variant for an availabilityChanged type");
});

test("given every availabilityChanged event type, when checking its recorded flag field, then AdminAuditView resolves that exact field", () => {
  // given
  const flags = availabilityChangedFlags();
  const viewFlags = viewFlagByEventType();

  // when
  const unresolved = flags.filter(({ type, flag }) => {
    const resolved = viewFlags.get(type) ?? "active";
    return resolved !== flag;
  });

  // then
  assert.deepEqual(unresolved, [],
    "AdminAuditView.tsx's enabledFlagByEventType does not name the actual flag field for these types "
    + "(add \"<type>\": \"<field>\" or the type will silently render as inactive either way): "
    + unresolved.map(({ type, flag }) => `${type} (payload carries "${flag}")`).join(", "));
});
