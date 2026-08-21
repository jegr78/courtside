import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  buildOpenApiFuzzInventory,
  normalizeSchemathesisEvents,
  openApiFuzzPolicy,
  openApiFuzzPolicyDigest
} from "./security-openapi-fuzz.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const api = yaml.load(readFileSync(new URL(
  "../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));

test("given the current contract, when inventorying fuzz coverage, then every operation has an explicit mode", () => {
  // when
  const inventory = buildOpenApiFuzzInventory(api);

  // then
  assert.equal(inventory.length, 87);
  assert.equal(new Set(inventory.map(({ operationId }) => operationId)).size, 87);
  assert.equal(inventory.find(({ operationId }) => operationId === "listRoster").modes.join(","),
    "positive,negative");
  assert.deepEqual(inventory.find(({ operationId }) => operationId === "createCourt").modes, ["negative"]);
  assert.match(inventory.find(({ operationId }) => operationId === "createCourt").excludedModes.positive,
    /Valid mutations/);
  assert.deepEqual(inventory.find(({ operationId }) => operationId === "logOut").modes, []);
  assert.match(inventory.find(({ operationId }) => operationId === "logOut").excludedModes.all,
    /Session invalidation/);
  assert.match(openApiFuzzPolicy.image,
    /^schemathesis\/schemathesis:4\.25\.0@sha256:[a-f0-9]{64}$/);
  assert.ok(openApiFuzzPolicy.checks.includes("not_a_server_error"));
  assert.ok(!openApiFuzzPolicy.checks.includes("ignored_auth"));
  assert.match(openApiFuzzPolicyDigest(), /^sha256:[a-f0-9]{64}$/);
});

test("given minimized Schemathesis events, when normalizing them, then failures retain no raw traffic", () => {
  // given
  const inventory = [buildOpenApiFuzzInventory(api)
    .find(({ operationId }) => operationId === "listRoster")];
  const events = [
    { LoadingFinished: { statistic: { operations: { total: 1, selected: 1 } } } },
    { ScenarioFinished: {
      status: "failure",
      phase: "Fuzzing",
      recorder: {
        label: "GET /api/admin/roster",
        cases: { abc123: { value: { method: "GET", path: "/api/admin/roster", query: { cursor: "secret" },
          meta: { generation: { mode: "negative" } } } } },
        checks: { abc123: [{ name: "not_a_server_error", status: "failure" }] },
        interactions: { abc123: { request: { headers: { Cookie: "SESSION=secret" }, body: "secret" },
          response: { content: { $base64: "c2VjcmV0" } } } }
      }
    } }
  ];

  // when
  const normalized = normalizeSchemathesisEvents(events, inventory, "negative");

  // then
  assert.equal(normalized.operationResults[0].operationId, "listRoster");
  assert.equal(normalized.operationResults[0].outcome, "incomplete");
  assert.equal(normalized.counterexamples[0].check, "not-a-server-error");
  assert.equal(normalized.counterexamples[0].pathTemplate, "/api/admin/roster");
  assert.match(normalized.counterexamples[0].reproductionDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(normalized.undocumentedRoutes, []);
  assert.doesNotMatch(JSON.stringify(normalized), /SESSION|secret|c2VjcmV0/);
});

test("given missing or contradictory operation evidence, when normalizing it, then coverage fails closed", () => {
  // given
  const inventory = buildOpenApiFuzzInventory(api);

  // when / then
  assert.throws(() => normalizeSchemathesisEvents([], inventory, "positive"), /operation inventory/);
  assert.throws(() => normalizeSchemathesisEvents([
    { LoadingFinished: { statistic: { operations: { total: 86, selected: 1 } } } }
  ], inventory, "positive"), /contract operation count/);
});

test("given an unexpected observed operation, when normalizing it, then it becomes a review candidate", () => {
  // given
  const inventory = [buildOpenApiFuzzInventory(api)
    .find(({ operationId }) => operationId === "listRoster")];
  const events = [
    { LoadingFinished: { statistic: { operations: { total: 1, selected: 1 } } } },
    { ScenarioFinished: { status: "success", recorder: { label: "GET /api/internal/diagnostics",
      cases: {}, checks: {} } } },
    { ScenarioFinished: { status: "success", recorder: { label: "GET /api/admin/roster",
      cases: { one: { value: { meta: { generation: { mode: "positive" } } } } }, checks: {} } } }
  ];

  // when
  const normalized = normalizeSchemathesisEvents(events, inventory, "positive");

  // then
  assert.deepEqual(normalized.undocumentedRoutes,
    [{ method: "GET", pathTemplate: "/api/internal/diagnostics" }]);
});
