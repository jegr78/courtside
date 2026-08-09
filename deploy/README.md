# Running a Courtside instance

Every club runs its own instance. This directory is the deployment the maintainer runs, published
so that yours is the same thing rather than a reconstruction of it. Copy the directory, fill in
`.env`, and adapt what your infrastructure requires — you are not expected to send changes back.

You need Docker with the Compose plugin. The application container is capped at 1 GiB and an idle
instance with an empty database sits at roughly 450 MiB of that; raise `COURTSIDE_MEMORY` if your
club outgrows it.

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
- `COURTSIDE_DOMAIN` — the name your members will type. Only needed for the reverse proxy below.
- `COURTSIDE_TIME_ZONE` — the club's zone, as an IANA identifier such as `Europe/Berlin`. Every
  booking is stored as an instant; this decides which day a member sees it on. An invalid value
  stops the instance rather than half-working.

Then start it:

```sh
docker compose --profile proxy up -d
```

Caddy obtains a certificate for `COURTSIDE_DOMAIN` on its own, so ports 80 and 443 must reach the
host and the name must already point at it. The application itself is published on
`127.0.0.1:8080` and never directly on a public interface.

Flyway runs the migrations on startup. `docker compose ps` shows the application as `healthy`, and
`docker compose logs -f app` shows it reporting `Started CourtsideApplication`.

> **Signing in the first time still needs a shell.** A fresh database holds one court, opening
> hours and no account — none is seeded, because a shipped password is a shipped vulnerability.
> The procedure is in the repository's `README.md`: hash a password with the `argon2` CLI and
> insert three rows. It works, but it needs tools this deployment does not ship.
> [Issue #88](https://github.com/jegr78/courtside/issues/88) replaces it with two environment
> variables and a forced password change, and it is the next thing on the list.

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

Two things this path costs you, both worth knowing before you choose it:

- **The security headers are Caddy's, not the application's.** Without the proxy there is no HSTS,
  no `X-Content-Type-Options`, no `X-Frame-Options`, no CSP and no referrer policy. Funnel
  terminates TLS the same way Caddy does; it does not add headers. For today's JSON-only API that
  is a small gap, and it grows the day the web client lands.
- **Funnel makes the instance reachable from anywhere in the world**, exactly like a public
  address does. Everything in "What this deployment does not solve yet" applies with full force.

This is an option, not part of the reference deployment — the project must not depend on one
vendor, and everything here works without it.

## Environment variables

These are a published surface: renaming one is a breaking change, and every optional variable has a
default.

| Variable | Default | Meaning |
|---|---|---|
| `COURTSIDE_VERSION` | *required* | The release to run, optionally with `@sha256:…`. Pin it. |
| `POSTGRES_PASSWORD` | *required* | Database password, used only between the containers. |
| `COURTSIDE_DOMAIN` | *required with the proxy* | The public name Caddy obtains a certificate for. |
| `COURTSIDE_TIME_ZONE` | `Europe/Berlin` | The club's IANA time zone. |
| `COURTSIDE_MEMORY` | `1g` | Memory ceiling for the application container. |
| `COURTSIDE_COOKIE_SECURE` | `true` | Sends the session cookie over HTTPS only. Lower it only for a local test. |
| `COURTSIDE_PORT` | `8080` | Host port on the loopback interface. |
| `COURTSIDE_SOURCE_URL` | this repository | Where `GET /api/source` points. **If you modified Courtside and let others use it, the AGPL requires this to point at your source, not at ours.** |

`SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD` are set by
`compose.yaml`. Point them elsewhere if you run PostgreSQL outside Compose; the application needs
PostgreSQL 17 and will not run on anything else.

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
with upgrade notes, and a change to a published surface is named there explicitly.

Back up before an upgrade. The database holds everything; the containers hold nothing:

```sh
docker compose exec -T db pg_dump -U courtside courtside | gzip > courtside-$(date +%F).sql.gz
```

## Two things to adjust before the web client arrives

- The `Content-Security-Policy` in the `Caddyfile` is `default-src 'none'`, which is right for a
  JSON-only API and will block the web client the day it ships from the same origin.
- `Strict-Transport-Security` carries `includeSubDomains`. If `COURTSIDE_DOMAIN` is your club's
  apex domain rather than a subdomain, that forces HTTPS on every other subdomain you own,
  including a club website that may still speak plain HTTP.

## What this deployment does not solve yet

- **The proxy is trusted unconditionally.** The application accepts `X-Forwarded-*` from whoever
  sends it. Caddy overwrites `X-Forwarded-For` with the address it actually saw, so behind the
  proxy that is correct — but do not expose port 8080 to anything else.
  [#26](https://github.com/jegr78/courtside/issues/26)
- **Session rows accumulate.** Expired sessions stay in the database; nothing removes them.
  [#27](https://github.com/jegr78/courtside/issues/27)
- **Log-in attempts are not rate-limited.** [#68](https://github.com/jegr78/courtside/issues/68)
- **There is nothing to look at.** `/actuator/health` is the only thing an operator can ask.
  [#73](https://github.com/jegr78/courtside/issues/73)
