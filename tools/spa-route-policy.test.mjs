import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repository = fileURLToPath(new URL("..", import.meta.url));
const frontendRequire = createRequire(new URL("../frontend/package.json", import.meta.url));
const ts = frontendRequire("typescript");

const ROUTER = `${repository}frontend/src/App.tsx`;
const VIEW_CONTROLLERS = `${repository}src/main/java/org/courtside/shared/web/SpaConfiguration.java`;
const SHELL_ACCESS = `${repository}src/main/java/org/courtside/identity/internal/SecurityConfiguration.java`;

// React names a path parameter :personId and Spring names it {personId}, so the two sides say the
// same route in different words and only comparing them in one of them can tell.
const asServerPath = (route) => route.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

test("given a route with a parameter, when comparing it with the server, then both spellings mean one route", () => {
  // given
  const source = 'const a = <Routes><Route path="/admin/roster/:personId" element={<X />} /></Routes>;';

  // when / then
  assert.deepEqual(clientRoutes(source).map(asServerPath), ["/admin/roster/{personId}"]);
});

test("given the router, when reading its routes, then the wildcard is not one of them", () => {
  // given
  const source = 'const a = <Routes><Route path="/courts" element={<X />} />'
    + '<Route path="*" element={<Y />} /></Routes>;';

  // when / then
  assert.deepEqual(clientRoutes(source), ["/courts"]);
});

test("given a client route, when the server serves the shell, then it forwards to the application", () => {
  // when / then
  assert.deepEqual(
    clientRoutes(readFileSync(ROUTER, "utf8")).map(asServerPath).toSorted(),
    forwardedRoutes(readFileSync(VIEW_CONTROLLERS, "utf8")).toSorted()
  );
});

test("given a client route, when it is opened before signing in, then the shell is reachable", () => {
  // given
  const permitted = new Set(permittedPaths(readFileSync(SHELL_ACCESS, "utf8")));

  // when
  const unreachable = clientRoutes(readFileSync(ROUTER, "utf8"))
    .map(asServerPath)
    .filter((route) => !permitted.has(route));

  // then
  assert.deepEqual(unreachable, []);
});

function clientRoutes(source) {
  const file = ts.createSourceFile("router.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const routes = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const path = routePath(node);
      if (path && path !== "*") routes.push(path);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...new Set(routes)];
}

function routePath(element) {
  if (element.tagName.getText(element.getSourceFile()) !== "Route") return undefined;
  const attribute = element.attributes.properties.find((candidate) =>
    ts.isJsxAttribute(candidate) && candidate.name.getText(element.getSourceFile()) === "path"
  );
  const value = attribute?.initializer;
  return value && ts.isStringLiteral(value) ? value.text : undefined;
}

function forwardedRoutes(source) {
  return [...source.matchAll(/addViewController\("([^"]+)"\)/g)].map((match) => match[1]);
}

function permittedPaths(source) {
  return [...source.matchAll(/\.requestMatchers\(([^;]*?)\)\s*\.permitAll\(\)/gs)]
    .flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((literal) => literal[1]));
}
