import assert from "node:assert/strict";
import test from "node:test";
import { collectPublishedReleaseTags, execute } from "./published-release-tags.mjs";

function response(status, body) {
  return { status, json: async () => body };
}

test("given paginated releases, when collecting published tags, then drafts stay excluded", async () => {
  // given
  const pages = [
    [{ tag_name: "v0.1.0", draft: false },
      ...Array.from({ length: 99 }, (_, index) => ({ tag_name: `draft-${index}`, draft: true }))],
    [{ tag_name: "v0.2.0-rc.1", draft: false }]
  ];
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url: String(url), options });
    return response(200, pages[requests.length - 1]);
  };

  // when
  const tags = await collectPublishedReleaseTags({
    repository: "example/courtside", token: "test-token", request
  });

  // then
  assert.deepEqual(tags, ["v0.1.0", "v0.2.0-rc.1"]);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/repos\/example\/courtside\/releases\?per_page=100&page=1$/);
  assert.match(requests[1].url, /page=2$/);
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-token");
});

test("given malformed release metadata, when collecting tags, then the command fails closed", async () => {
  // given
  const request = async () => response(200, { tag_name: "v0.1.0", draft: false });

  // when / then
  await assert.rejects(collectPublishedReleaseTags({
    repository: "example/courtside", token: "test-token", request
  }), /must be an array/);
});

test("given an API failure, when collecting tags, then the command reports the response", async () => {
  // given
  const request = async () => response(503, { message: "unavailable" });

  // when / then
  await assert.rejects(collectPublishedReleaseTags({
    repository: "example/courtside", token: "test-token", request
  }), /HTTP 503/);
});

test("given no token, when the workflow entry point runs, then no request is attempted", async () => {
  // given
  let requested = false;
  const request = async () => {
    requested = true;
    return response(200, []);
  };

  // when / then
  await assert.rejects(execute({ GITHUB_REPOSITORY: "example/courtside" }, request), /token/);
  assert.equal(requested, false);
});
