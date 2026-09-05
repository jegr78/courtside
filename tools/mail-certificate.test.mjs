import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function deploymentFile(name) {
  return readFileSync(fileURLToPath(new URL(`../deploy/${name}`, import.meta.url)), "utf8");
}

const compose = deploymentFile("compose.yaml");
const caddyfile = deploymentFile("Caddyfile");
const helper = deploymentFile("mail-certificate.sh");

function service(name) {
  const start = compose.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `compose.yaml has no ${name} service`);
  const body = compose.slice(start + 1);
  const next = body.slice(1).search(/^ {2}\S/m);
  assert.ok(next >= 0, `${name} is the last block in compose.yaml`);
  return body.slice(0, next + 1);
}

test("given the proxy, when it is configured, then it manages the mail hostname as well", () => {
  // given / when / then
  assert.match(caddyfile, /^\{\$COURTSIDE_MAIL_HOSTNAME} \{$/m,
    "Caddy issues only for the names it serves, so the mail hostname needs a site of its own");
  assert.match(service("proxy"), /COURTSIDE_MAIL_HOSTNAME: \$\{COURTSIDE_MAIL_HOSTNAME:\?/,
    "the site block reads an environment variable the proxy container does not have");
});

test("given the mail server, when it is configured, then it reads the certificate and not the store",
  () => {
    // given
    const mail = service("mail");

    // when / then
    assert.match(mail, /- mail-tls:\/etc\/stalwart\/tls:ro$/m);
    assert.doesNotMatch(mail, /caddy-data/,
      "the store holds a private key for every name Caddy manages, and the mail server needs one");
  });

test("given the certificate helper, when it is configured, then it keeps the deployment's hardening",
  () => {
    // given
    const service_ = service("mail-certificate");

    // when / then
    assert.match(service_, /image: caddy:2-alpine@sha256:[a-f0-9]{64}$/m);
    assert.match(service_, /no-new-privileges:true/);
    assert.match(service_, /cap_drop:\n {6}- ALL/);
    assert.match(service_, /read_only: true/);
    assert.match(service_, /- caddy-data:\/caddy:ro$/m,
      "the helper reads Caddy's store and must never be able to write into it");
    assert.match(service_, /- mail-tls:\/tls$/m);
    assert.match(service_, /network_mode: none/,
      "the helper carries NET_BIND_SERVICE only because the kernel refuses to exec caddy without "
      + "it, and a container with no network has no port to bind");
  });

test("given the certificate helper, when it publishes, then the mail server can read what it wrote",
  () => {
    // given / when / then
    assert.match(service("mail-certificate"), /user: "0:2000"/,
      "Caddy's store is readable by root alone and Stalwart runs as 2000, so the helper writes "
      + "as root into that group");
    assert.match(helper, /^umask 027$/m,
      "without it the group Stalwart belongs to cannot read the private key the helper just wrote");
  });

test("given a rotation, when the helper reacts, then it waits for an event and not for a duration",
  () => {
    // given / when / then
    assert.match(helper, /inotifyd/,
      "a fixed sleep would publish a half-written pair or a stale one, depending on its length");
  });

test("given the shipped plan, when the mail server loads it, then it reads the published pair", () => {
  // given
  const base = deploymentFile("mail/base.ndjson");

  // when / then
  assert.match(base, /"filePath": "\/etc\/stalwart\/tls\/current\/tls\.crt"/);
  assert.match(base, /"filePath": "\/etc\/stalwart\/tls\/current\/tls\.key"/);
  assert.match(base, /"defaultCertificateId"/);
});
