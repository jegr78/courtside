import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const api = yaml.load(readFileSync(new URL("../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));

// A path the assessment names that the contract does not declare. Each one is a probe of something
// the contract is supposed to refuse, so its absence from the document is the point.
const UNDECLARED_ON_PURPOSE = new Map([
  ["/api/admin", "the target half of a traversal probe, never requested as a path of its own"],
  ["/api/sessio%6E", "an encoded spelling of a real path, which the request target must refuse"],
  ["/api/session/logout$", "a regular expression anchor in a scanner rule, not a request path"]
]);

function runtimeSources() {
  return [
    ...readdirSync(new URL("../tools", import.meta.url))
      .filter((name) => name.startsWith("security-") && name.endsWith(".mjs") && !name.includes(".test."))
      .map((name) => `tools/${name}`),
    ...readdirSync(new URL("../security", import.meta.url))
      .filter((name) => name.endsWith(".js"))
      .map((name) => `security/${name}`)
  ].toSorted();
}

// A probe carries its method beside the path: an object literal with `method:`, or a k6 call such
// as `http.post(`. A path with no method beside it is a classifier rather than a request, and the
// third test below keeps that set from growing unnoticed.
const METHOD_BEFORE = /(?:method:\s*"([A-Za-z]+)"|http\.(get|post|put|del|patch|head|options)\()(?:[^/]|\/(?!api\/))*$/;

function namedPaths() {
  const named = new Map();
  for (const file of runtimeSources()) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const match of source.matchAll(/\/api\/[A-Za-z0-9$\\{}._%/-]*/g)) {
      const path = match[0].replace(/\$\{[^}]*\}/g, "{id}").replace(/\/+$/, "");
      const preceding = source.slice(Math.max(0, match.index - 160), match.index);
      const verb = METHOD_BEFORE.exec(preceding);
      const method = verb === null ? null
        : (verb[1] ?? (verb[2] === "del" ? "delete" : verb[2])).toUpperCase();
      const key = method ? `${method} ${path}` : path;
      if (!named.has(key)) named.set(key, { path, method, files: new Set() });
      named.get(key).files.add(file);
    }
  }
  return named;
}

function declaredPaths() {
  return Object.keys(api.paths).map((path) => ({
    path,
    matches: new RegExp(`^${path.replaceAll(/\{[^}]*\}/g, "[^/]+")}$`)
  }));
}

test("given every operation the assessment runtime names, when it is read against the contract, "
  + "then each one is declared with that method or is named as something the contract must refuse", () => {
  // given
  const declared = declaredPaths();

  // when
  const unknown = [...namedPaths().values()]
    .filter(({ path }) => !UNDECLARED_ON_PURPOSE.has(path))
    .filter(({ path, method }) => {
      const item = declared.find(({ matches }) => matches.test(path));
      if (!item) return true;
      return method !== null && api.paths[item.path][method.toLowerCase()] === undefined;
    })
    .map(({ path, method, files }) => `${method ?? "any"} ${path} (${[...files].toSorted().join(", ")})`);

  // then
  assert.deepEqual(unknown.toSorted(), [],
    "the assessment names an operation the contract does not declare. A probe answered 404 or 405 "
      + "stops exercising what it was written for, and a predicate that classifies a path stops "
      + "matching without failing, so the run reports a boundary it never measured.");
});

test("given a path the assessment expects the contract to refuse, when it is read, "
  + "then the contract still refuses it", () => {
  // when / then
  const declared = declaredPaths();
  const contradicted = [...UNDECLARED_ON_PURPOSE.keys()]
    .filter((path) => declared.some(({ matches }) => matches.test(path)));
  assert.deepEqual(contradicted, [],
    "a path listed as one the contract must refuse is now declared by it, so the probe written "
      + "against its absence proves nothing");
});

test("given a listed exception, when the runtime stops naming it, then the list stops carrying it", () => {
  // when / then
  const named = namedPaths();
  const stale = [...UNDECLARED_ON_PURPOSE.keys()].filter((path) => !named.has(path));
  assert.deepEqual(stale, [],
    "an exception nobody names is a reason that outlived its probe");
});
