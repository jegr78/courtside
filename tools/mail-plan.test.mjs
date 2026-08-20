import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function plan(name) {
  const path = fileURLToPath(new URL(`../deploy/mail/${name}.ndjson`, import.meta.url));
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${name}.ndjson line ${index + 1} is not JSON: ${error.message}`);
    }
  });
}

const planNames = readdirSync(fileURLToPath(new URL("../deploy/mail", import.meta.url)))
  .filter((entry) => entry.endsWith(".ndjson"))
  .map((entry) => entry.replace(/\.ndjson$/, ""));

const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.yaml", import.meta.url)), "utf8");

function walk(value, visit, path = []) {
  if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, visit, [...path, String(index)]));
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) walk(entry, visit, [...path, key]);
  } else visit(value, path);
}

test("given the shipped plans, when they are read, then every line is one JSON operation", () => {
  // given / when / then
  assert.ok(planNames.length > 0, "deploy/mail holds no plan");
  for (const name of planNames) {
    for (const operation of plan(name)) {
      assert.ok(["upsert", "update", "create", "destroy"].includes(operation["@type"]),
        `${name}: unexpected operation ${operation["@type"]}`);
      assert.ok(operation.object, `${name}: operation without an object type`);
    }
  }
});

test("given the shipped plans, when a secret appears, then it is a placeholder and not a value", () => {
  // given
  const secretish = /secret|password|privateKey/i;

  // when / then
  for (const name of planNames) {
    for (const operation of plan(name)) {
      walk(operation.value, (value, path) => {
        const field = path[path.length - 1] ?? "";
        if (!secretish.test(field) || value === null || value === "") return;
        assert.match(String(value), /^\{\{[a-z]+}}$/,
          `${name} carries a literal ${field} at ${path.join(".")} — plans are rendered from .env, `
          + "and a secret committed here is a secret every club would share");
      });
    }
  }
});

test("given the base plan, when compose publishes a port, then a listener stands behind it", () => {
  // given
  const listeners = plan("base")
    .filter((operation) => operation.object === "NetworkListener")
    .flatMap((operation) => Object.values(operation.value))
    .flatMap((listener) => Object.keys(listener.bind))
    .map((bind) => bind.replace(/^\[::]:/, ""));

  // when
  const mail = compose.slice(compose.indexOf("\n  mail:"), compose.indexOf("\n  mail-plan:"));
  const published = [...mail.matchAll(/^ {6}- "(?:127\.0\.0\.1:)?(?:\$\{[^}]+})?([0-9]+)?:([0-9]+)"$/gm)]
    .map((match) => match[2]);

  // then
  for (const port of published) {
    assert.ok(listeners.includes(port),
      `compose publishes ${port} but the plan starts no listener on it — an open door to nothing`);
  }
});

test("given the base plan, when it starts submission, then compose keeps that port off the host", () => {
  // given
  const submission = plan("base")
    .filter((operation) => operation.object === "NetworkListener")
    .flatMap((operation) => Object.values(operation.value))
    .find((listener) => listener.name === "submission");

  // when
  const mail = compose.slice(compose.indexOf("\n  mail:"), compose.indexOf("\n  mail-plan:"));

  // then
  assert.ok(submission, "the plan starts no submission listener, so nothing can hand mail in");
  assert.deepEqual(Object.keys(submission.bind), ["[::]:587"]);
  assert.doesNotMatch(mail, /:587"/,
    "submission is how the application hands mail in over the compose network; publishing it "
    + "puts an authenticating SMTP port on the host for no one who needs it");
});
