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
docker compose --profile mail up -d mail
docker compose --profile mail-setup run --rm mail-bootstrap
docker compose --profile mail restart mail
docker compose --profile mail-setup run --rm mail-configure
docker compose --profile mail up -d --force-recreate mail
```

Two applies with a restart between them, because the first one answers the questions the wizard
would have asked — hostname, domain, whether to generate DKIM keys — and the server only leaves
setup mode on the next start. The second one loads the listeners, the delivery routes and the
administrator account.

Before the first command, `.env` needs four values: `COURTSIDE_MAIL_HOSTNAME`,
`COURTSIDE_MAIL_DOMAIN`, `COURTSIDE_MAIL_ADMIN_PASSWORD` for the club's mail administrator, and
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
| `COURTSIDE_MAIL_PASSWORD` | The account the instance authenticates as | Permanent, and not an administrator. It may send and nothing else. |

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
- **There is no ACME here.** Caddy is this deployment's only certificate client and it issues for
  `COURTSIDE_DOMAIN`, not for `COURTSIDE_MAIL_HOSTNAME`, so the mail server serves a self-signed
  certificate on port 25. For inbound STARTTLS that is the ordinary state of affairs between mail
  servers; it becomes a real gap the day you want MTA-STS or DANE.
  [#755](https://github.com/jegr78/courtside/issues/755) decides where that certificate comes from.

### What DNS has to say before anyone believes this server

Six records, all published by you, none of them optional if the mail is to arrive:

| Record | Where | Why |
|---|---|---|
| `A` / `AAAA` | `COURTSIDE_MAIL_HOSTNAME` | The address the server sends from. |
| `PTR` | that address, **at your hosting provider only** | Receivers reject a host whose reverse name disagrees with its forward one. |
| `MX` | `COURTSIDE_MAIL_DOMAIN` | Where bounces and DMARC reports come back to. |
| `SPF`, a `TXT` record | `COURTSIDE_MAIL_DOMAIN` | Names this host as allowed to send, ending in `-all`. |
| `DKIM`, a `TXT` record | `<selector>._domainkey.<domain>` | The public half of the key Stalwart signs with. |
| `DMARC`, a `TXT` record | `_dmarc.<domain>` | What a receiver should do when the first two disagree. |

Three of them have a catch that costs an evening if nobody says it first:

- **`PTR` is not yours to publish.** It lives in the reverse zone of whoever owns the address, which
  is your hosting provider — a field in their control panel, or a support request, and some ask why.
  A missing or generic reverse name is the single most common reason a small machine's mail is
  refused outright rather than filed as spam, and no amount of SPF and DKIM makes up for it.
- **`DKIM` names a selector you do not choose.** Stalwart generates its own key and shows the
  selector in the admin interface; `COURTSIDE_MAIL_DKIM_SELECTOR` follows it rather than setting it.
  The key lives in the `mail-config` volume, so losing that volume means a new key, a new selector
  and a new record — see the backup section below.
- **`DMARC` is a policy, and starting strict punishes you, not a forger.** Publish
  `v=DMARC1; p=none; rua=mailto:<a mailbox you read>` first, leave it there long enough to read the
  reports it brings, and tighten to `p=quarantine` and then `p=reject` once they show your own mail
  passing. `mail-check` accepts any valid record here on purpose: which policy is right is a
  question about your domain, not about this deployment.

A seventh thing is not DNS and is the one that most often ends the exercise: **most hosting
providers block outbound port 25** until you ask them to unblock it, and some never will. Find out
before a member depends on it rather than after — `mail-check` below opens a connection to a public
MX and tells you in one line, and it costs nothing to run on the day the instance is installed.

If the answer is no, the mail still has somewhere to go: give the server a relay host under
*MTA → Outbound → Routes* in the admin interface — the club's provider, or any server that will
accept authenticated submission — and point the outbound routing strategy at it. That route is
configured in the interface and not in `.env`: **no environment variable carries it**, and
`COURTSIDE_MAIL_RELAY_HOST` is a different hop, the one the application uses to hand a message to
this server. Delivery straight to the recipient is what this deployment does by default, not what it
requires.

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

One thing the run does differently on purpose: it issues itself a throwaway authority and installs
a certificate for the mail hostname, where your instance serves the self-signed one it generated.
That is what lets the run validate the handshake instead of accepting whatever it is handed, and it
is the single point at which the smoke world and your world differ.

### The test that counts is a message that arrived somewhere else

Everything above happens on your own machine and can pass while the receiving world still refuses
you. Send one real message to a mailbox you hold at a large provider — put that address on your own
administrator account and have the instance issue a credential to it — then open the received
message and read its full source. The header to find is `Authentication-Results`, written
by the receiver and not by you:

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

The backup below covers PostgreSQL. `mail-config` holds the private DKIM key and the mail server's
credentials, and it is not in it. Losing it means generating a new key and publishing a new selector;
leaking it means somebody can sign mail as your domain until you notice. Include both mail volumes
in whatever backs this host up, and treat `mail-config` as a secret when you do.

### When the mail administrator password is lost

Set `COURTSIDE_MAIL_RECOVERY_ADMIN` to `admin:${COURTSIDE_MAIL_SETUP_PASSWORD}` and restart the
`mail` service, then sign in as `admin`. Any password works to sign in, but the setup commands read
that one variable, so choosing anything else means they can no longer authenticate. **The server stops accepting and delivering mail while that variable is set** — it
runs in recovery mode and serves only its admin port. Clear it and recreate the container once you
are back in.

To change the administrator password instead, edit `COURTSIDE_MAIL_ADMIN_PASSWORD` and run
`mail-configure` again: the plan upserts the account, so it reconciles rather than duplicates.


## Environment variables

These are a published surface: renaming one is a breaking change, and every optional variable has a
default.

| Variable | Default | Meaning |
|---|---|---|
| `COURTSIDE_VERSION` | *required* | The release to run, optionally with `@sha256:…`. Pin it. |
| `POSTGRES_PASSWORD` | *required* | Database password, used only between the containers. |
| `COURTSIDE_DB_LOCK_TIMEOUT` | `5s` | Maximum time a database operation waits for a conflicting row or advisory lock. A refusal is returned as a retryable `503`; increase this only after diagnosing legitimate contention. Accepted range: `1s` to `1m`. |
| `COURTSIDE_BOOTSTRAP_ADMIN_USERNAME` | *required on an empty account table* | Username of the first local administrator. |
| `COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD` | *required on an empty account table* | One-time password, at least 12 characters. |
| `COURTSIDE_BOOTSTRAP_ADMIN_DISPLAY_NAME` | *required on an empty account table* | First and last name of the first administrator. |
| `COURTSIDE_DOMAIN` | *required with the proxy* | The public name Caddy obtains a certificate for. |
| `COURTSIDE_MAIL_DOMAIN` | *required with the mail server* | The domain Courtside sends from, and the domain SPF, DKIM and DMARC are published for. |
| `COURTSIDE_MAIL_HOSTNAME` | *required with the mail server* | The mail server's own name. Its forward and reverse DNS must agree. |
| `COURTSIDE_MAIL_DKIM_SELECTOR` | *required with the mail server* | The selector of the DKIM key the setup wizard generated, as it appears in the admin interface. |
| `COURTSIDE_MAIL_ADMIN_PASSWORD` | *required with the mail server* | Password for the club's mail administrator, written into the account by `mail-configure`. |
| `COURTSIDE_MAIL_SETUP_PASSWORD` | *required with the mail server* | Password the setup commands authenticate with while the server still has no accounts. Pair it with `COURTSIDE_MAIL_RECOVERY_ADMIN`. |
| `COURTSIDE_MAIL_ADMIN_USERNAME` | `postmaster` | Local part of the mail administrator's address. |
| `COURTSIDE_MAIL_RECOVERY_MODE` | *unset* | Set to `1` to force recovery mode without a recovery credential. Mail stops while it is set. |
| `COURTSIDE_MAIL_PASSWORD` | *required with the mail server* | Password the instance authenticates with when it hands a message in. Written into its sending account by `mail-configure`; the instance is not an administrator of the mail server. |
| `COURTSIDE_MAIL_REPLY_TO` | *required with the mail server* | The club's real mailbox, so a member who answers a message reaches somebody. |
| `COURTSIDE_MAIL_SENDER_USERNAME` | `courtside` | Local part of the address the instance sends from and authenticates as, in `COURTSIDE_MAIL_DOMAIN`. |
| `COURTSIDE_MAIL_RELAY_HOST` | `mail` | Where the instance hands its messages in. The mail server on the compose network by default; point it at the club's provider instead if this deployment runs without one. |
| `COURTSIDE_MAIL_RELAY_PORT` | `587` | Submission port on that host. |
| `COURTSIDE_MAIL_TRUST_RELAY_CERTIFICATE` | `true` in this deployment, `false` in the application | Accept the certificate the relay presents without authenticating it — neither its issuer nor the name on it. Set because Caddy issues for `COURTSIDE_DOMAIN` and not for the mail server, which generates its own naming `localhost` alone. Clear it when you point `COURTSIDE_MAIL_RELAY_HOST` at a provider that has a real one. |
| `COURTSIDE_MAIL_ADMIN_PORT` | `8081` | Host port on the loopback interface for the mail server's admin interface. |
| `COURTSIDE_MAIL_RECOVERY_ADMIN` | *unset* | Temporary credential for the mail server's administrator, as `admin:<password>`. Needed for the initial setup, and a way back in afterwards. **The server serves no mail while it is set.** |
| `COURTSIDE_MAIL_OUTBOUND_PROBE` | `gmail-smtp-in.l.google.com` | The host `mail-check` opens port 25 to when testing whether outbound mail leaves at all. A third party by default; point it at a server of your own if you would rather not tell one. |
| `COURTSIDE_MAIL_RELAY_PROBE` | `relay-probe.example.com` | The foreign domain `mail-check` asks this instance to relay for, to prove it refuses. |
| `COURTSIDE_MAIL_RELAY_TARGET` | `mail` | Where the relay test connects. The service on the compose network by default, because a host seldom reaches its own published port from inside a container. |
| `COURTSIDE_MAIL_MEMORY` | `512m` | Memory ceiling for the mail server, which is the one container taking unauthenticated traffic from the internet. |
| `COURTSIDE_MEMORY` | `1g` | Memory ceiling for the application container. |
| `COURTSIDE_COOKIE_SECURE` | `true` | Sends the session cookie over HTTPS only. Lower it only for a local test. |
| `COURTSIDE_LOGIN_ADDRESS_MAX_FAILURES` | `20` | Login attempts allowed per source address and window. |
| `COURTSIDE_LOGIN_ADDRESS_WINDOW` | `1m` | Counting window for a source address. |
| `COURTSIDE_LOGIN_ADDRESS_BLOCK` | `1m` | Temporary source-address block duration. |
| `COURTSIDE_LOGIN_GLOBAL_MAX_FAILURES` | `100` | Login attempts allowed across the instance and window. |
| `COURTSIDE_LOGIN_GLOBAL_WINDOW` | `1m` | Instance-wide counting window. |
| `COURTSIDE_LOGIN_GLOBAL_BLOCK` | `1m` | Instance-wide login cooldown duration. |
| `COURTSIDE_CREDENTIAL_ISSUE_MAX_PER_WINDOW` | `5` | How often credentials may be requested for one account within the window. It counts requests, not deliveries: a request whose handover fails still spends one. Counted per account, because the account is what a filled mailbox targets; a board sending twice in a row is nowhere near it. |
| `COURTSIDE_CREDENTIAL_ISSUE_WINDOW` | `1h` | Counting window for one account's credentials. |
| `COURTSIDE_CREDENTIAL_ISSUE_RETENTION` | `24h` | How long a counting row is kept after its window started, before the hourly cleanup deletes it. |
| `COURTSIDE_OTLP_ENABLED` | `false` | Exports traces and metrics over OTLP/HTTP when enabled. Keep disabled until both collector endpoints are reachable from the application container. |
| `COURTSIDE_OTLP_TRACES_ENDPOINT` | `http://localhost:4318/v1/traces` | Complete OTLP/HTTP trace endpoint. Set a container-network hostname when the collector runs in another container. |
| `COURTSIDE_OTLP_METRICS_ENDPOINT` | `http://localhost:4318/v1/metrics` | Complete OTLP/HTTP metrics endpoint. |
| `COURTSIDE_TRACING_SAMPLING_PROBABILITY` | `0.1` | Share of new traces sampled, from `0.0` to `1.0`. Parent sampling decisions are retained. |
| `COURTSIDE_SESSION_CLEANUP_CRON` | `0 * * * * *` | How often expired sign-in sessions are deleted from `spring_session`, as a Spring cron expression. A session already stops working the moment it expires; this is what stops its row and the attributes cascading from it from being kept. The cleanup cannot be switched off: `-`, which Spring Session reads as *never*, is refused at startup. |
| `COURTSIDE_IMPORT_MAX_FILE_SIZE` | `8MB` | Largest roster snapshot an upload may carry. An upload above it is answered `413` with a problem document rather than a container error page. |
| `COURTSIDE_IMPORT_PREVIEW_RETENTION` | `7d` | How long a roster-import preview keeps the change set it resolved. The uploaded file itself is never kept — only its SHA-256. Past this bound the row, the file's name and hash and the counts survive, and the change set does not. At most 30 days. |
| `COURTSIDE_IMPORT_SWEEP_INTERVAL` | `1h` | How often previews past their retention are swept, between a minute and a day. The sweep drops the resolved change set and the person fingerprints, and keeps the row, the file's name and hash, and the counts. |
| `COURTSIDE_SLOW_QUERY_THRESHOLD_MS` | `500` | Logs Hibernate queries slower than this threshold in milliseconds. Bind values are not logged. |
| `COURTSIDE_LOG_LEVEL` | `INFO` | Log level of the application's own loggers. `DEBUG` adds an `Answering` line for every error one of its exception handlers answers; sign-in and authorisation failures are not among them. |
| `COURTSIDE_PORT` | `8080` | Host port on the loopback interface. |
| `COURTSIDE_SOURCE_URL` | this repository | Where `GET /api/source` points. **If you modified Courtside and let others use it, the AGPL requires this to point at your source, not at ours.** |
| `COURTSIDE_ENVIRONMENT` | `PRODUCTION` | Public environment designation: `PRODUCTION`, `UAT`, `DEVELOPMENT` or `PERFORMANCE`. UAT is visibly marked in the frontend. |
| `COURTSIDE_CLOCK_FIXED_INSTANT` | *unset* | Freezes the clock at an ISO-8601 instant so an automated suite reads the same date on every run. A club never sets this: the instance starts with it only while `COURTSIDE_ENVIRONMENT` names `UAT`, `DEVELOPMENT` or `PERFORMANCE`, so a misspelt designation refuses rather than unlocks. |

`SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD` are set by
`compose.yaml`. Point them elsewhere if you run PostgreSQL outside Compose; the application needs
PostgreSQL 17 and will not run on anything else.

## Diagnose slow requests and queries

Enable OTLP export only after a collector is reachable. Standard Spring HTTP, JVM and HikariCP
metrics then identify the affected endpoint and resource pressure. Courtside additionally exports
the counters `courtside.bookings.created`, `courtside.bookings.rejected` and
`courtside.bookings.conflicts`; rejected bookings carry only the stable rule code as a tag.

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

Signing in is the exception, and it is the complaint this section is most likely to be opened for.
A rejected password, a request from a member who is not allowed to make it, and a login stopped by
the rate limit all answer with a problem document and log nothing, at any level. For those,
`grep Answering` comes back empty however low you set the level, and the response the member got —
its `type`, and the `Retry-After` a rate-limited login carries — is the whole of what there is to
go on.

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

- **Session rows accumulate.** Expired sessions stay in the database; nothing removes them.
  [#27](https://github.com/jegr78/courtside/issues/27)
- **No collector is included.** Courtside can export metrics and traces over OTLP, but operating,
  securing and retaining telemetry remains the operator's responsibility.
- **Inbound mail arrives and nothing reads it.** Port 25 is open so bounces and DMARC reports
  reach the instance rather than vanishing, but nothing acts on them. The instance records that it
  handed a message to this server and learns nothing after that, so a bounce arriving here
  afterwards is the answer nobody reads — and DMARC reports have no reader either.
- **The mail server serves a self-signed certificate.** Caddy issues for `COURTSIDE_DOMAIN`, not for
  the mail hostname. Ordinary between mail servers today, and the thing to fix before MTA-STS or
  DANE. [#755](https://github.com/jegr78/courtside/issues/755) decides where that certificate comes
  from.
