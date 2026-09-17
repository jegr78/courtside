import assert from "node:assert/strict";
import test from "node:test";
import { acceptanceInvocation, validateAcceptanceRequest } from "./deployment-acceptance-ssh.mjs";

const request = {
  host: "qualification-box",
  archive: "/tmp/courtside-deployment-0.1.0-rc.2.zip",
  namespace: "courtside-acceptance-standard",
  remoteRoot: "/srv/courtside-acceptance-standard",
  recipe: "standard",
  archiveSha256: "a".repeat(64),
  revision: "b".repeat(40),
  image: `ghcr.io/jegr78/courtside@sha256:${"c".repeat(64)}`,
  confirm: "qualify courtside-acceptance-standard at /srv/courtside-acceptance-standard",
};

test("given an exact namespace confirmation, when the SSH command is built, then every remote mutation stays below that namespace", () => {
  // given
  validateAcceptanceRequest(request);

  // when
  const invocation = acceptanceInvocation(request);

  // then
  assert.equal(invocation.executable, "ssh");
  assert.deepEqual(invocation.args.slice(0, 3), ["--", request.host, "bash"]);
  assert.equal(invocation.args.includes(request.remoteRoot), false);
  assert.equal(invocation.args.includes(request.archive), false);
  assert.ok(invocation.script.includes('root=$(decode "$2")'));
  assert.ok(invocation.script.includes('installation="$root/installation"'));
  assert.match(invocation.script, /test "\$\(realpath "\$root"\)" = "\$root"/);
  assert.match(invocation.script, /stat -c '%a' "\$root"\)" = 700/);
  assert.match(invocation.script, /stat -c '%a' "\$root\/answers\.conf"\)" = 600/);
  assert.match(invocation.script, /test ! -e "\$release"/);
  assert.ok(invocation.script.indexOf('install -m 0600 "$source_archive" "$input/candidate.zip"')
    < invocation.script.indexOf('entries=$(unzip -Z1 "$archive")'));
  assert.ok(invocation.script.indexOf('archive="$input/candidate.zip"')
    < invocation.script.indexOf('printf \'%s  %s\\n\' "$archive_sha256" "$archive"'));
  assert.equal(invocation.script.slice(invocation.script.indexOf('archive="$input/candidate.zip"'))
    .includes('"$source_archive"'), false);
  assert.match(invocation.script, /unzip -Z1 "\$archive"/);
  assert.match(invocation.script, /archive contains an unsafe path/);
  assert.match(invocation.script, /backup --retain 2/);
  assert.match(invocation.script, /restore-check --recovery "\$recovery"/);
  assert.equal(invocation.script.match(/"\$installation\/current\/courtside" up/g)?.length, 2);
  assert.doesNotMatch(invocation.script, /(?:apt|dnf|yum|apk)\s+(?:install|remove)/);
  assert.doesNotMatch(invocation.script, /docker\s+(?:system|volume|image|container)\s+prune/);
  assert.doesNotMatch(invocation.script, /(?:ufw|iptables|firewall-cmd)/);
});

test("given an unsafe or unconfirmed target, when acceptance starts, then it is refused before SSH", () => {
  // when / then
  for (const change of [
    { namespace: "../other" },
    { remoteRoot: "/" },
    { remoteRoot: "/srv" },
    { confirm: "yes" },
    { archive: "relative.zip" },
    { archive: "/tmp/input/$(touch owned).zip" },
    { remoteRoot: "/srv/courtside-acceptance-standard;touch-owned" },
    { host: "box; reboot" },
  ]) {
    assert.throws(() => validateAcceptanceRequest({ ...request, ...change }), /acceptance|namespace|path|host|confirm/i);
  }
});
