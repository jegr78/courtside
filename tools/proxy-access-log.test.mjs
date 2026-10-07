import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const proxies = ["Caddyfile.perf", "Caddyfile.uat"].map((name) => ({
  name, source: readFileSync(new URL(`../deploy/${name}`, import.meta.url), "utf8")
}));

function httpsSite(source) {
  const start = source.indexOf("https://localhost:443");
  assert.ok(start >= 0, "the proxy must serve HTTPS on localhost:443");
  return source.slice(start);
}

test("given the performance and UAT proxies, when a request is served, then it is logged without query, headers or a full address", () => {
  for (const { name, source } of proxies) {
    // given
    const site = httpsSite(source);

    // when
    const log = site.match(/\n\tlog \{\n([\s\S]*?)\n\t\}\n/)?.[1];

    // then
    assert.ok(log, `${name} must keep an access log so a failed run can be located on the server side`);
    assert.match(log, /format filter \{/, `${name} must filter what it logs`);
    assert.match(log, /request>uri regexp \\\?\.\*\$ ""/, `${name} must drop the query string`);
    assert.match(log, /request>headers delete/, `${name} must drop cookies, CSRF tokens and authorization`);
    assert.match(log, /resp_headers delete/, `${name} must drop Set-Cookie`);
    assert.match(log, /request>remote_ip ip_mask/, `${name} must mask the remote address`);
    assert.match(log, /request>client_ip ip_mask/, `${name} must mask the client address`);
  }
});

test("given the production proxy, when it is read, then it keeps no access log", () => {
  // when
  const production = readFileSync(new URL("../deploy/Caddyfile", import.meta.url), "utf8");

  // then
  assert.doesNotMatch(production, /\n\s*log \{/, "the club's own deployment decides about logging its members' requests");
});
