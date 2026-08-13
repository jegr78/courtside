import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const frontend = fileURLToPath(new URL("../frontend", import.meta.url));
const frontendRequire = createRequire(new URL("../frontend/package.json", import.meta.url));
const ts = frontendRequire("typescript");
const forbiddenQuery = /\b(?:find|get|query)(?:All)?By(?:Text|LabelText|PlaceholderText|DisplayValue|Title|AltText)\s*\(/g;

test("given role queries, when their accessible name is rendered copy, then every query variant is forbidden", () => {
  // when / then
  for (const query of ["findByRole", "findAllByRole", "getByRole", "getAllByRole", "queryByRole", "queryAllByRole"]) {
    assert.equal(roleNameViolations(`screen.${query}("button", { name: "Save" })`).length, 1);
    assert.equal(roleNameViolations(`screen.${query}("button", { name: /Save/ })`).length, 1);
  }
  for (const source of [
    'screen.getByRole("button", { name: ("Save") })',
    'screen.getByRole(roleFor("button", fallback), { name: "Save" })',
    'screen.getByRole("button", { hidden: options({ strict: true }), name: "Save" })',
    'screen.getByRole("button", { name: String("Save") })'
  ]) {
    assert.equal(roleNameViolations(source).length, 1);
  }
  assert.deepEqual(roleNameViolations("screen.getByRole(role, { name: accessibleName })"), []);
  assert.deepEqual(roleNameViolations("screen.getByRole(role)"), []);
});

test("given UI tests, when selecting elements, then rendered copy is never the locator", () => {
  // given
  const testFiles = files(frontend).filter((path) => /\.(?:test|spec)\.(?:ts|tsx)$/.test(path));

  // when
  const violations = testFiles.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const queryOffsets = [...source.matchAll(new RegExp(forbiddenQuery.source, "g"))].map((match) => match.index);
    return [...queryOffsets, ...roleNameViolations(source)].map((offset) =>
      `${path.slice(frontend.length + 1)}:${source.slice(0, offset).split("\n").length}`
    );
  });

  // then
  assert.deepEqual(violations, []);
});

function roleNameViolations(source) {
  const file = ts.createSourceFile("selector-policy.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offsets = [];
  function visit(node) {
    if (ts.isCallExpression(node) && isRoleQuery(node.expression) && hasLiteralName(node.arguments[1])) {
      offsets.push(node.getStart(file));
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return offsets;
}

function isRoleQuery(expression) {
  const name = ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : ts.isIdentifier(expression) ? expression.text : "";
  return /^(?:find|get|query)(?:All)?ByRole$/.test(name);
}

function hasLiteralName(options) {
  const expression = options && ts.skipOuterExpressions(options);
  if (!expression || !ts.isObjectLiteralExpression(expression)) return false;
  const property = expression.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === "name"
  );
  return property ? containsRenderedCopy(property.initializer) : false;
}

function propertyName(name) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : "";
}

function containsRenderedCopy(value) {
  const expression = ts.skipOuterExpressions(value);
  if (ts.isStringLiteralLike(expression) || ts.isRegularExpressionLiteral(expression) || ts.isTemplateExpression(expression)) {
    return true;
  }
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
    return expression.arguments?.some(containsRenderedCopy) ?? false;
  }
  if (ts.isConditionalExpression(expression)) {
    return containsRenderedCopy(expression.whenTrue) || containsRenderedCopy(expression.whenFalse);
  }
  return ts.isBinaryExpression(expression)
    && (containsRenderedCopy(expression.left) || containsRenderedCopy(expression.right));
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !["node_modules", "dist", "test-results"].includes(entry.name))
    .flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(path) : [path];
  });
}
