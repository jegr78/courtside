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

// Administration is a layout route with its destinations nested inside it, so a child path is
// written relative to its parent and only the two together name the route the server must forward.
test("given nested routes, when reading them, then a child is read together with its parent", () => {
  // given
  const source = 'const a = <Routes><Route path="/admin" element={<Shell />}>'
    + '<Route index element={<X />} />'
    + '<Route path="facility" element={<Y />} />'
    + '<Route path="roster/:personId" element={<Z />} />'
    + '<Route path="*" element={<W />} />'
    + '</Route></Routes>;';

  // when / then
  assert.deepEqual(clientRoutes(source), ["/admin", "/admin/facility", "/admin/roster/:personId"]);
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
  function visit(node, parent) {
    // An element with children carries its path on the opening tag, which the walk reaches as a
    // sibling of those children — so the nesting is read here rather than left to the traversal.
    if (ts.isJsxElement(node)) {
      const route = named(routePath(node.openingElement), parent);
      if (route) routes.push(route);
      node.children.forEach((child) => visit(child, route ?? parent));
      return;
    }
    if (ts.isJsxSelfClosingElement(node)) {
      const route = named(routePath(node), parent);
      if (route) routes.push(route);
    }
    ts.forEachChild(node, (child) => visit(child, parent));
  }

  function named(path, parent) {
    return path && path !== "*" ? beneath(parent, path) : undefined;
  }
  visit(file, "");
  return [...new Set(routes)];
}

// A child path is relative to the route it sits in unless it names the root itself.
function beneath(parent, path) {
  return !parent || path.startsWith("/") ? path : `${parent}/${path}`;
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
