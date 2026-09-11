import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const api = yaml.load(readFileSync(new URL("../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));
const inventory = JSON.parse(
  readFileSync(new URL("../security/data-protection-inventory.json", import.meta.url), "utf8"));

const METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"];
const CARRIES_A_PERSON = new Set(["personal", "secret"]);

function resolved(parameter) {
  const name = parameter.$ref?.split("/").pop();
  return name ? api.components.parameters[name] : parameter;
}

function declaredParameters() {
  const found = new Map();
  const record = (parameter, operation) => {
    const declaration = resolved(parameter);
    if (!declaration?.in) return;
    const key = `${declaration.in}:${declaration.name}`;
    if (!found.has(key)) found.set(key, { ...declaration, operations: [] });
    found.get(key).operations.push(operation);
  };
  for (const [path, item] of Object.entries(api.paths)) {
    (item.parameters ?? []).forEach((parameter) => record(parameter, path));
    for (const method of METHODS) {
      (item[method]?.parameters ?? []).forEach((parameter) => record(parameter, `${method.toUpperCase()} ${path}`));
    }
  }
  return found;
}

function schemaOf(declaration) {
  const reference = declaration.schema?.$ref?.split("/").pop();
  return reference ? api.components.schemas[reference] : declaration.schema ?? {};
}

const parameters = declaredParameters();
const classified = new Map(inventory.parameters.map((entry) => [`${entry.in}:${entry.name}`, entry]));

test("given the parameters the contract declares, when the inventory is read, then it classifies every one",
  () => {
    // given
    assert.ok(parameters.size > 20, `the contract declares only ${parameters.size} parameters`);

    // when / then
    for (const [key, declaration] of parameters) {
      assert.ok(classified.has(key),
        `${key} is declared by ${declaration.operations[0]} and the inventory classifies no such`
        + " parameter, so a value nobody assessed reaches a request");
    }
    for (const key of classified.keys()) {
      assert.ok(parameters.has(key),
        `the inventory classifies ${key} and the contract declares no such parameter any more`);
    }
  });

test("given a value that names or authenticates a person, when it is classified, then no URL carries it",
  () => {
    // given
    const carried = [...classified.values()]
      .filter((entry) => entry.in !== "header" && CARRIES_A_PERSON.has(entry.class));

    // when / then
    assert.ok(carried.length === 0,
      `${carried.map((entry) => `${entry.in}:${entry.name}`).join(", ")} travels in a URL and is`
      + " classified as a value that names or authenticates a person, so a browser, proxy or"
      + " operator record keeps it outside the protections that cover a response body");
  });

// A name arrives as prose, so the shape that admits prose is the one a URL must not declare —
// a pinned format, an enumeration or an anchored pattern all bound what the value can be.
test("given a URL parameter, when its schema is read, then it does not admit unconstrained text",
  () => {
    // when / then
    for (const [key, declaration] of parameters) {
      if (declaration.in !== "path" && declaration.in !== "query") continue;
      const schema = schemaOf(declaration);
      if (schema.type !== "string") continue;
      const pinned = Boolean(schema.format || schema.enum || schema.pattern);
      assert.ok(pinned,
        `${key} is a string in a ${declaration.in} with no format, enum or pattern, so ${declaration.operations[0]}`
        + " accepts free text in a URL — the shape a person's name arrives in");
    }
  });
