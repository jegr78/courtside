import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../deploy/mail-check.sh", import.meta.url));

const ANSWERS = {
  a: "Name:\tmail.courts.example.org\nAddress: 203.0.113.5\n",
  ptr: "5.113.0.203.in-addr.arpa\tname = mail.courts.example.org.\n",
  mx: "courts.example.org\tmail exchanger = 10 mail.courts.example.org.\n",
  spf: "courts.example.org\ttext = \"v=spf1 mx -all\"\n",
  dmarc: "_dmarc.courts.example.org\ttext = \"v=DMARC1; p=reject\"\n",
  dkim: "v1._domainkey.courts.example.org\ttext = \"v=DKIM1; k=ed25519; p=AAAA\"\n"
};

function stubs(answers, { outboundOpen = true, relayReply = "550 5.7.1 Relaying denied" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "courtside-mail-check-"));
  const lookup = Object.entries({ ...ANSWERS, ...answers })
    .map(([kind, text]) => `  ${kind}) printf '%b' ${JSON.stringify(text)} ;;`)
    .join("\n");
  writeFileSync(join(directory, "nslookup"), `#!/bin/sh
kind=a
case "$1" in -type=mx) kind=mx ;; -type=txt) kind=spf ;; esac
name=$2
[ -z "$name" ] && name=$1
case "$name" in
  _dmarc.*) kind=dmarc ;;
  *._domainkey.*) kind=dkim ;;
  [0-9]*.[0-9]*.[0-9]*.[0-9]*) kind=ptr ;;
esac
printf 'Server:\\t127.0.0.1\\n\\nNon-authoritative answer:\\n'
case "$kind" in
${lookup}
esac
`);
  writeFileSync(join(directory, "nc"), `#!/bin/sh
case "$*" in
  *-z*) exit ${outboundOpen ? 0 : 1} ;;
esac
cat >/dev/null
printf '220 mail.courts.example.org ESMTP\\r\\n250 ok\\r\\n250 2.1.0 sender ok\\r\\n%s\\r\\n' ${JSON.stringify(relayReply)}
`);
  for (const name of ["nslookup", "nc"]) chmodSync(join(directory, name), 0o755);
  return directory;
}

function run(answers, options) {
  const directory = stubs(answers, options);
  try {
    const output = execFileSync("sh", [script], {
      encoding: "utf8",
      env: {
        PATH: `${directory}:/usr/bin:/bin`,
        COURTSIDE_MAIL_DOMAIN: "courts.example.org",
        COURTSIDE_MAIL_HOSTNAME: "mail.courts.example.org",
        COURTSIDE_MAIL_DKIM_SELECTOR: "v1"
      }
    });
    return { output, failed: false };
  } catch (error) {
    return { output: error.stdout ?? "", failed: true };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("given every record in place, when the check runs, then it passes", () => {
  // given / when
  const { output, failed } = run({});

  // then
  assert.equal(failed, false, output);
  assert.match(output, /^0 check\(s\) failed$/m);
  assert.doesNotMatch(output, /^FAIL/m);
});

test("given an MX naming a host the sender's name is a substring of, when the check runs, then it fails", () => {
  // given
  const answers = { mx: "courts.example.org\tmail exchanger = 10 backupmail.courts.example.org.\n" };

  // when
  const { output, failed } = run(answers);

  // then
  assert.equal(failed, true, output);
  assert.match(output, /^FAIL {2}courts\.example\.org has no MX record naming mail\.courts\.example\.org$/m);
});

test("given SPF that authorises nobody, when the check runs, then it fails", () => {
  // given
  const answers = { spf: "courts.example.org\ttext = \"v=spf1 -all\"\n" };

  // when
  const { output, failed } = run(answers);

  // then
  assert.equal(failed, true, output);
  assert.match(output, /^FAIL {2}courts\.example\.org publishes SPF that names no sender$/m);
});

test("given a reverse name that disagrees with the forward one, when the check runs, then it fails", () => {
  // given
  const answers = { ptr: "5.113.0.203.in-addr.arpa\tname = host5.hoster.example.\n" };

  // when
  const { output, failed } = run(answers);

  // then
  assert.equal(failed, true, output);
  assert.match(output, /^FAIL {2}203\.0\.113\.5 has no PTR record naming mail\.courts\.example\.org$/m);
  assert.match(output, /found 'host5\.hoster\.example'/);
});

test("given a server that relays for a foreign domain, when the check runs, then it fails", () => {
  // given / when
  const { output, failed } = run({}, { relayReply: "250 2.1.5 Recipient ok" });

  // then
  assert.equal(failed, true, output);
  assert.match(output, /^FAIL {2}mail accepts unauthenticated mail for relay-probe\.example\.com$/m);
});

test("given a host that blocks outbound port 25, when the check runs, then it names the way out", () => {
  // given / when
  const { output, failed } = run({}, { outboundOpen: false });

  // then
  assert.equal(failed, true, output);
  assert.match(output, /give the mail server a relay host/);
});

test("given a record carrying terminal escapes, when the check prints it, then they are stripped", () => {
  // given
  const escape = "\\033";
  const answers = { dmarc: `_dmarc.courts.example.org\ttext = "v=DMARC1; p=${escape}[31mreject"\n` };

  // when
  const { output } = run(answers);

  // then
  assert.doesNotMatch(output, /\u001b/);
  assert.match(output, /p=\[31mreject/);
});
