import assert from "node:assert/strict";
import { test } from "node:test";

import { apiDocumentPath } from "./security-api-document.mjs";

test("given no override, when resolving the contract, then the repository's own document is assessed", () => {
  // when
  const resolved = apiDocumentPath({});

  // then
  assert.match(resolved, /\/src\/main\/resources\/api\/openapi\.yaml$/);
  assert.ok(resolved.startsWith("/"), "the scanner mounts an absolute path");
});

test("given a protected base's document, when resolving the contract, then that one is assessed", () => {
  // given
  const base = "/runner/temp/courtside-security-base/src/main/resources/api/openapi.yaml";

  // when / then
  assert.equal(apiDocumentPath({ COURTSIDE_SECURITY_API_DOCUMENT: base }), base);
});
