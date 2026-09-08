import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function source(path) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const base = source("../deploy/compose.yaml");
const identities = source("../deploy/compose.database-identities.yaml");
const documentation = source("../deploy/README.md");

function service(name, next) {
  const start = identities.indexOf(`  ${name}:`);
  const end = next ? identities.indexOf(`  ${next}:`, start + 1) : identities.length;
  assert.notEqual(start, -1, `${name} is absent from the identity overlay`);
  return identities.slice(start, end);
}

test("given the standard deployment, when no identity overlay is selected, then its shared path remains", () => {
  // when / then
  assert.match(base, /SPRING_DATASOURCE_USERNAME: courtside/);
  assert.match(base, /SPRING_DATASOURCE_PASSWORD: \$\{POSTGRES_PASSWORD:-\}/);
  assert.doesNotMatch(base, /COURTSIDE_DB_IDENTITY_MODE: separate/);
});

test("given the identity overlay, when process inputs are inspected, then each receives only its credential", () => {
  // given
  const setup = service("database-setup", "database-migrate");
  const migration = service("database-migrate", "app");
  const runtime = service("app");

  // when / then
  for (const credential of ["OWNER", "MIGRATION", "RUNTIME"]) {
    assert.match(setup, new RegExp(`COURTSIDE_DB_${credential}_PASSWORD_FILE`));
  }
  assert.match(migration, /COURTSIDE_DB_MIGRATION_PASSWORD_FILE/);
  assert.doesNotMatch(migration, /COURTSIDE_DB_(?:OWNER|RUNTIME)_PASSWORD_FILE/);
  assert.match(runtime, /COURTSIDE_DB_RUNTIME_PASSWORD_FILE/);
  assert.doesNotMatch(runtime, /COURTSIDE_DB_(?:OWNER|MIGRATION)_PASSWORD_FILE/);
  assert.doesNotMatch(identities, /PASSWORD:\s*\$\{COURTSIDE_DB_/,
    "private values belong in mounted files, not Compose environment values");
});

test("given separate identities, when startup is ordered, then migration completes before runtime", () => {
  // given
  const setup = service("database-setup", "database-migrate");
  const migration = service("database-migrate", "app");
  const runtime = service("app");

  // when / then
  assert.match(setup, /db:[\s\S]*condition: service_healthy/);
  assert.match(migration, /database-setup:[\s\S]*condition: service_completed_successfully/);
  assert.match(runtime, /database-migrate:[\s\S]*condition: service_completed_successfully/);
  assert.match(runtime, /SPRING_DATASOURCE_USERNAME: !reset null/);
  assert.match(runtime, /SPRING_DATASOURCE_PASSWORD: !reset null/);
});

test("given optional TLS and bounded identities, when combined, then setup and migration share its policy", () => {
  // when / then
  for (const process of [service("database-setup", "database-migrate"), service("database-migrate", "app")]) {
    assert.match(process, /COURTSIDE_DB_TLS_MODE/);
    assert.match(process, /COURTSIDE_DB_TLS_ROOT_CERTIFICATE/);
    assert.match(process, /database-tls:ro/);
  }
  assert.match(documentation, /database TLS and identity overlays are independent/);
});

test("given a restored archive, when credentials are recovered, then documentation keeps lifecycle ownership outside Courtside", () => {
  // when / then
  assert.match(documentation, /backup contains schema and\s+data, not PostgreSQL roles or their passwords/);
  assert.match(documentation, /operator owns creation and storage of the files, rotation timing, revocation/);
  assert.match(documentation, /None of those\s+systems, a second approver, or this optional overlay is required for normal operation/);
});

test("given file-backed credentials on Linux, when permissions are prepared, then container identities are documented", () => {
  // when / then
  assert.match(documentation, /numeric UID `10001`/);
  assert.match(documentation, /file\s+owner, group, or ACL/);
});
