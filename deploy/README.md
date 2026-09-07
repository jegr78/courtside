# Running a Courtside instance

Every club runs its own instance. This directory is the deployment the maintainer runs, published
so that yours is the same thing rather than a reconstruction of it. Copy the directory, fill in
`.env`, and adapt what your infrastructure requires — you are not expected to send changes back.

You need Docker with the Compose plugin. The application container is capped at 1 GiB and an idle
instance with an empty database sits at roughly 450 MiB of that; raise `COURTSIDE_MEMORY` if your
club outgrows it.

For the repository's local Dev and UAT environments, use the
[local environment guide](../docs/local-environments.md). This document covers the production
reference deployment only.

## First start

```sh
cp .env.example .env
```

Fill in `.env`:

- `COURTSIDE_VERSION` — an exact release, for example `0.1.0-alpha.1`. Do not use a floating tag;
  an unattended upgrade of a booking system is not a feature. To pin harder, append the digest:
  `0.1.0-alpha.1@sha256:…`. Registry tags are mutable, digests are not.
- `POSTGRES_PASSWORD` — generate one, for example with `openssl rand -base64 32`. It is only ever
  used between the two containers.
- `COURTSIDE_BOOTSTRAP_ADMIN_USERNAME` — the username of the first local administrator.
- `COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD` — a one-time password of at least 12 characters. The first
  login can do nothing except replace it.
- `COURTSIDE_BOOTSTRAP_ADMIN_DISPLAY_NAME` — the administrator's first and last name.
- `COURTSIDE_DOMAIN` — the name your members will type. Only needed for the reverse proxy below.

The initial club time zone is `Europe/Berlin`. Change it to the club's IANA zone in the admin
configuration before members create bookings.

Then start it:

```sh
docker compose --profile proxy up -d
```

Caddy obtains a certificate for `COURTSIDE_DOMAIN` on its own, so ports 80 and 443 must reach the
host and the name must already point at it. The application itself is published on
`127.0.0.1:8080` and never directly on a public interface.

Use a certificate that every member device trusts. Clicking through a browser warning for an
untrusted certificate chain can leave the application usable while the browser still refuses to
install its service worker. Offline use and automatic update notices then remain unavailable. A
private certificate authority works only after the club installs its root certificate in every
member device's trust store, which makes a publicly trusted certificate the practical default.

Flyway runs the migrations on startup. On an empty account table, startup creates exactly one
enabled local account with the `ADMIN` role. Missing bootstrap values stop startup instead of
leaving an instance that nobody can enter. `docker compose ps` shows the application as `healthy`,
and `docker compose logs -f app` shows it reporting `Started CourtsideApplication`.

Sign in with the bootstrap username and password. The response carries
`X-Courtside-Password-Change-Required: true`; until `PUT /api/account/initial-password` replaces
that password, all other authenticated application operations are forbidden. A successful change
ends the session. After signing in with the new password, remove the three
`COURTSIDE_BOOTSTRAP_ADMIN_*` values from `.env`: once any local account exists, later starts ignore
them and never create, reset or modify an account.

## Verifying what you are about to run

Every release is signed keylessly, so you can prove the image came out of this project's release
workflow and not from someone with a registry token:

```sh
cosign verify \
  --certificate-identity-regexp '^https://github\.com/jegr78/courtside/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/jegr78/courtside:<version>
```

The image also carries an SBOM and provenance attestation:
`docker buildx imagetools inspect ghcr.io/jegr78/courtside:<version> --format '{{ json .SBOM }}'`.

## Plain HTTP clients

The reference proxy redirects only `GET` and `HEAD` requests for known browser routes to the
canonical HTTPS origin. API, management, unknown-method and state-changing requests over plain
HTTP receive a fixed `400` response at Caddy. They are not forwarded and their headers or bodies
are not reflected. Configure API clients with an `https://` base URL before sending credentials or
content; following a redirect cannot make bytes already sent over HTTP confidential.

Caddy's automatic certificate management remains enabled. Only its blanket HTTP redirect is
disabled so the explicit browser-route and refusal policy can run; ACME challenges remain Caddy's
responsibility.

## Without a public IP address

A club with no static address, no server and no budget still needs its instance reachable.
[Tailscale Funnel](https://tailscale.com/kb/1223/funnel) does that: it terminates TLS on a
`*.ts.net` name and forwards to a local port, so no port has to be opened on the router.

Leave the reverse proxy out and expose the application port instead:

```sh
docker compose up -d
tailscale funnel 8080
```

Three things this path costs you, all worth knowing before you choose it:

- **Funnel keeps the application's headers.** The application sets `Content-Security-Policy`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
  `Referrer-Policy: strict-origin-when-cross-origin` on its own responses. For a request it
  recognizes as secure, Spring Security also sets `Strict-Transport-Security`. Caddy repeats
  nosniff, frame denial and the referrer policy at the edge and sets HSTS independently;
  `Permissions-Policy` is the only response policy here that comes only from Caddy. The Funnel path
  therefore keeps those five application headers when Funnel supplies the trusted HTTPS forwarding
  signal required below. It loses only Caddy's `Permissions-Policy` response header.
- **Funnel makes the instance reachable from anywhere in the world**, exactly like a public
  address does. Everything in "What this deployment does not solve yet" applies with full force.
- **The application trusts forwarded headers.** Funnel or any replacement must discard incoming
  `Forwarded` and `X-Forwarded-*` values and supply its own. Never forward arbitrary client values.

This is an option, not part of the reference deployment — the project must not depend on one
vendor, and everything here works without it.

## The club's own mail server

A member's first password is meant to reach that member and nobody else, which an instance cannot
do without a way to send mail. The reference deployment therefore carries its own MTA,
[Stalwart](https://stalw.art), under the `mail` profile.

Treat it as separate from whatever the club already uses for its own correspondence. It exists to
send from one address, it holds no member's mailbox, and a club that runs its mail elsewhere keeps
running it there.

```sh
docker compose --profile mail up -d
```

Nothing starts it otherwise. The application sends every credential and every notification through
it, so a member's first password waits until this server delivers. Bring it up when you are ready to
work through the DNS below, not before — a server that starts is not a server whose mail arrives.

### Setting it up without touching a wizard

Stalwart normally asks for its configuration through a setup wizard in the browser. This deployment
does not: `deploy/mail/` holds the configuration as two plans in NDJSON — one operation per line,
readable and diffable — and `stalwart-cli apply` loads them. The values that differ between clubs
come from `.env`, so `.env` is the only place any of it is written down.

```sh
docker compose --profile proxy up -d proxy
docker compose --profile mail up -d mail mail-certificate
docker compose --profile mail logs mail-certificate
docker compose --profile mail-setup run --rm mail-bootstrap
docker compose --profile mail restart mail
docker compose --profile mail-setup run --rm mail-configure
docker compose --profile mail up -d --force-recreate mail
docker compose --profile mail up -d mail-reload
```

The proxy comes first because `mail-configure` writes a certificate that points at two files, and
Caddy is what puts them there. Read the helper's log before going on: it says `published the
certificate for <hostname>` once the pair has arrived, and until then there is nothing to point at.
`COURTSIDE_MAIL_HOSTNAME` must resolve to this host by then, or Caddy has no way to prove the name.

Two applies with a restart between them, because the first one answers the questions the wizard
would have asked — hostname, domain, whether to generate DKIM keys — and the server only leaves
setup mode on the next start. The second one loads the listeners, the delivery routes, the
administrator account, the certificate and the account the reloader signs in with — which is why
`mail-reload` starts last: before that apply there is nothing for it to authenticate as.

Before the first command, `.env` needs five values: `COURTSIDE_MAIL_HOSTNAME`,
`COURTSIDE_MAIL_DOMAIN`, `COURTSIDE_MAIL_ADMIN_PASSWORD` for the club's mail administrator,
`COURTSIDE_MAIL_RELOAD_PASSWORD` for the account that loads renewed certificates, and
`COURTSIDE_MAIL_SETUP_PASSWORD` together with
`COURTSIDE_MAIL_RECOVERY_ADMIN=admin:$COURTSIDE_MAIL_SETUP_PASSWORD` — the credential the setup
commands authenticate with while the server has no accounts yet.

**Clear `COURTSIDE_MAIL_RECOVERY_ADMIN` when you are done**, which the last command above picks up.
While it is set the server runs in recovery mode and serves nothing but its admin port: no SMTP, no
mail. It is a way back in, not a setting to leave on.

Three credentials are in play here, and which part of which one is temporary is not obvious:

| Credential | Who it is | How long it lives |
|---|---|---|
| `COURTSIDE_MAIL_SETUP_PASSWORD`, through `COURTSIDE_MAIL_RECOVERY_ADMIN` | The built-in `admin`, which exists only while the recovery variable is set | The account is temporary, the password is not. `mail-bootstrap` and `mail-configure` authenticate as `admin` with it on every run, so keep it, and set the recovery variable back to `admin:${COURTSIDE_MAIL_SETUP_PASSWORD}` whenever you need to run either again. |
| `COURTSIDE_MAIL_ADMIN_PASSWORD` | The club's mail administrator | Permanent. This is who signs in to read the DKIM selector or add a relay route. |
| `COURTSIDE_MAIL_PASSWORD` | The account the instance authenticates as | Permanent, and not an administrator. It is an ordinary account that this deployment gives nothing to read: no IMAP or POP3 listener exists, so submitting is all it can reach. |
| `COURTSIDE_MAIL_RELOAD_PASSWORD` | The account `mail-reload` authenticates as | Permanent, and narrower than any of the others. Its permissions replace what its role would grant with four: signing in, creating the action, reloading TLS certificates, and reading back which certificate the server loaded. It is refused every other administrative call, a sibling reload included. |

Two of those four grant full control of the mail server and both live in `.env` permanently, so
that file is a secret in its own right: give it to the account that runs Compose and to nobody else
(`chmod 600`), and keep it out of whatever backs up the rest of this host in the clear.

Afterwards the mail administrator signs in at `http://127.0.0.1:${COURTSIDE_MAIL_ADMIN_PORT}/` —
over an SSH tunnel if the host is remote, because the port is bound to the loopback interface and
belongs on no public address — as `${COURTSIDE_MAIL_ADMIN_USERNAME}@${COURTSIDE_MAIL_DOMAIN}`.

### What the plans do and do not carry

**The DKIM key is never ours.** The plan declares that the domain manages DKIM automatically; the
server then generates its own key pair on first start and rotates it on its own schedule. Nothing
about your signing key comes from this repository, and the selector to publish is the one the
server shows — which is also why `COURTSIDE_MAIL_DKIM_SELECTOR` in `.env` has to be updated after a
rotation.

**No secret is in them either.** `stalwart-cli snapshot`, which is how these plans were produced,
strips secret values by default. The administrator password is substituted from `.env` when the
plan is rendered, and the rendered copy lives in a volume rather than in the repository.

Two things about the mail container are worth knowing regardless:

- **The web interface is not pinned.** Every image in `compose.yaml` is pinned by digest; the admin
  interface is the one artefact fetched at runtime from a release URL, and it is the component with
  full control over the mail server. Its integrity rests on TLS to GitHub and nothing else. A
  deliberate exception, not an oversight.
- **One ACME client, two names.** Caddy is still the only thing here that talks to a certificate
  authority, and it now issues for `COURTSIDE_MAIL_HOSTNAME` as well as `COURTSIDE_DOMAIN`. The
  `mail-certificate` helper copies that one certificate and its key into a volume of its own, which
  the mail server mounts read-only. Caddy's store, which holds a private key for every name it
  manages, is never mounted into the mail server. A renewal is loaded by `mail-reload`, a third
  container that reaches the mail server but cannot read the pair it asks it to load, signing in as
  an account whose permissions are that one reload. The instance hands its mail in under
  `COURTSIDE_MAIL_HOSTNAME` and verifies the chain and that name like any other client, so a relay
  serving the wrong certificate stops the mail rather than receiving it. That name answers on a
  network of its own, joined by the instance and the mail server and by nothing else: an alias
  answers for every container sharing its network, and `mail-check` has to read the public record
  for the same name. MTA-STS and DANE remain out of scope.

### The certificate the mail server serves

Three containers and one certificate. Caddy obtains it for `COURTSIDE_MAIL_HOSTNAME` and renews it,
`mail-certificate` publishes each new pair into the `mail-tls` volume, and `mail-reload` asks the
mail server to load what has been published. The reloader then connects to the submission listener
and verifies what it actually serves. No
container does two of those jobs, which is what keeps a compromise of any one of them from being a
compromise of the key.

**Where the pair lives, and who can open it.** Caddy's store holds a private key for every name it
manages and is mounted into `mail-certificate` read-only and into nothing else. The helper writes
one certificate and one key into `mail-tls` as root with `umask 027`, in the group the mail server
runs as, so the mail server can read that pair and nothing in the store it came from.
`mail-reload`, the container that asks for the load, runs as a user outside that group: it mounts
the same volume read-only and still cannot open what it points at. The pair is published under
`versions/<digest of the pair>` and `current` is a symlink, because two files cannot be renamed at
once and a mail server reading half a swap would serve a key that does not match its certificate.
The volume also holds a world-readable SHA-256 fingerprint of the public leaf certificate for each
retained version. It never makes the certificate or key readable to `mail-reload`. The reloader
uses this metadata to distinguish a successful handover from a reload that Stalwart accepted
without changing its listener.

**A renewal reaches the listener with nobody present.** Caddy renews at a third of the lifetime
remaining. `mail-certificate` watches the store and publishes within seconds of a renewal landing;
`mail-reload` watches `current` and reloads on the swap. It also re-reads what the server holds
every `COURTSIDE_MAIL_CERTIFICATE_CHECK_INTERVAL` seconds — an hour by default — because a
certificate nobody renews expires quietly between two swaps, and no swap would ever wake anything.
An hour is therefore the worst case for noticing a problem that arrives without a swap, and the
best case for a renewal is seconds.

Both containers write their current state into `/tmp/health`, which is what their healthcheck reads,
so `docker compose ps` is the live signal and `docker compose logs` is the history. They log a state
only when it *changes*: a green run says one line and then stays quiet for weeks. The absence of
recent output is the normal condition, not a stalled container.

```sh
docker compose --profile mail ps mail-certificate mail-reload
docker compose --profile mail logs --tail 20 mail-certificate mail-reload
```

Steady state is `the mail server has the certificate the proxy issued for <hostname>` from
the helper and `the mail server serves the certificate the proxy issued for <hostname>` from the
reloader. Both are `ok` lines, and both are what an unhealthy container has stopped saying.

The JMAP read-back first checks that exactly one certificate is loaded, that it names
`COURTSIDE_MAIL_HOSTNAME`, that its lifetime is under 400 days and that more than a sixth of that
lifetime is left. The reloader then performs SMTP STARTTLS with normal chain and hostname
validation and compares the served leaf with the publisher's fingerprint. A server accepting the
reload request is therefore not enough to become healthy. The sixth is
`COURTSIDE_MAIL_CERTIFICATE_REMAINING_SHARE`, and it is deliberately later than Caddy's own renewal
point: by the time it fires, a renewal has had a full window of its own to fail in first.

**Reading what the mail server is actually serving.** The instance hands its mail to the submission
port over the internal network, and a receiver reaches port 25 from outside. Both listeners present
the same pair. Substitute your own `COURTSIDE_MAIL_HOSTNAME` for `courts.example.org`:

```sh
name=courts.example.org
docker compose --profile mail exec -e NAME="$name" mail sh -c \
  'openssl s_client -starttls smtp -connect "$NAME:587" -verify_hostname "$NAME" \
     -verify_return_error </dev/null 2>&1 | grep "^Verify return code"'
openssl s_client -starttls smtp -connect "$name:25" </dev/null 2>/dev/null \
  | openssl x509 -noout -issuer -dates -ext subjectAltName
```

`Verify return code: 0 (ok)` is the answer, and it is the question the instance asks before it
hands over a message: chain and name, both, against a public trust store. Anything else names the
disagreement — `62` is a certificate that does not carry this name, `20` a chain that does not reach
a known authority, `18` a self-signed one. The second command prints who issued the certificate,
which names it carries and when it runs out, which is what to compare against a `close to expiry`
line in the log. Ask it for the names and not for the subject: Caddy leaves the subject empty and
puts the name in the certificate's `subjectAltName`, so `-subject` prints an empty line.

None of this needs a password and none of it prints one. Reading what the server serves is not
reading the key it serves it with, and no command in this file does the second.

### When the certificate stops arriving

Every state below is one a container writes into its health file, so it is what `docker compose ps`
turns unhealthy and what the log names once, when it starts. Read it there first: the message says
which of the three jobs stopped, and none of these is repaired by deleting a volume.

Nothing has to be restarted afterwards either. `mail-certificate` reacts to the store and
`mail-reload` to the swap, so fixing the cause is the whole procedure, and the next line in the log
is the confirmation.

| What `mail-certificate` says | What it means, and what to do |
|---|---|
| `no certificate for <hostname> in the proxy's store yet` | Caddy has not issued for this name. It is the normal state for a minute after the first start, and a lasting one when `COURTSIDE_MAIL_HOSTNAME` does not resolve to this host or port 80 is closed to the authority. Read `docker compose logs proxy`. |
| `cannot write into <target>, so nothing can be handed over` | The `mail-tls` volume is not writable by the helper. It runs as `0:2000`; a volume restored from a backup with other ownership is the usual cause. |
| `cannot copy the pair for <hostname> out of the proxy's store` | The store was readable a moment ago and is not now, or the host ran out of disk. |
| `the pair for <hostname> is incomplete or mismatched, so the published one stays` | Caddy could not validate the pair: a half-written renewal, or a key that does not match its certificate. The published pair is untouched and the mail server keeps serving it, so this is a warning and not an outage. It clears itself when the renewal completes. |
| `cannot name the new version under <target>` | Same volume, same causes as the write failure above. |
| `cannot retain the public fingerprint for <hostname>` | The pair was valid, but the helper could not write its non-secret fingerprint. It removes the new version instead of publishing something the reloader cannot identify. |
| `the published version for <hostname> no longer matches its contents` | An existing volume names a pair by a digest that no longer matches its files. Restore the volume from a consistent backup or let Caddy publish a new pair. The helper will not create trusted metadata for altered contents. |
| `cannot swap <target>/current, so the mail server still reads the pair before this one` | The new pair is on disk but the symlink could not be replaced. The mail server goes on serving the previous one, which is valid until it is not. |

| What `mail-reload` says | What it means, and what to do |
|---|---|
| `the certificate helper has published no pair for <hostname> yet` | `mail-reload` started before `mail-certificate` got anywhere. Look at the helper, not at this. |
| `the mail server answered the reload request with <status>` | `401` is a credential the server does not accept: `COURTSIDE_MAIL_RELOAD_PASSWORD` was changed in `.env` without `mail-configure` being run again, or the server was left in recovery mode, where that account does not exist. No status at all is an admin port that did not answer. |
| `the mail server refused the reload: <reason>` | `forbidden` is the reload account missing the permission to reload, which leaves the listener serving the pair it already had. `validationFailed` is a pair the server read and could not parse, and **it is the one state with a consequence beyond the certificate** — see below. |
| `the mail server answered with <status> when asked what it loaded` | The reload was accepted and the read-back was not. Same causes as the request failure above. |
| `the mail server holds more than one certificate, so this cannot say which it checked` | Somebody added a second certificate through the admin interface. The reloader refuses to guess which one the listener uses; remove the other. |
| `the mail server loaded a certificate that does not name <hostname>` | The listener is serving something else entirely. Compare it with the second command above. |
| `the mail server did not say how long the certificate for <hostname> is valid` | The read-back came back without usable dates, which a Stalwart upgrade that changed the answer's shape would do. |
| `the mail server serves a certificate it made itself and not the one the proxy issued` | The fallback. The server refused a load at some point and generated its own certificate, valid far beyond any authority's 400 days. Repair the pair and the next reload replaces it. |
| `the certificate for <hostname> is close to expiry, so the proxy stopped renewing it` | Less than a sixth of the lifetime is left, so Caddy's renewal at a third has already failed once without anybody looking. This is the line that arrives before an outage rather than after it, and on a ninety-day certificate it arrives about a fortnight ahead: read `docker compose logs proxy` while the certificate is still valid. The renewal fails for the reasons the first issuance would have: `COURTSIDE_MAIL_HOSTNAME` no longer resolves to this host, something closed port 80 or 443 in front of the proxy, or the authority is refusing the name. Caddy keeps retrying on its own, so the fix is the cause and never a restart. |
| `the certificate helper published an invalid version name` | `current` no longer points to the 64-character digest created by the helper. Treat the volume as inconsistent and restore it from a known-good backup. The reloader refuses the name before using it as a metadata path. |
| `the mail listener did not present a certificate trusted for <hostname>` | The submission listener's chain or hostname validation failed. Read the listener with the command above. A reload response cannot override this failure. |
| `the configured mail listener did not offer STARTTLS` | Port 587 answered as another protocol or Stalwart no longer offers transport security there. Check the listener plan before changing the reloader. |
| `the served leaf fingerprint does not match the published certificate` | Stalwart accepted the reload but kept or served another certificate. The helper has already published a valid pair. Read the mail server logs and compare `current` with the listener before attempting another issuance. |

**A pair the mail server cannot parse is the state that reaches members.** Stalwart does not keep
the pair it had when it refuses a load: the listener falls back to a certificate it generated
itself, the instance refuses to authenticate a relay it cannot verify, and every credential and
notification settles `FAILED` in the admin message list. Repairing the pair does not resend them.
The events still outstanding are replayed when `app` restarts, and a credential the instance sends
again is a new one, because the first exists only as a hash. Anything older than that is re-issued
from the roster, where sending an account new credentials is one action.

Reissuing the certificate itself is the last thing to reach for, not the first. Removing Caddy's
store makes it obtain a new one, and Let's Encrypt issues at most five certificates for the same
name per week and refuses a name whose validation has failed five times in an hour. A loop that
keeps recreating the container spends both quietly and leaves the name unissuable for days, which
is a longer outage than the one it was trying to fix. Read the log to the end first.

### What DNS has to say before anyone believes this server

Six records, all published by you, none of them optional if the mail is to arrive:

| Record | Where | Why |
|---|---|---|
| `A` / `AAAA` | `COURTSIDE_MAIL_HOSTNAME` | The address the server sends from. |
| `PTR` | that address, **at your hosting provider only** | Receivers reject a host whose reverse name disagrees with its forward one. |
| `MX` | `COURTSIDE_MAIL_DOMAIN` | Where bounces and DMARC reports come back to. |
| `SPF`, a `TXT` record | `COURTSIDE_MAIL_DOMAIN` | Names this host as allowed to send, ending in `-all`. `mail-check` reads the sender mechanisms and never the `all` at the end, so `+all` — which authorises the whole internet to send as your domain — passes it. |
| `DKIM`, a `TXT` record | `<selector>._domainkey.<domain>` | The public half of the key Stalwart signs with. |
| `DMARC`, a `TXT` record | `_dmarc.<domain>` | What a receiver should do when the first two disagree. |

Three of them have a catch that costs an evening if nobody says it first:

- **`PTR` is not yours to publish.** It lives in the reverse zone of whoever owns the address, which
  is your hosting provider — a field in their control panel, or a support request, and some ask why.
  A missing or generic reverse name is the single most common reason a small machine's mail is
  refused outright rather than filed as spam, and no amount of SPF and DKIM makes up for it.
- **`DKIM` names a selector you do not choose.** Stalwart generates its own key and shows the
  selector in the admin interface; `COURTSIDE_MAIL_DKIM_SELECTOR` follows it rather than setting it.
  The key lives in the `mail-data` volume with everything else the server stores, so losing that
  volume means a new key, a new selector and a new record — see the backup section below. The
  selector also changes on its own every 90 days, and this deployment publishes DNS by hand:
  after a rotation the server signs with a new selector while `.env` and DNS still describe the
  retired one, and `mail-check` reports `ok` for a record nothing signs with any more. Read the
  selector out of the admin interface, not out of the last green check.
- **`DMARC` is a policy, and starting strict punishes you, not a forger.** Publish
  `v=DMARC1; p=none; rua=mailto:<a mailbox you read>` first — a mailbox somebody opens, not an
  address at this instance, which receives reports and has nobody to read them. Leave it there long
  enough to read what it brings, and tighten to `p=quarantine` and then `p=reject` once they show
  your own mail passing. `mail-check` asks only whether a `v=DMARC1` record is there and never
  which policy it carries, because which policy is right is a question about your domain and not
  about this deployment.

A seventh thing is not DNS and is the one that most often ends the exercise: **most hosting
providers block outbound port 25** until you ask them to unblock it, and some never will. Find out
before a member depends on it rather than after — `mail-check` below opens a connection to a public
MX and tells you in one line, and it costs nothing to run on the day the instance is installed.

If the answer is no, the mail still has somewhere to go: give the server a relay host under
*MTA → Outbound → Routes* in the admin interface — the club's provider, or any server that will
accept authenticated submission — and point the outbound routing strategy at it. That route lives
in the interface and **no environment variable carries it**. `COURTSIDE_MAIL_RELAY_HOST` is a
different hop, the one the application uses to hand a message to this server. Delivery straight to
the recipient is what this deployment does by default, not what it requires.

### Port 25 is public, and a host firewall will not change that

`25:25` binds every interface. That is what an MTA is for, but it is also the one published port in
`compose.yaml` that is not pinned to `127.0.0.1`, and Docker installs its forwarding rules ahead of
`ufw` or `nftables` — a host firewall rule will not close it. If you need it restricted, do it in
your provider's security groups or in Stalwart's own configuration.

Inbound port 25 is here so that bounces and DMARC reports arrive at all. What to do with them —
read them, forward them, act on them — has no answer in this deployment yet.

**Everything else stays off the public interface, and that is deliberate.** Submission, IMAP and
POP3 have no published port at all: the application reaches submission over the compose network, and
nobody holds a mailbox here to collect. The admin interface is published on `127.0.0.1` only. Port
25 is this server's entire public surface, and the only thing that changes that is a port added to
`compose.yaml`.

### Checking all of it at once

```sh
docker compose --profile mail-check run --rm mail-check
```

Every record it names — `PTR`, `MX`, `SPF`, `DKIM` and `DMARC` — is a row in the table above, in
the same word, so a failing line says which row to go back to.

That resolves every record above, compares each address's reverse name against the forward one,
opens a connection to a public MX to see whether outbound 25 leaves the host, and asks the mail
server to relay a message for a foreign domain — the one state in which a mail
server harms people who are not its members. One line per check, non-zero exit if any failed, so it
also works as a cron job that tells you the day a record expires.

The outbound probe contacts a third party by default. `COURTSIDE_MAIL_OUTBOUND_PROBE` points it
somewhere else if you would rather it did not, and `COURTSIDE_MAIL_RELAY_PROBE` names the foreign
domain the relay test asks about.

### Proving it works before a member depends on it

`node tools/courtside.mail-smoke.mjs` brings this same mail server up on a scratch Compose project,
renders and applies these same plans, and hands it a message over the submission port the way the
application will — authenticated, over STARTTLS — then reads that message back out of a local sink.
Before that it offers the same server somebody else's mail on port 25, unauthenticated and with the
transcript `mail-check.sh` sends, and requires it to refuse: an open relay is the one state in which
an instance harms people who are not its members, and it is not a state anybody should have to take
on trust. It tears the project down afterwards and needs Docker and `openssl`. The `mail smoke`
workflow runs it whenever anything under `deploy/mail/` or in the application's own mail path
changes, so the configuration a club applies is configuration that has been applied.

One thing the run does differently on purpose: its Caddy issues from a local authority rather than
from Let's Encrypt, because a smoke world has no public name to prove. Everything after that is the
shipped path — the same site block, the same helper, the same volume — so the certificate the run's
mail server presents arrived the way yours does.

### The test that counts is a message that arrived somewhere else

Everything above happens on your own machine and can pass while the receiving world still refuses
you. Send one real message to a mailbox you hold at a large provider. Add a person to the roster
with that address, give them an account, issue their credential, and deactivate the account once
the message has been read.

**Not your own administrator account.** Issuing a credential replaces that account's password
immediately and ends its sessions, and the instance can only see that it handed the message to this
server — which is the very thing under test. If it is then refused out there, the password is gone,
and an instance whose only administrator is locked out has no way back that does not go through the
database.

Open the received message and read its full source. The header to find is
`Authentication-Results`, written by the receiver and not by you:

```text
Authentication-Results: mx.example.com;
       dkim=pass header.i=@courts.example.org;
       spf=pass smtp.mailfrom=courts.example.org;
       dmarc=pass header.from=courts.example.org
```

**Three passes, in one message, at a receiver you do not run.** That is the state a member's first
password depends on, and nothing short of it proves you are there. If one of them says `fail` or
`none`, the record it names is the one to go back to; if the message never arrived at all, the
answer is usually the reverse name or outbound port 25 rather than anything in this file.

### Back up the mail volumes too

The backup below covers PostgreSQL. Neither mail volume is in it, and the two are not alike:
`mail-config` holds one small file naming where the store lives, and **`mail-data` is the store** —
the private DKIM key, every account and its credentials. Losing it means generating a new key and
publishing a new selector; leaking it means somebody can sign mail as your domain until you notice.
Include both volumes in whatever backs this host up, and treat `mail-data` as a secret when you do.

### When the mail administrator password is lost

Set `COURTSIDE_MAIL_RECOVERY_ADMIN` to `admin:${COURTSIDE_MAIL_SETUP_PASSWORD}` and restart the
`mail` service, then sign in as `admin`. Any password works to sign in, but the setup commands read
that one variable, so choosing anything else means they can no longer authenticate.

**The server stops accepting and delivering mail while that variable is set** — it runs in recovery
mode and serves only its admin port. Clear it and recreate the container once you are back in.

To change the administrator password instead, edit `COURTSIDE_MAIL_ADMIN_PASSWORD` and run
`mail-configure` again: the plan upserts the account, so it reconciles rather than duplicates.


## Encrypting the connection to the database

By default the application reaches PostgreSQL over the compose network with whatever the driver
chooses, which is `prefer`: encrypted when the database offers it, verified never. No database port
is published and the network is private to the compose project, so on a single host that is the
whole story. It stops being the whole story when the database is somewhere else.

`COURTSIDE_DB_TLS_MODE` names what the connection guarantees.

| Mode | What it means |
|---|---|
| `prefer` | The default. Courtside configures nothing and the driver encrypts opportunistically without checking who answered. |
| `disable` | No encryption, stated rather than assumed. |
| `verify-full` | Encryption is required, the certificate must chain to the authority you configure, and it must name the host the connection URL names. |

### What each side owns

Courtside owns the inputs and what they enforce: it reads your authority file, refuses to start when
that file is missing, unreadable or holds no certificate, refuses to start when the connection URL
or the pool carries something that would decide the transport instead, and turns an unknown,
expired, not-yet-valid or wrong-name certificate into a sentence rather than a stack trace.

You own the rest: which authority issues the certificate, how it is issued, where the private key
lives, how long it is valid, when it is renewed, how it is revoked and what you do when it is lost.
Courtside ships no authority and generates no production key material.

There are two overlays, because the application requiring a certificate and this deployment's own
database serving one are separate decisions.

### Requiring a verified connection

`compose.database-tls.yaml` mounts your authority into the application read-only and pins the mode.
Name the directory that holds it in `.env`, and call the file inside it `authority.pem`:

```
COURTSIDE_DB_TLS_AUTHORITY=/srv/courtside/tls/authority
```

A directory rather than the file itself, because a bind mount of a single file pins the inode it had
when the container started: renewal that writes a new file and renames it over the old one — which
is what most renewal does — would leave the container reading the file it first saw.

Put nothing else in that directory. The application container can read everything it holds, and the
one thing the application needs is the authority. A private key kept beside it — the database's
own, for instance — would be readable by whatever a flaw in the application can be made to read,
and whoever holds the database's key can be the database.

```bash
docker compose -f compose.yaml -f compose.database-tls.yaml up -d
```

That is the application's side of a database somewhere else. Pointing it at that host is a change
to `compose.yaml` itself and not a line in `.env`: `SPRING_DATASOURCE_URL` is set literally there,
and the `app` service waits for the local `db` service through `depends_on`. Edit both, and drop
the `db` service if this host no longer runs one. The certificate that host serves has to name the
host the URL names.

Do not put an `ssl` or `gssEncMode` argument, or a `service` name, in that URL, and do not set one
as a driver property on the pool. Each decides the transport behind the verification — a URL
argument beats the pool's own configuration, a service name pulls in a file of properties, and GSS
encryption is negotiated before TLS is — so the application refuses to start rather than let one
quietly undo it.

### Making this deployment's own database serve one

`compose.database-tls-local.yaml` adds the server side. Issue a certificate whose subject
alternative name includes `DNS:db` — `db` is the name the application connects to on the compose
network, and `verify-full` checks exactly that name. Name the pair in `.env`:

```
COURTSIDE_DB_TLS_CERTIFICATE=/srv/courtside/tls/server/server.crt
COURTSIDE_DB_TLS_KEY=/srv/courtside/tls/server/server.key
```

```bash
docker compose -f compose.yaml -f compose.database-tls.yaml -f compose.database-tls-local.yaml up -d
```

Both files are mounted read-only, and the overlay installs the key where only root writes under the
ownership PostgreSQL insists on. Keep the key at `0600` on the host, outside the directory the
application mounts; nothing but the database ever needs to read it.

### Renewal

Replacing `authority.pem` inside that directory takes effect for the next connection the pool opens,
without a restart; connections already open keep running until the pool recycles them. A refusal
after a replacement is a refusal, never a fallback to plaintext. Replacing the database's own
certificate and key means restarting the `db` service, because the server reads them once at start.

A certificate that expires while the instance is running is not diagnosed the way one that is wrong
at startup is. The diagnosis is written when the application starts; a pool that later fails to
reconnect reports the driver's own error in the log.

## Environment variables

These are a published surface: renaming one is a breaking change, and every optional variable has a
default.

| Variable | Default | Meaning |
|---|---|---|
| `COURTSIDE_VERSION` | *required* | The release to run, optionally with `@sha256:…`. Pin it. |
| `POSTGRES_PASSWORD` | *required* | Database password, used only between the containers. |
| `COURTSIDE_DB_LOCK_TIMEOUT` | `5s` | Maximum time a database operation waits for a conflicting row or advisory lock. A refusal is returned as a retryable `503`; increase this only after diagnosing legitimate contention. Accepted range: `1s` to `1m`. |
| `COURTSIDE_DB_TLS_MODE` | `prefer` | What the connection to PostgreSQL guarantees: `prefer`, `disable` or `verify-full`. See *Encrypting the connection to the database*. |
| `COURTSIDE_DB_TLS_AUTHORITY` | *required with `compose.database-tls.yaml`* | Host directory holding `authority.pem`, the certificate authority that issued the database's certificate, and nothing else. The application container reads everything in it. |
| `COURTSIDE_DB_TLS_ROOT_CERTIFICATE` | *unset* | Path **inside the container** to that authority certificate. `compose.database-tls.yaml` sets it to `/etc/courtside/database-tls/authority.pem`; set it yourself only when running the image without that overlay. |
| `COURTSIDE_DB_TLS_CERTIFICATE` | *required with `compose.database-tls-local.yaml`* | Host path to the certificate this deployment's own database serves. Its subject alternative name has to include `DNS:db`. |
| `COURTSIDE_DB_TLS_KEY` | *required with `compose.database-tls-local.yaml`* | Host path to the private key belonging to that certificate. |
| `COURTSIDE_BOOTSTRAP_ADMIN_USERNAME` | *required on an empty account table* | Username of the first local administrator. |
| `COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD` | *required on an empty account table* | One-time password, at least 12 characters. |
| `COURTSIDE_BOOTSTRAP_ADMIN_DISPLAY_NAME` | *required on an empty account table* | First and last name of the first administrator. |
| `COURTSIDE_DOMAIN` | *required with the proxy* | The public name Caddy obtains a certificate for. |
| `COURTSIDE_MAIL_DOMAIN` | *required with the mail server* | The domain Courtside sends from, and the domain SPF, DKIM and DMARC are published for. |
| `COURTSIDE_MAIL_HOSTNAME` | *required with the proxy and with the mail server* | The mail server's own name. Its forward and reverse DNS must agree, and Caddy obtains a certificate for it, so it must point at this host. **Running the proxy without this deployment's mail server?** Delete that site block from `Caddyfile` and the variable's line from the `proxy` service — Caddy would otherwise retry forever for a name it cannot prove, and Compose would refuse to start without a value. The rest of the proxy is unaffected. |
| `COURTSIDE_MAIL_DKIM_SELECTOR` | *required with the mail server* | The selector of the DKIM key the setup wizard generated, as it appears in the admin interface. |
| `COURTSIDE_MAIL_ADMIN_PASSWORD` | *required with the mail server* | Password for the club's mail administrator, written into the account by `mail-configure`. |
| `COURTSIDE_MAIL_SETUP_PASSWORD` | *required with the mail server* | Password the setup commands authenticate with while the server still has no accounts. Pair it with `COURTSIDE_MAIL_RECOVERY_ADMIN`. |
| `COURTSIDE_MAIL_ADMIN_USERNAME` | `postmaster` | Local part of the mail administrator's address. |
| `COURTSIDE_MAIL_RECOVERY_MODE` | *unset* | Set to `1` to force recovery mode without a recovery credential. Mail stops while it is set. |
| `COURTSIDE_MAIL_PASSWORD` | *required with the mail server* | Password the instance authenticates with when it hands a message in. Written into its sending account by `mail-configure`; the instance is not an administrator of the mail server. |
| `COURTSIDE_MAIL_RELOAD_PASSWORD` | *required with the mail server* | Password `mail-reload` authenticates with to load a renewed certificate. Written into an account whose only permission is that reload. |
| `COURTSIDE_MAIL_RELOAD_USERNAME` | `certificate-reload` | Local part of that account's address. |
| `COURTSIDE_MAIL_CERTIFICATE_REMAINING_SHARE` | `6` | `mail-reload` reports unhealthy once less than this share of the certificate's own lifetime is left. Relative rather than a number of days, so it means the same for a ninety-day certificate and a twelve-hour one. Caddy renews at a third of the lifetime, so a sixth leaves the renewal a full window of its own to fail in first. |
| `COURTSIDE_MAIL_CERTIFICATE_CHECK_INTERVAL` | `3600` | Seconds between two read-backs of what the mail server holds. A swap wakes `mail-reload` immediately; this is what notices a certificate that expires with no swap to announce it, so it bounds how long a problem can stay invisible. |
| `COURTSIDE_MAIL_CERTIFICATE_MAXIMUM_LIFETIME` | `34560000` | Seconds. A loaded certificate valid for longer than this is not one an authority issued — the mail server's own fallback runs to the year 4096 — and `mail-reload` reports unhealthy rather than accepting it. 400 days is the longest any public authority issues for. |
| `COURTSIDE_MAIL_REPLY_TO` | *required with the mail server* | The club's real mailbox, so a member who answers a message reaches somebody. |
| `COURTSIDE_MAIL_SENDER_USERNAME` | `courtside` | Local part of the address the instance sends from and authenticates as, in `COURTSIDE_MAIL_DOMAIN`. |
| `COURTSIDE_MAIL_RELAY_HOST` | `COURTSIDE_MAIL_HOSTNAME` | Where the instance hands its messages in. The mail server on the compose network by default, reached under the name on its certificate rather than under the service name, because the instance authenticates what answers. Point it at the club's provider instead if this deployment runs without one. |
| `COURTSIDE_MAIL_RELAY_PORT` | `587` | Submission port on that host. |
| `COURTSIDE_MAIL_TRUST_RELAY_CERTIFICATE` | `false` | Accept the certificate the relay presents without authenticating it — neither its issuer nor the name on it. Nothing here needs it: the mail server serves Caddy's certificate for `COURTSIDE_MAIL_HOSTNAME` and the instance dials exactly that name. Set it only for a relay whose certificate the instance cannot check, such as one issued by a private authority the container does not hold, and know that whoever can redirect the connection then reads the mail. |
| `COURTSIDE_MAIL_ADMIN_PORT` | `8081` | Host port on the loopback interface for the mail server's admin interface. |
| `COURTSIDE_MAIL_RECOVERY_ADMIN` | *unset* | Temporary credential for the mail server's administrator, as `admin:<password>`. Needed for the initial setup, and a way back in afterwards. **The server serves no mail while it is set.** |
| `COURTSIDE_MAIL_OUTBOUND_PROBE` | `gmail-smtp-in.l.google.com` | The host `mail-check` opens port 25 to when testing whether outbound mail leaves at all. A third party by default; point it at a server of your own if you would rather not tell one. |
| `COURTSIDE_MAIL_RELAY_PROBE` | `relay-probe.example.com` | The foreign domain `mail-check` asks this instance to relay for, to prove it refuses. |
| `COURTSIDE_MAIL_RELAY_TARGET` | `mail` | Where the relay test connects. The service on the compose network by default, because a host seldom reaches its own published port from inside a container. |
| `COURTSIDE_MAIL_MEMORY` | `512m` | Memory ceiling for the mail server, which is the one container taking unauthenticated traffic from the internet. |
| `COURTSIDE_MEMORY` | `1g` | Memory ceiling for the application container. |
| `COURTSIDE_COOKIE_SECURE` | `true` | Forces host-bound `__Host-SESSION` and `__Host-XSRF-TOKEN` cookies with `Secure` and `Path=/`. Lower it only for local development or a controlled test environment; production refuses to start. HTTPS requests still receive the host-bound policy, while a plain HTTP request then uses the explicit `SESSION` / `XSRF-TOKEN` test names without `Secure`. |
| `COURTSIDE_LOGIN_ADDRESS_MAX_FAILURES` | `20` | Login attempts allowed per source address and window. |
| `COURTSIDE_LOGIN_ADDRESS_WINDOW` | `1m` | Counting window for a source address. |
| `COURTSIDE_LOGIN_ADDRESS_BLOCK` | `1m` | Temporary source-address block duration. |
| `COURTSIDE_LOGIN_VERIFICATION_CONCURRENCY` | `2` | Maximum simultaneous password verifications. Further attempts receive `429` with `Retry-After: 1` and may retry as soon as capacity is free. |
| `COURTSIDE_LOGIN_GLOBAL_THRESHOLD` | `100` | Observed instance-wide login attempts per window before `courtside.login.distributed.thresholds` is incremented and one privacy-safe warning is written. It does not block sign-in. |
| `COURTSIDE_LOGIN_GLOBAL_WINDOW` | `1m` | Window for the instance-wide diagnostic threshold. |
| `COURTSIDE_CREDENTIAL_ISSUE_MAX_PER_WINDOW` | `5` | How often credentials may be requested for one account within the window. It counts requests, not deliveries: a request whose handover fails still spends one. Counted per account, because the account is what a filled mailbox targets; a board sending twice in a row is nowhere near it. |
| `COURTSIDE_CREDENTIAL_ISSUE_WINDOW` | `1h` | Counting window for one account's credentials. |
| `COURTSIDE_CREDENTIAL_ISSUE_RETENTION` | `24h` | How long a counting row is kept after its window started, before the hourly cleanup deletes it. |
| `COURTSIDE_OTLP_ENABLED` | `false` | Exports traces and metrics over OTLP/HTTP when enabled. Keep disabled until both collector endpoints are reachable from the application container. |
| `COURTSIDE_OTLP_TRACES_ENDPOINT` | `http://localhost:4318/v1/traces` | Complete OTLP/HTTP trace endpoint. Set a container-network hostname when the collector runs in another container. |
| `COURTSIDE_OTLP_METRICS_ENDPOINT` | `http://localhost:4318/v1/metrics` | Complete OTLP/HTTP metrics endpoint. |
| `COURTSIDE_TRACING_SAMPLING_PROBABILITY` | `0.1` | Share of new traces sampled, from `0.0` to `1.0`. Parent sampling decisions are retained. |
| `COURTSIDE_SESSION_CLEANUP_CRON` | `0 * * * * *` | How often sign-in sessions that are over are deleted from `spring_session`, as a Spring cron expression. It covers both ways of being over: past the inactivity window, and past `COURTSIDE_SESSION_ABSOLUTE_LIFETIME`, whose bound the stored expiry does not carry. A session already stops working the moment it expires; this is what stops its row and the attributes cascading from it from being kept. The cleanup cannot be switched off: `-`, which Spring Session reads as *never*, is refused at startup. |
| `COURTSIDE_SESSION_INACTIVITY_TIMEOUT` | `30m` | How long a sign-in survives without a request. This is the window a member notices: it restarts with every request, so an active session is never interrupted by it. At least one minute, the same floor `COURTSIDE_SESSION_ABSOLUTE_LIFETIME` is held to; below that it is refused at startup. A negative value is not merely short — Spring Session reads it as an interval that never expires. Stated here rather than inherited, because an unset value is whatever the framework defaults to and that can change under an installation. |
| `COURTSIDE_SESSION_ABSOLUTE_LIFETIME` | `24h` | How long a sign-in may live at all, counted from when it began and not restarted by activity. A session past it is ended on its next request and the member signs in again, however busy the session was — the sign-in itself is never what gets refused. The count survives a restart, because it is stored with the session rather than held in memory. It runs from the sign-in, which starts a session of its own even when the browser already carried one, so nobody inherits what a previous sign-in on that browser already spent. At least one minute and at most 30 days; outside that it is refused at startup. It may not be shorter than `COURTSIDE_SESSION_INACTIVITY_TIMEOUT`; that combination is refused at startup, because the inactivity window could then never be reached and setting it would say nothing. |
| `COURTSIDE_SESSION_MAX_CONCURRENT` | `5` | How many sign-ins one account may hold at the same time — a phone, a tablet and a club laptop are three of them. A further sign-in is not refused: it succeeds and the account's least recently active session is ended instead — or sessions, if simultaneous sign-ins had pushed the count past the limit — so nobody is locked out by a device they cannot reach. Sign-ins arriving at the same moment can pass it, because each reads the count before the others are stored. Between 1 and 50; outside that it is refused at startup, because a limit no account reaches is the policy switched off while the variable still reads as if it were set. |
| `COURTSIDE_IMPORT_MAX_FILE_SIZE` | `8MB` | Largest roster snapshot an upload may carry. An upload above it is answered `413` with a problem document rather than a container error page. |
| `COURTSIDE_IMPORT_PREVIEW_RETENTION` | `7d` | How long a roster-import preview keeps the change set it resolved. The uploaded file itself is never kept — only its SHA-256. Past this bound the row, the file's name and hash and the counts survive, and the change set does not. At most 30 days. |
| `COURTSIDE_IMPORT_SWEEP_INTERVAL` | `1h` | How often previews past their retention are swept, between a minute and a day. The sweep drops the resolved change set and the person fingerprints, and keeps the row, the file's name and hash, and the counts. |
| `COURTSIDE_SLOW_QUERY_THRESHOLD_MS` | `500` | Logs Hibernate queries slower than this threshold in milliseconds. Bind values are not logged. |
| `COURTSIDE_LOG_LEVEL` | `INFO` | Log level of the application's ordinary loggers. `DEBUG` adds an `Answering` line for every error one of its exception handlers answers. The security-event logger remains at `INFO`, so changing this setting cannot silently remove its successful authentication, session, credential or administrative events. |
| `COURTSIDE_PORT` | `8080` | Host port on the loopback interface. |
| `COURTSIDE_SOURCE_URL` | required | The absolute HTTP or HTTPS address without embedded credentials returned by `GET /api/source`. Point an unchanged installation here and a modified fork at the corresponding source for that fork. Compose refuses to start without this choice. |
| `COURTSIDE_ENVIRONMENT` | `PRODUCTION` | Public environment designation: `PRODUCTION`, `UAT`, `DEVELOPMENT` or `PERFORMANCE`. UAT is visibly marked in the frontend. |
| `COURTSIDE_CLOCK_FIXED_INSTANT` | *unset* | Freezes the clock at an ISO-8601 instant so an automated suite reads the same date on every run. A club never sets this: the instance starts with it only while `COURTSIDE_ENVIRONMENT` names `UAT`, `DEVELOPMENT` or `PERFORMANCE`, so a misspelt designation refuses rather than unlocks. |

`COURTSIDE_LOGIN_GLOBAL_MAX_FAILURES` and `COURTSIDE_LOGIN_GLOBAL_BLOCK` are no longer read. The
renewable whole-instance cooldown they configured was removed; use the diagnostic threshold and
verification concurrency settings above instead.

`SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD` are set by
`compose.yaml`. Point them elsewhere if you run PostgreSQL outside Compose; the application needs
PostgreSQL 17 and will not run on anything else.

## Diagnose slow requests and queries

Enable OTLP export only after a collector is reachable. Standard Spring HTTP, JVM and HikariCP
metrics then identify the affected endpoint and resource pressure. Courtside additionally exports
the counters `courtside.bookings.created`, `courtside.bookings.rejected` and
`courtside.bookings.conflicts`, plus `courtside.login.distributed.thresholds` when the configured
global login observation threshold is crossed. Rejected bookings carry only the stable rule code as
a tag; the login counter has no identifying tags.

Hibernate writes queries above `COURTSIDE_SLOW_QUERY_THRESHOLD_MS` to the structured application
log. The statement retains placeholders instead of bind values, and a sampled request adds its
`traceId` and `spanId` to the same entry. Find the slow HTTP span in the tracing backend, then search
the application log for that trace ID to identify the parameterised statement. Lower the threshold
temporarily when investigating and restore it afterwards because a low value increases log volume.

The example `http://` OTLP endpoints are safe only on a trusted local container network. A remote
collector must use HTTPS and authentication. Supply credentials through the deployment's secret
management using Spring's
`MANAGEMENT_OPENTELEMETRY_TRACING_EXPORT_OTLP_HEADERS_AUTHORIZATION` and
`MANAGEMENT_OTLP_METRICS_EXPORT_HEADERS_AUTHORIZATION` environment variables; never commit tokens
to `.env`. The collector and its retention policy remain the operator's responsibility.

Courtside's security events use the stable catalogue described in
[`docs/security-events.md`](../docs/security-events.md) and remain in the same ECS standard-output
stream. Docker logging drivers, sidecars and collectors are optional ways to route that stream; the
reference deployment makes no synchronous external delivery call and does not assert that a
destination accepted an event. Operators remain responsible for choosing a logging configuration
whose outage behavior cannot block requests, as well as storage, access, retention and alert
thresholds for the installation.

## When a member reports an error

An error a member causes leaves no `Answering` line at `INFO`: the handler that answers the request
says nothing about it. A failure on the instance's own side is louder — a 5xx at `WARN`, with the
exception attached because that is an incident and not a member's mistake, and an error no handler
claims at `ERROR` — but a member's mistake stays invisible until you lower the level.
Set `COURTSIDE_LOG_LEVEL=DEBUG` in `.env`, run `docker compose up -d app`, and ask the member to
repeat what they did. Every error one of the application's exception handlers answers then adds one
entry. The log is JSON, so `docker compose logs app | grep Answering` is the quickest way to read
them. Each line names the status and the problem type — the same `type` URN the member's error
carries, so the line and the response share one token to search on — and then whatever that
response holds beyond it: the violation code and its parameters where it reports one, the names of
the request fields where validation rejected them, and nothing where the response adds nothing to
say. That is enough to tell a member's mistake from the instance's. Restore the level and restart
once you have what you need.

Signing in and authorization decisions use the separate security-event inventory at every ordinary
application log level. Search for `"logger":"org.courtside.security.events"` and select the stable
`event.code`, `event.reason` or `event.action`; the records deliberately contain no submitted
username, address, credential or request body. A rejected request still carries the member-facing
detail — including its problem `type` and a rate limit's `Retry-After` — while the event supplies
the privacy-safe operational correlation.

`DEBUG` is for diagnosis and not a level to run a club on. It is loud, it pushes the record of
everything else out of the rotated log files sooner, and every line it adds is one more line to keep
private. What it does not add is anyone's data. Every line it adds is built from the response the
handler is about to return, never from the exception's message, which is free text a throw site
may have assembled from what the request submitted. A line can therefore hold nothing the member
on the other end has not already been shown, which leaves out a name, an address and a rejected
password alike. Tests drive each place such a value is known to arrive — a failed validation, a
body the JSON parser could not read, a constraint the database rejected, and a domain failure
whose own message names what it turned down — and assert that it stays out of the line.

## Upgrading

Raise `COURTSIDE_VERSION`, then — with the reverse proxy:

```sh
docker compose pull app
docker compose --profile proxy up -d
```

or, on the Funnel path, the same two commands without `--profile proxy`. Leaving the profile out
of the second command would stop Caddy.

Migrations run on startup and support skipping versions, so an instance that has not been updated
for a year goes to the current release directly. Read the release notes first: every release opens
with upgrade notes, names the database versions exercised by the release gate, and identifies any
change to a published surface. If startup rejects a migration, do not attempt to reverse Flyway or
edit an applied migration. Keep the application stopped and restore the pre-upgrade backup.

Back up before an upgrade. The database holds everything; the containers hold nothing:

```sh
set -eu
umask 077
temporary=$(mktemp "./.courtside-$(date -u +%Y%m%dT%H%M%SZ).XXXXXX.partial")
backup=${temporary#./.}
backup=${backup%.partial}.dump
trap 'rm -f "$temporary"' EXIT
docker compose exec -T db pg_dump -Fc --no-owner -U courtside courtside > "$temporary"
docker compose exec -T db pg_restore --list < "$temporary" > /dev/null
mv "$temporary" "$backup"
trap - EXIT
echo "Backup written to $backup"
```

Treat the archive, the matching Courtside image reference and the `.env` configuration as one
versioned recovery unit. Test the archive on a separate empty PostgreSQL 17 instance. With the
application stopped, restore it atomically:

```sh
docker compose stop app
docker compose exec -T db pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error -U courtside -d courtside < courtside-YYYY-MM-DD.dump
docker compose up -d app
```

If `pg_restore` fails, keep the application stopped. Do not serve traffic from a partially restored
database and do not combine the archive with an image or configuration from a different release.

## Image updates between releases

Every image `compose.yaml` names other than Courtside itself — `postgres:17-alpine`,
`caddy:2-alpine`, `stalwartlabs/stalwart` and `alpine:3` — is pinned by digest, not by floating tag,
so `docker compose pull` alone will never change them. That is deliberate: a club's database, its
reverse proxy and its mail server should not change without anyone deciding they should. It also
means the digests do not update themselves. Dependabot opens a pull request against this repository
when one of them gets a new patch release; a maintainer bumping the digest here is how it reaches
your instance — take the updated `compose.yaml` and run `docker compose up -d` to apply it.
Until then, you can raise it yourself: look up the current tag's digest with
`docker buildx imagetools inspect postgres:17-alpine` (or any of the others) and replace the
`@sha256:…` suffix in `compose.yaml`.

## One setting to review for your domain

- `Strict-Transport-Security` carries `includeSubDomains`. If `COURTSIDE_DOMAIN` is your club's
  apex domain rather than a subdomain, that forces HTTPS on every other subdomain you own,
  including a club website that may still speak plain HTTP.

Configure the club logo with a root-relative path served by this instance where possible. A remote
logo must use HTTPS and discloses each visitor's IP address and the Courtside origin to its host.

## What this deployment does not solve yet

- **No collector is included.** Courtside can export metrics and traces over OTLP and emits ECS
  application and security logs to standard output, but routing, operating, securing and retaining
  telemetry remains the operator's responsibility.
- **Inbound mail arrives and nothing reads it.** Port 25 is open so bounces and DMARC reports
  reach the instance rather than vanishing, but nothing acts on them. The instance records that it
  handed a message to this server and learns nothing after that, so a bounce arriving here
  afterwards is the answer nobody reads — and DMARC reports have no reader either.
- **A reload the mail server refuses leaves it serving a certificate it generated itself.**
  Stalwart 0.16.20 does not keep the pair it had when a reload fails: it answers `notCreated`, drops
  the certificate, and the listener falls back to a self-signed one valid from 1975 to 4096. Nothing
  about the fallback is silent here — the reload stays owed until one is accepted, so `mail-reload`
  names the refusal, retries it, and stays unhealthy while it is owed — and the instance stops
  handing messages over rather than handing them to something it cannot authenticate. That is
  visible in two places, neither of them a queue: `mail-reload` stays unhealthy, and every message
  settles `FAILED` with its reason in the admin message list. Repairing the pair resends none of
  them; the events still outstanding are replayed when `app` restarts, and a replayed credential is
  a new one, because the first exists only as a hash. Nothing undoes the fallback either, short of
  fixing the pair and reloading again. What bounds it is that `mail-certificate` swaps `current`
  only after Caddy has validated the pair behind it, so a reload is asked for a pair that has
  already been read once.
- **MTA-STS and DANE are not provided.** Neither is published, and neither is planned by this
  work.
