# The container contract

The recipes in this directory are the tested way to run Courtside. This page states what the image
itself requires and provides, for a platform that runs it without them: a Kubernetes cluster, Nomad,
a Podman unit or a managed container service. Where a recipe supplies something, the platform now
has to supply it.

Everything this page states about the image is the contract: what it runs as, listens on, writes,
answers, reads, trusts, reaches and refuses. Changing any of it is a breaking change. Advice about a
platform, such as which kind of probe to use, Kubernetes service links or what the reference Caddy
adds, is guidance and not part of the contract.

In the Courtside repository, `tools/container-contract.test.mjs` reads the Dockerfile, the
application configuration, the migrations, the reference Compose and Caddy files and the Java that
refuses a start, and fails when
this page stops stating the user, port, writable path, health check and response, extension, one-shot
commands and their input, forwarded headers, mail transport, file inputs and variable set they
define.

## The image

- `ghcr.io/jegr78/courtside@sha256:<digest>`. The reference recipes require the digest from their
  release archive. Check its signature before you run it, as
  [Verifying what you are about to run](guides/operations.md#verifying-what-you-are-about-to-run) describes.
- The process runs as UID 10001 and GID 10001. It needs no root and no Linux capability. The
  reference deployment drops every capability and sets `no-new-privileges`.
- It runs on a read-only root filesystem. The only writable path it needs is `/tmp`, which the
  reference deployment mounts as a tmpfs.
- It listens on port 8080. `COURTSIDE_APP_TLS_MODE` is `plaintext` by default. Set it to `serve`
  with `COURTSIDE_APP_TLS_CERTIFICATE` and `COURTSIDE_APP_TLS_KEY` to serve TLS on the same port, as
  [Encrypting the connection between the proxy and the application](guides/operations.md#encrypting-the-connection-between-the-proxy-and-the-application)
  describes.
- The Java heap takes at most 75 percent of the container's memory limit, so set a limit. The
  reference deployment sets 1 GiB. The process exits on an `OutOfMemoryError` instead of running
  on degraded, so give it a restart policy.
- Logs go to standard output, one Elastic Common Schema JSON object per line.
- Run one application container per database. The reference deployment runs one, and more than one
  is not tested. That includes an update: stop the old container before the schema migrates, as
  `docker compose up -d` does. In `shared` mode that is before the new container starts; in
  `separate` mode it is before `--courtside-database-migrate` runs. A rolling update that runs the
  old version against a schema the new one has migrated is not supported.

## Network

- Inbound, port 8080 is reached by the ingress and the platform's health probe, and by nothing else.
  See [HTTPS ingress](#https-ingress).
- Outbound, the application reaches the database, the mail relay, and `api.pwnedpasswords.com` over
  HTTPS. Every password a member or administrator sets is checked against that service, and a check
  that cannot complete refuses the change with `503`. That includes the first administrator, who has
  to replace the bootstrap password before doing anything else. With `COURTSIDE_ENVIRONMENT` at
  `PRODUCTION`, `COURTSIDE_PASSWORD_BREACH_ENDPOINT` cannot point anywhere else.
- With `COURTSIDE_OTLP_ENABLED` set to `true`, it also sends traces and metrics to
  `COURTSIDE_OTLP_TRACES_ENDPOINT` and `COURTSIDE_OTLP_METRICS_ENDPOINT`.

## Health

`GET /actuator/health` answers without authentication. When the instance is up it returns `200`
with the body `{"groups":["liveness","mail","readiness"],"status":"UP"}`, which names the probe
groups and carries no components. It returns `503` when a check fails. With the database
unreachable, the `503` takes about 30 seconds to arrive, because it waits for a database connection
first.

The image declares its own health check against `/actuator/health`: every 15 seconds, a 3 second
timeout, three retries and a start period of `90s`. A platform that runs its own probe should use
the same path, allow the same start period and keep a short timeout, so a lost database marks the
container unhealthy rather than holding the probe open. Use it to decide whether the container
receives traffic, as a Kubernetes readiness probe does. As a liveness probe it would restart the
container every time the database is away.

The declared check requests plain HTTP. With `COURTSIDE_APP_TLS_MODE` set to `serve` it fails, so
replace it with a probe that requests HTTPS and trusts the application's certificate, as
`compose.app-tls.yaml` does.

The probe groups under `/actuator/health/` require the session of an administrator who has already
replaced a one-time password. An anonymous probe gets `401`, so they are not probe targets.

## The database

Courtside runs on PostgreSQL 17 and is tested on nothing else. The schema needs the `btree_gist`
extension, because a booking's court occupancy is a GiST exclusion constraint.

The application connects with `SPRING_DATASOURCE_URL`, a `jdbc:postgresql://host:port/database`
address. `COURTSIDE_DB_TLS_MODE` is `prefer` by default. `verify-full` requires a certificate
issued for the host name in that address, signed by the authority in the PEM file
`COURTSIDE_DB_TLS_ROOT_CERTIFICATE` names, as
[Encrypting the connection to the database](guides/operations.md#encrypting-the-connection-to-the-database)
describes. With `verify-full`, an address that carries an `ssl…` or `gssenc…` argument or `service`,
such as the `?sslmode=require` a managed service often hands out, refuses to start, because that
argument would decide the transport instead.

### Migrations

`COURTSIDE_DB_IDENTITY_MODE` decides who changes the schema.

**`shared`, the default.** The application runs Flyway when it starts, with
`SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD`. That role creates the extension and
every schema object. A role that owns the database can do both without being a superuser, because
`btree_gist` is a trusted extension. Setting `COURTSIDE_DB_RUNTIME_USERNAME` or
`COURTSIDE_DB_RUNTIME_PASSWORD_FILE` in this mode refuses the start.

**`separate`.** Two one-shot commands of the same image prepare the database, and the application
never changes the schema. Run them in this order before the application starts, and again with
every new version. Pass the command as the only argument to the image's entrypoint, as Kubernetes
`args` rather than `command`: with any other argument beside it the image starts the application
instead, and a replaced entrypoint runs whatever replaced it. Both read their input from environment
variables only, and from the files those variables name, each holding one password with an optional
final line ending. Each exits `0` on success and with another status on any failure, which has to
stop the rollout.

1. `--courtside-database-setup` connects as `COURTSIDE_DB_OWNER_USERNAME` with the password in
   `COURTSIDE_DB_OWNER_PASSWORD_FILE`. That role owns the database and may create roles; it does
   not have to be a superuser. For a migration or runtime role that already exists and that the
   owner did not create, it needs more, as
   [Separating database identities](guides/operations.md#separating-database-identities) lists. Setup creates
   or reconciles the roles `COURTSIDE_DB_MIGRATION_USERNAME` and `COURTSIDE_DB_RUNTIME_USERNAME`
   with the passwords in `COURTSIDE_DB_MIGRATION_PASSWORD_FILE` and
   `COURTSIDE_DB_RUNTIME_PASSWORD_FILE`, installs the extension, gives the runtime role its
   privileges and hands the schema to the migration role. The three role names must differ, start
   with a lower-case letter and hold at most 63 lower-case letters, digits and `_`. The migration
   and runtime roles may neither be `postgres` nor start with `pg_`.
2. `--courtside-database-migrate` runs Flyway as `COURTSIDE_DB_MIGRATION_USERNAME` with the
   password in `COURTSIDE_DB_MIGRATION_PASSWORD_FILE`.
3. The application starts with `COURTSIDE_DB_IDENTITY_MODE=separate`,
   `COURTSIDE_DB_RUNTIME_USERNAME` and `COURTSIDE_DB_RUNTIME_PASSWORD_FILE`. It refuses to start
   when a credential reaches it any other way: `SPRING_DATASOURCE_USERNAME` or
   `SPRING_DATASOURCE_PASSWORD`, a connection pool or Flyway credential, or `user`, `password` or
   `service` in the address.

All three processes read `SPRING_DATASOURCE_URL`, `COURTSIDE_DB_TLS_MODE` and
`COURTSIDE_DB_TLS_ROOT_CERTIFICATE`. [Separating database identities](guides/operations.md#separating-database-identities)
describes what each role may do.

Either way, a new version migrates the schema forward, and a version may be skipped. Create and
verify a complete recovery unit first, as [Upgrading](guides/operations.md#upgrading) describes. Unless release
notes explicitly declare backward schema compatibility, rollback restores that unit; it never
starts the older image against the migrated database.

## HTTPS ingress

Courtside is served to members over HTTPS only. Its session and CSRF cookies carry the `__Host-`
prefix and the `Secure` attribute while `COURTSIDE_COOKIE_SECURE` is `true`, which is the default,
and a browser drops such cookies over plain HTTP. With `COURTSIDE_ENVIRONMENT` at its default
`PRODUCTION`, the application refuses to start with that switch lowered.

The application trusts the forwarded headers of every request it receives: `Forwarded`,
`X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Port`, `X-Forwarded-Prefix`,
`X-Forwarded-Proto` and `X-Forwarded-Ssl`. It takes the client address from them, which is what
sign-in and account-recovery throttling count, and the scheme and host it answers for. So port 8080
must be reachable only from the ingress and the health probe. The ingress must discard every one of
those headers a client sends, then write `X-Forwarded-For`, `X-Forwarded-Host`,
`X-Forwarded-Port: 443` and `X-Forwarded-Proto: https` itself. It writes `X-Forwarded-For` as a
single value, the address of the member's own device, taken from the connection or from an upstream
hop that has already sanitised it. The application counts
the first value, so an ingress that appends lets a client choose its address, and one behind a load
balancer that writes the balancer's address puts every member into one throttling bucket.

The reference deployment's Caddy does more than that: it allows only the configured host, limits a
request body to 2 MB, refuses plain HTTP requests to the API and adds a `Permissions-Policy`. Read
[`Caddyfile`](Caddyfile) for the policy your ingress takes over.

## Mail

The application refuses to start without `COURTSIDE_MAIL_RELAY_HOST`, `COURTSIDE_MAIL_FROM` and
`COURTSIDE_MAIL_REPLY_TO`, and each of the two addresses must be a single address naming a host.
It does not contact the relay at startup. It sends through
`COURTSIDE_MAIL_RELAY_PORT`, `587` by default, and always requires STARTTLS, so a relay that only
offers TLS from the first byte, usually on port 465, cannot be used. Set `COURTSIDE_MAIL_USERNAME`
and `COURTSIDE_MAIL_PASSWORD` together or not at all. `COURTSIDE_MAIL_TRUST_RELAY_CERTIFICATE`
turns off checking the relay's certificate. Leave it `false` unless the
[environment variables](guides/operations.md#environment-variables) table says otherwise for your relay.

## Required input and refusals

On a database without any account, the application refuses to start without
`COURTSIDE_BOOTSTRAP_ADMIN_USERNAME`, `COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD` and
`COURTSIDE_BOOTSTRAP_ADMIN_DISPLAY_NAME`. The password needs at least 12 characters and the display
name a first and a last name. Once an account exists, the three are ignored. Together with the
database and mail input above, that is everything without a default.

Beyond the refusals named above, the application refuses to start on many invalid values, such as
an unknown `COURTSIDE_ENVIRONMENT`, `COURTSIDE_DB_IDENTITY_MODE` or `COURTSIDE_DB_TLS_MODE`. Not
every one is caught at startup: a `COURTSIDE_MAIL_RELAY_PORT` outside the valid range only fails
when the first message is sent. These two refusals are easy to meet on another platform:

- `COURTSIDE_PASSWORD_TERMS_FILE` names a relative path, or a file that is missing, unreadable or
  holds no term;
- `COURTSIDE_CLOCK_FIXED_INSTANT` is set while `COURTSIDE_ENVIRONMENT` names anything but `UAT`,
  `DEVELOPMENT` or `PERFORMANCE`.

`COURTSIDE_SOURCE_URL` defaults to this repository, so an image built from modified source has to
point it at that source.

These inputs are paths to files the container reads, so mount each one readable by UID 10001:

- `COURTSIDE_APP_TLS_CERTIFICATE`
- `COURTSIDE_APP_TLS_KEY`
- `COURTSIDE_DB_MIGRATION_PASSWORD_FILE`
- `COURTSIDE_DB_OWNER_PASSWORD_FILE`
- `COURTSIDE_DB_RUNTIME_PASSWORD_FILE`
- `COURTSIDE_DB_TLS_ROOT_CERTIFICATE`
- `COURTSIDE_PASSWORD_TERMS_FILE`

No other input this page lists has a file variant. `SPRING_DATASOURCE_PASSWORD`,
`COURTSIDE_MAIL_PASSWORD` and `COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD` are set as values.

## Environment variables

The image reads the variables below, plus Spring Boot's own `SPRING_DATASOURCE_URL`,
`SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` and `LOGGING_LEVEL_ORG_COURTSIDE`.
Spring Boot binds any of its other properties from the environment as well. Those are outside this
contract, and setting one can change what this page states: widening the actuator's exposure
publishes endpoints it does not describe, and a `SERVER_PORT` moves the port. Kubernetes service
links inject variables named after services, so disable them with `enableServiceLinks: false`.

These are the names inside the container. The reference Compose files set some of them from `.env`
variables with other names:

- `POSTGRES_PASSWORD` becomes `SPRING_DATASOURCE_PASSWORD`, and with an external database
  `COURTSIDE_DATABASE_URL`, `COURTSIDE_DATABASE_USERNAME` and `COURTSIDE_DATABASE_PASSWORD` become
  `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD`. With
  separated identities on an external database neither username nor password is read, and every
  process takes its URL from `COURTSIDE_DATABASE_URL`;
- `COURTSIDE_LOG_LEVEL` becomes `LOGGING_LEVEL_ORG_COURTSIDE`;
- `COURTSIDE_MAIL_SENDER_USERNAME` and `COURTSIDE_MAIL_DOMAIN` become `COURTSIDE_MAIL_FROM`, and with
  this deployment's own mail server also `COURTSIDE_MAIL_USERNAME`;
- `COURTSIDE_MAIL_RELAY_USERNAME` becomes `COURTSIDE_MAIL_USERNAME` with an external relay;
- `COURTSIDE_MAIL_HOSTNAME` becomes `COURTSIDE_MAIL_RELAY_HOST` with this deployment's own mail
  server;
- `COURTSIDE_DB_TLS_AUTHORITY`, `COURTSIDE_APP_TLS_MATERIAL` and `COURTSIDE_APP_TLS_AUTHORITY` name
  host directories and files that Compose mounts, and the container variables name the mounted
  paths.

The three `COURTSIDE_DB_*_PASSWORD_FILE` variables keep their names but not their meaning: in `.env`
they name a file on the host, in the container the path it is mounted at. The
[environment variables](guides/operations.md#environment-variables) table describes each variable from the
`.env` side, except `COURTSIDE_DB_IDENTITY_MODE`, `COURTSIDE_MAIL_FROM`, `COURTSIDE_MAIL_USERNAME` and
`COURTSIDE_PASSWORD_BREACH_ENDPOINT`, which this page describes.

| Variable | Default |
|---|---|
| `COURTSIDE_APP_TLS_CERTIFICATE` | unset |
| `COURTSIDE_APP_TLS_KEY` | unset |
| `COURTSIDE_APP_TLS_MODE` | `plaintext` |
| `COURTSIDE_BOOTSTRAP_ADMIN_DISPLAY_NAME` | unset |
| `COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD` | unset |
| `COURTSIDE_BOOTSTRAP_ADMIN_USERNAME` | unset |
| `COURTSIDE_CLOCK_FIXED_INSTANT` | unset |
| `COURTSIDE_COOKIE_SECURE` | `true` |
| `COURTSIDE_CREDENTIAL_ISSUE_MAX_PER_WINDOW` | `5` |
| `COURTSIDE_CREDENTIAL_ISSUE_RETENTION` | `24h` |
| `COURTSIDE_CREDENTIAL_ISSUE_WINDOW` | `1h` |
| `COURTSIDE_DB_IDENTITY_MODE` | `shared` |
| `COURTSIDE_DB_LOCK_TIMEOUT` | `5s` |
| `COURTSIDE_DB_MIGRATION_PASSWORD_FILE` | unset |
| `COURTSIDE_DB_MIGRATION_USERNAME` | unset |
| `COURTSIDE_DB_OWNER_PASSWORD_FILE` | unset |
| `COURTSIDE_DB_OWNER_USERNAME` | unset |
| `COURTSIDE_DB_RUNTIME_PASSWORD_FILE` | unset |
| `COURTSIDE_DB_RUNTIME_USERNAME` | unset |
| `COURTSIDE_DB_TLS_MODE` | `prefer` |
| `COURTSIDE_DB_TLS_ROOT_CERTIFICATE` | unset |
| `COURTSIDE_ENVIRONMENT` | `PRODUCTION` |
| `COURTSIDE_IMPORT_MAX_FILE_SIZE` | `8MB` |
| `COURTSIDE_IMPORT_PREVIEW_RETENTION` | `7d` |
| `COURTSIDE_IMPORT_SWEEP_INTERVAL` | `1h` |
| `COURTSIDE_LOGIN_ADDRESS_BLOCK` | `1m` |
| `COURTSIDE_LOGIN_ADDRESS_MAX_FAILURES` | `20` |
| `COURTSIDE_LOGIN_ADDRESS_WINDOW` | `1m` |
| `COURTSIDE_LOGIN_GLOBAL_THRESHOLD` | `100` |
| `COURTSIDE_LOGIN_GLOBAL_WINDOW` | `1m` |
| `COURTSIDE_LOGIN_VERIFICATION_CONCURRENCY` | `2` |
| `COURTSIDE_MAIL_FROM` | unset |
| `COURTSIDE_MAIL_PASSWORD` | unset |
| `COURTSIDE_MAIL_RELAY_HOST` | unset |
| `COURTSIDE_MAIL_RELAY_PORT` | `587` |
| `COURTSIDE_MAIL_REPLY_TO` | unset |
| `COURTSIDE_MAIL_TRUST_RELAY_CERTIFICATE` | `false` |
| `COURTSIDE_MAIL_USERNAME` | unset |
| `COURTSIDE_OTLP_ENABLED` | `false` |
| `COURTSIDE_OTLP_METRICS_ENDPOINT` | `http://localhost:4318/v1/metrics` |
| `COURTSIDE_OTLP_TRACES_ENDPOINT` | `http://localhost:4318/v1/traces` |
| `COURTSIDE_PASSWORD_BREACH_CACHE_ENTRIES` | `128` |
| `COURTSIDE_PASSWORD_BREACH_CACHE_LIFETIME` | `24h` |
| `COURTSIDE_PASSWORD_BREACH_ENDPOINT` | `https://api.pwnedpasswords.com/range/` |
| `COURTSIDE_PASSWORD_BREACH_TIMEOUT` | `3s` |
| `COURTSIDE_PASSWORD_RESET_MAIL_MAX_PER_WINDOW` | `5` |
| `COURTSIDE_PASSWORD_RESET_MAIL_RETENTION` | `24h` |
| `COURTSIDE_PASSWORD_RESET_MAIL_WINDOW` | `1h` |
| `COURTSIDE_PASSWORD_TERMS_FILE` | unset |
| `COURTSIDE_SESSION_ABSOLUTE_LIFETIME` | `24h` |
| `COURTSIDE_SESSION_CLEANUP_CRON` | `0 * * * * *` |
| `COURTSIDE_SESSION_INACTIVITY_TIMEOUT` | `30m` |
| `COURTSIDE_SESSION_MAX_CONCURRENT` | `5` |
| `COURTSIDE_SESSION_REAUTHENTICATION_WINDOW` | `5m` |
| `COURTSIDE_SLOW_QUERY_THRESHOLD_MS` | `500` |
| `COURTSIDE_SOURCE_URL` | this repository |
| `COURTSIDE_TRACING_SAMPLING_PROBABILITY` | `0.1` |
