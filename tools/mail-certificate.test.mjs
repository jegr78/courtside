import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function deploymentFile(name) {
  return readFileSync(fileURLToPath(new URL(`../deploy/${name}`, import.meta.url)), "utf8");
}

const compose = deploymentFile("compose.yaml");
const smoke = readFileSync(fileURLToPath(new URL("courtside.mail-smoke.mjs", import.meta.url)),
  "utf8");
const caddyfile = deploymentFile("Caddyfile");
const helper = deploymentFile("mail-certificate.sh");
const reloadScript = deploymentFile("mail-reload.sh");
const mailWorkflow = readFileSync(fileURLToPath(new URL("../.github/workflows/mail-smoke.yml",
  import.meta.url)), "utf8");

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

test("given the reloader, when it is configured, then it can reach the mail server and nothing else",
  () => {
    // given
    const reloader = service("mail-reload");

    // when / then
    assert.match(reloader, /image: node:26-alpine@sha256:[a-f0-9]{64}$/m);
    assert.match(reloader, /no-new-privileges:true/);
    assert.match(reloader, /cap_drop:\n {6}- ALL/);
    assert.match(reloader, /read_only: true/);
    assert.match(reloader, /- mail-tls:\/tls:ro$/m);
    assert.doesNotMatch(reloader, /caddy-data/,
      "the reloader needs the name of the published pair, never the store it came out of");
  });

test("given the reloader, when it runs, then it cannot read the pair it announces", () => {
  // given
  const reloader = service("mail-reload");

  // when / then
  assert.match(reloader, /user: "1500:1500"/,
    "the published versions are readable by the group the mail server is in, so a reloader "
    + "outside that group is denied the private key it triggers a reload for");
  assert.doesNotMatch(reloader, /user: "\d+:2000"/);
});

test("given a validated certificate, when the helper publishes it, then it retains a public leaf "
  + "fingerprint without exposing the pair", () => {
  // given / when / then
  assert.match(helper, /fingerprints/,
    "the published version has no non-secret identity the reloader can compare with the listener");
  assert.match(helper, /base64 -d[\s\S]*sha256sum/,
    "hashing the PEM text would not match the listener's DER certificate fingerprint");
  assert.match(helper, /chmod 0644/,
    "the reloader is deliberately outside the group that can traverse the certificate versions");
  assert.doesNotMatch(service("mail-reload"), /user: "\d+:2000"/,
    "public fingerprint metadata does not justify granting access to the private-key group");
});

test("given an accepted reload, when health is decided, then the served leaf must match the "
  + "published fingerprint", () => {
  // given / when / then
  assert.match(reloadScript, /mail-certificate-peer\.mjs/,
    "Stalwart can accept a mismatched pair while retaining its old certificate");
  assert.match(reloadScript, /grep -q '\^\[a-f0-9\]\\\{64\\\}\$'/,
    "a crafted current symlink must not select arbitrary metadata paths");
  assert.match(reloadScript, /listener="\$\{COURTSIDE_MAIL_RELOAD_TLS_HOST:-mail}"/,
    "the public hostname is an alias on a network the least-privileged reloader does not join");
  assert.match(service("mail-reload"), /node:26-alpine@sha256:[a-f0-9]{64}$/m,
    "the Alpine base has no client that can both validate SMTP STARTTLS and read its peer leaf");
  assert.match(service("mail-reload"),
    /- \.\/mail-certificate-peer\.mjs:\/mail-certificate-peer\.mjs:ro$/m);
});

test("given the listener verifier changes, when GitHub selects checks, then the real mail stack runs",
  () => {
    // given / when / then
    assert.match(mailWorkflow, /- 'deploy\/mail-certificate-peer\.mjs'/,
      "an isolated verifier change would otherwise skip its only real Stalwart execution");
  });

test("given a reload, when the mail server answers, then the reloader reads the answer and not the "
  + "status", () => {
    // given / when / then
    assert.match(reloadScript, /"created"/,
      "a refused action is answered with 200 and a notCreated entry, so a status code cannot "
      + "tell an accepted reload from a forbidden one");
    assert.match(reloadScript, /inotifyd/,
      "a fixed sleep reloads a pair that has not arrived or leaves one waiting");
  });

test("given the helper and the reloader, when either fails, then the deployment can see it", () => {
  // given / when / then
  assert.match(service("mail-certificate"), /healthcheck:/,
    "a failed copy leaves the mail server on the pair before it, which nothing else reports");
  assert.match(service("mail-reload"), /healthcheck:/);
});

test("given the shipped plan, when it creates the reload identity, then that identity can do "
  + "nothing else", () => {
    // given
    const base = deploymentFile("mail/base.ndjson");
    const account = base.split("\n").find((line) => line.includes("{{reloadpassword}}"));

    // when / then
    assert.ok(account, "the plan has no account for the reloader, so it would use an administrator");
    assert.match(account, /"permissions": \{"@type": "Replace"/,
      "Merge would add the reload to whatever the role already grants");
    const enabled = /"enabledPermissions": \{([^}]*)\}/.exec(account);
    assert.ok(enabled, "the account replaces its inherited permissions with none at all");
    assert.deepEqual(enabled[1].match(/"[a-zA-Z]+":/g).sort(),
      ['"actionReloadTlsCertificates":', '"authenticate":', '"sysActionCreate":',
        '"sysCertificateGet":'].sort(),
      "signing in, creating the action, the action itself and reading back what was loaded");
  });

test("given the mail server, when the instance dials it, then it dials the name on its certificate",
  () => {
    // given / when / then
    assert.match(service("mail"),
      /relay:\n +aliases:\n(?: +#[^\n]*\n)* +- \$\{COURTSIDE_MAIL_HOSTNAME:\?/,
      "the compose network answers for `mail` alone, a name no authority issues a certificate for");
    assert.match(service("app"), /networks:\n(?: +- \w+\n)* +- relay\n/,
      "the instance is not on the network the name answers on, so it reaches nothing under it");
    assert.match(compose,
      /COURTSIDE_MAIL_RELAY_HOST: \$\{COURTSIDE_MAIL_RELAY_HOST:-\$\{COURTSIDE_MAIL_HOSTNAME:\?/,
      "an instance that keeps dialling `mail` cannot authenticate what answers");
    assert.match(compose, /COURTSIDE_MAIL_TRUST_RELAY_CERTIFICATE: \$\{[^}]*:-false\}/,
      "this deployment still accepts whatever certificate the relay presents");
  });

test("given the mail smoke, when it verifies a certificate, then openssl reports a failure as one",
  () => {
    // given / when / then
    const verifying = smoke.split("s_client").filter((call) => call.includes("-CAfile"));
    assert.ok(verifying.length > 0, "the smoke hands openssl no authority to verify against");
    for (const call of verifying) {
      assert.match(call, /-verify_return_error/,
        "openssl reports a verification failure and carries on unless it is told not to, so this "
        + "check reads the same whether the certificate verified or not");
    }
  });

test("given the setup check, when it reads the mail hostname's public record, then no alias answers "
  + "for it", () => {
    // given / when / then
    assert.doesNotMatch(service("mail-check"), /\n +(?:- relay\b|relay:)/,
      "an alias answers for every container sharing its network, so this check would read the mail "
      + "container's address as the host's A record and report its reverse name as missing");
  });
