import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { apiDocumentPath } from "./security-api-document.mjs";

function documentFile() {
  const path = join(mkdtempSync(join(tmpdir(), "courtside-contract-")), "openapi.yaml");
  writeFileSync(path, "openapi: 3.1.0\n");
  return path;
}

test("given no override, when resolving the contract, then the repository's own document is assessed", () => {
  // when
  const resolved = apiDocumentPath({});

  // then
  assert.match(resolved, /\/src\/main\/resources\/api\/openapi\.yaml$/);
  assert.ok(resolved.startsWith("/"), "the scanner mounts an absolute path");
});

test("given a protected base's document, when resolving the contract, then that one is assessed", () => {
  // given
  const base = documentFile();

  // when / then
  assert.equal(apiDocumentPath({ COURTSIDE_SECURITY_API_DOCUMENT: base }), base);
});

// Compose turns a bind source that does not exist into a directory and starts the container anyway,
// so the run would fail at its digest check and blame the contract rather than the path it was given.
test("given a path nothing lies at, when resolving the contract, then it is refused where it was given", () => {
  // when / then
  assert.throws(() => apiDocumentPath({ COURTSIDE_SECURITY_API_DOCUMENT: "/nothing/here/openapi.yaml" }),
    /must name an existing absolute path/);
});

test("given a relative override, when resolving the contract, then it is refused", () => {
  // when / then
  assert.throws(() => apiDocumentPath({ COURTSIDE_SECURITY_API_DOCUMENT: "../src/main/resources/api/openapi.yaml" }),
    /must name an existing absolute path/);
});

test("given an empty override, when resolving the contract, then the checkout still answers", () => {
  // when / then
  assert.equal(apiDocumentPath({ COURTSIDE_SECURITY_API_DOCUMENT: "" }), apiDocumentPath({}));
});
