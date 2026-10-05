import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

import { buildOperationAuthorizationMatrix } from "./security-authorization.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const api = yaml.load(readFileSync(new URL("../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));

const UNDECLARED_ON_PURPOSE = new Map([
  ["/api/sessio%6E", "a percent-encoded spelling of /api/session, which the target must route and"
    + " rate-limit identically — the contract declares only the canonical form"],
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

const METHOD_BEFORE = new RegExp("(?:method:\\s*\"([A-Za-z]+)\"|http\\.(get|post|put|del|patch|head|options)\\("
  + "|\"(GET|POST|PUT|DELETE|PATCH)\",\\s*)(?:[^/]|/(?!api/))*$");

const PREFIX_PREDICATES = new Map([
  ["/api/admin", "decides which operations the matrix expects only an administrator to reach"]
]);

const NO_METHOD_BESIDE_IT = new Map([
  ["/api/account-recovery/password", "an expectation predicate in operationExpectations"],
  ["/api/account-recovery/password/redemption", "an expectation predicate in operationExpectations"],
  ["/api/account-recovery/usernames", "an expectation predicate in operationExpectations"],
  ["/api/account/initial-password", "an expectation predicate in operationExpectations"],
  ["/api/admin/audit", "a fuzz input case whose method its helper carries"],
  ["/api/admin/courts", "a fuzz input case whose method its helper carries"],
  ["/api/bookings", "a fuzz input case whose method its helper carries"],
  ["/api/my/bookings", "a scanner rule in YAML, whose method the rule declares beside it"],
  ["/api/openapi.yaml", "the mounted contract's own path, read rather than requested"],
  ["/api/public/booking-grid", "a bounded read whose helper carries the method"],
  ["/api/sessio%6E", "a percent-encoded spelling of /api/session"],
  ["/api/session", "an expectation predicate, and a scanner rule in YAML"],
  ["/api/session/logout", "an expectation predicate in operationExpectations"],
  ["/api/session/logout$", "a regular expression anchor in a scanner rule"],
  ["/api/source", "a readiness probe issued with an explicit curl argument list"]
]);

const EXTERNAL_OPERATIONS = new Set([
  "tools/security-mail-observation.mjs http://mail:8025/api/v1/messages",
  "tools/security-mail-observation.mjs http://mail:8025/api/v1/message/{id}/raw"
]);

function scannedPaths(sources = runtimeSources().map((file) =>
  [file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")])) {
  const paths = [];
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/\/api\/[A-Za-z0-9$\\{}._%/-]*/g)) {
      const path = match[0].replace(/\$\{[^}]*\}/g, "{id}").replace(/\/+$/, "");
      const preceding = source.slice(Math.max(0, match.index - 160), match.index);
      const origin = /(?:^|[\s"'`])([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`/]+)$/.exec(preceding)?.[1];
      paths.push({ file, path, preceding, externalKey: `${file} ${origin ?? ""}${path}` });
    }
  }
  return paths;
}

function staleExternalDeclarations(sources) {
  const observed = new Set(scannedPaths(sources).map(({ externalKey }) => externalKey));
  return [...EXTERNAL_OPERATIONS].filter((key) => !observed.has(key));
}

function namedPaths(sources) {
  const named = new Map();
  for (const { file, path, preceding, externalKey } of scannedPaths(sources)) {
    if (EXTERNAL_OPERATIONS.has(externalKey)) continue;
    const verb = METHOD_BEFORE.exec(preceding);
    const method = verb === null ? null
      : (verb[1] ?? verb[3] ?? (verb[2] === "del" ? "delete" : verb[2])).toUpperCase();
    const key = method ? `${method} ${path}` : path;
    if (!named.has(key)) named.set(key, { path, method, files: new Set() });
    named.get(key).files.add(file);
  }
  return named;
}

function declaredPaths() {
  return Object.keys(api.paths)
    .map((path) => ({
      path,
      templated: path.includes("{"),
      matches: new RegExp(`^${path.split(/(\{[^}]*\})/)
        .map((part) => (part.startsWith("{") ? "[^/]+" : part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("")}$`)
    }))
    .toSorted((left, right) => Number(left.templated) - Number(right.templated));
}

test("given every operation the assessment runtime names, when it is read against the contract, "
  + "then each one is declared with that method, explicitly external or an intentional contract exception", () => {
  // given
  const declared = declaredPaths();

  // when
  const unknown = [...namedPaths().values()]
    .filter(({ path }) => !UNDECLARED_ON_PURPOSE.has(path))
    .filter(({ path }) => !PREFIX_PREDICATES.has(path))
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

test("given the prefix the matrix reads an admin-only expectation from, "
  + "when the contract is built into a matrix, then every admin-only operation still lies under it", () => {
  // given
  const matrix = buildOperationAuthorizationMatrix(api);
  const adminOnly = matrix.filter(({ expectations }) =>
    expectations.ADMIN === "allow" && expectations.MEMBER === "deny-forbidden");

  // when / then
  assert.ok(adminOnly.length > 0,
    "a contract declaring no admin-only operation makes the prefix predicate unfalsifiable");
  assert.deepEqual(adminOnly.filter(({ path }) => !path.startsWith("/api/admin")).map(({ path }) => path),
    [],
    "an operation the matrix expects only an administrator to reach, which does not lie under the"
      + " prefix the predicate tests, is one the predicate stopped deciding. It does not fail: it"
      + " falls through to expecting every role to be allowed, and a server that does not enforce"
      + " the boundary then reads as passed.");
});

test("given a listed exception, when the runtime stops naming it, then the list stops carrying it", () => {
  // when / then
  const named = namedPaths();
  const stale = [...UNDECLARED_ON_PURPOSE.keys()].filter((path) => !named.has(path));
  assert.deepEqual(stale, [],
    "an exception nobody names is a reason that outlived its probe");
});

test("given trusted Mailpit URLs, when their source and origin match, then exclude only those external operations", () => {
  // given
  const source = 'http://mail:8025/api/v1/messages http://mail:8025/api/v1/message/${message.id}/raw';
  // when / then
  assert.deepEqual([...namedPaths([["tools/security-mail-observation.mjs", source]]).keys()], []);
  for (const [file, text] of [
    ["tools/security-other.mjs", source],
    ["tools/security-mail-observation.mjs", source.replaceAll("mail:8025", "foreign:8025")],
    ["tools/security-mail-observation.mjs", source.replaceAll("http://", "https://")],
    ["tools/security-mail-observation.mjs", source.replaceAll("http://mail:8025", "")]
  ]) {
    assert.equal(namedPaths([[file, text]]).size, 2);
  }
  assert.deepEqual([...namedPaths([["tools/security-mail-observation.mjs", "http://mail:8025/api/v1/unknown"]]).keys()],
    ["/api/v1/unknown"]);
  assert.equal(namedPaths([
    ["tools/security-mail-observation.mjs", source], ["tools/security-other.mjs", source]
  ]).size, 2);
});

test("given an external declaration, when its runtime URL disappears, then detect its stale source binding", () => {
  // given
  const sources = [["tools/security-mail-observation.mjs", "http://mail:8025/api/v1/messages"]];
  // when / then
  assert.deepEqual(staleExternalDeclarations(sources), [
    "tools/security-mail-observation.mjs http://mail:8025/api/v1/message/{id}/raw"
  ]);
  assert.deepEqual(staleExternalDeclarations(), []);
});
