# Running a Courtside instance

Every club runs its own instance. This directory is the deployment the maintainer runs, published
so that yours is the same thing rather than a reconstruction of it. Copy the directory, fill in
`.env`, and adapt what your infrastructure requires — you are not expected to send changes back.

You need Docker with the Compose plugin, and about 1 GB of memory for the application.

## First start

```sh
cp .env.example .env
```

Fill in `.env`:

- `COURTSIDE_VERSION` — pin an exact release. Do not use a floating tag; an unattended upgrade of
  a booking system is not a feature.
- `POSTGRES_PASSWORD` — generate one, for example with `openssl rand -base64 32`. It is only ever
  used between the two containers.
- `COURTSIDE_DOMAIN` — the name your members will type. Only needed for the reverse proxy below.
- `COURTSIDE_TIME_ZONE` — the club's zone, as an IANA identifier such as `Europe/Berlin`. Every
  booking is stored as an instant; this decides which day a member sees it on.

Then start it:

```sh
docker compose --profile proxy up -d
```

Caddy obtains a certificate for `COURTSIDE_DOMAIN` on its own, so ports 80 and 443 must reach the
host and the name must already point at it. The application itself is published on
`127.0.0.1:8080` and never directly on a public interface.

Flyway runs the migrations on startup. `docker compose logs -f app` shows the instance reporting
`Started CourtsideApplication`, and `curl -fsS localhost:8080/actuator/health` answers `UP`.

> **Signing in the first time still needs a shell.** A fresh database holds one court, opening
> hours and no account — none is seeded, because a shipped password is a shipped
> vulnerability. The procedure is in the repository's `README.md`: hash a password with the
> `argon2` CLI and insert three rows. It works, but it needs tools this deployment does not ship.
> [Issue #88](https://github.com/jegr78/courtside/issues/88) replaces it with two environment
> variables and a forced password change, and it is the next thing on the list.

## Without a public IP address

A club with no static address, no server and no budget still needs its instance reachable.
[Tailscale Funnel](https://tailscale.com/kb/1223/funnel) does that: it terminates TLS on a
`*.ts.net` name and forwards to a local port, so no port has to be opened on the router.

Leave the reverse proxy out and expose the application port instead:

```sh
docker compose up -d
tailscale funnel 8080
```

This is an option, not part of the reference deployment — the project must not depend on one
vendor, and everything here works without it. Note that Funnel makes the instance reachable from
anywhere in the world, exactly like a public address does.

## Environment variables

These are a published surface: renaming one is a breaking change, and every optional variable has a
default.

| Variable | Default | Meaning |
|---|---|---|
| `COURTSIDE_VERSION` | *required* | The release to run. Pin it. |
| `POSTGRES_PASSWORD` | *required* | Database password, used only between the containers. |
| `COURTSIDE_DOMAIN` | *required with the proxy* | The public name Caddy obtains a certificate for. |
| `COURTSIDE_TIME_ZONE` | `Europe/Berlin` | The club's IANA time zone. |
| `COURTSIDE_COOKIE_SECURE` | `true` | Sends the session cookie over HTTPS only. Lower it only for a local test. |
| `COURTSIDE_PORT` | `8080` | Host port on the loopback interface. |
| `COURTSIDE_SOURCE_URL` | this repository | Where `GET /api/source` points. **If you modified Courtside and let others use it, the AGPL requires this to point at your source, not at ours.** |

`SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD` are set by
`compose.yaml`. Point them elsewhere if you run PostgreSQL outside Compose; the application needs
PostgreSQL 17 and will not run on anything else.

## Upgrading

Raise `COURTSIDE_VERSION`, then:

```sh
docker compose pull app
docker compose --profile proxy up -d
```

Migrations run on startup and support skipping versions, so an instance that has not been updated
for a year goes to the current release directly. Read the release notes first — breaking changes
are called out there.

Back up before an upgrade. The database holds everything; the containers hold nothing:

```sh
docker compose exec -T db pg_dump -U courtside courtside | gzip > courtside-$(date +%F).sql.gz
```

## What this deployment does not solve yet

- **The proxy is trusted unconditionally.** The application accepts `X-Forwarded-*` from whoever
  sends it. Behind Caddy or Funnel that is correct, but do not expose port 8080 to anything else.
  [#26](https://github.com/jegr78/courtside/issues/26)
- **Session rows accumulate.** Expired sessions stay in the database; nothing removes them.
  [#27](https://github.com/jegr78/courtside/issues/27)
- **Log-in attempts are not rate-limited.** [#68](https://github.com/jegr78/courtside/issues/68)
- **There is nothing to look at.** `/actuator/health` is the only thing an operator can ask.
  [#73](https://github.com/jegr78/courtside/issues/73)
