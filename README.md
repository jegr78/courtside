# Courtside

Court booking system for sports clubs. Each club runs its own single-tenant instance:
members book courts, trainers place training blocks, the groundskeeper closes courts —
all of it the same booking entity, distinguished only by its booking card.

Java 25, Spring Boot 4.1, Spring Modulith, PostgreSQL 17. Licensed under AGPL-3.0.

**Status:** no tagged release yet, so no published container image. The reference deployment
lives in [`deploy/`](deploy/) — Compose, Caddy and the documented environment — and it expects a
released image to pull. Until the first tag, run it from source as below.

## Requirements

- JDK 25 (Eclipse Temurin)
- Docker — for PostgreSQL and for the Testcontainers-backed test suite
- PostgreSQL 17. The non-overlap guarantee is a GiST exclusion constraint; no other database
  will do.

## Running locally

```bash
docker run -d --name courtside-db -p 5432:5432 \
  -e POSTGRES_DB=courtside -e POSTGRES_USER=courtside -e POSTGRES_PASSWORD=courtside \
  postgres:17-alpine

export JAVA_HOME=/path/to/temurin-25
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/courtside \
SPRING_DATASOURCE_USERNAME=courtside \
SPRING_DATASOURCE_PASSWORD=courtside \
./mvnw spring-boot:run
```

Flyway creates the schema on first start and seeds opening hours of 08:00–22:00 for every
weekday, a single court numbered 1 (unnamed — give it a name and add the rest through the admin
UI), the four booking cards, the two participant cards (Ball machine, Looking for a partner) and
the Standard and Youth rule sets. How many courts a club has is the club's business, so the seed
takes no position beyond the one court without which nothing can be booked at all. Adjust all of
it later through the database or the admin UI. Migrations currently run to `V10`, which records
whether an account must replace its initial password.

Behind TLS, set `COURTSIDE_COOKIE_SECURE=true` so the session and CSRF cookies are marked
`Secure`. It defaults to `false` so plain HTTP works during development.

## First start: creating the first admin

No account or shared password is seeded. On an empty account table the application instead
requires three environment variables and refuses to start without them:

```bash
export COURTSIDE_BOOTSTRAP_ADMIN_USERNAME=admin
export COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD='one-time-password'
export COURTSIDE_BOOTSTRAP_ADMIN_DISPLAY_NAME='First Last'
```

The password must contain at least 12 characters. Startup creates one enabled local account with
the `ADMIN` role, hashes its password with Argon2id and marks it for an initial password change.
The database operation is serialized, so concurrent application starts cannot create two initial
administrators.

Once any local account exists, the variables are ignored: a restart can never create another
administrator or reset a password. Remove them after the initial password has been changed.

Until rate limiting lands (see `docs/design.md`), `POST /api/session` will happily spend this much
memory per attempt, including for a username that does not exist. Rate-limit it at the reverse
proxy on any deployment facing the public internet.

`enabled` defaults to `false` — accounts normally wait for approval. The bootstrap path explicitly
enables the first administrator because nobody exists to approve it.

`ADMIN` alone is enough. It overrides the restrictions that say *who* may book — the role a
booking card requires, the advance window, the limit on open bookings.

It does not override what defines the grid. Opening hours and slot granularity bind everyone,
because the booking UI shows exactly the slots they permit: a booking outside them is one the
interface cannot offer and cannot render back. To open the courts early for a tournament,
change that day's opening hours rather than booking around them.

The court's non-overlap constraint binds everyone too, and lives in the database.

Then log in. CSRF protection is on, so the token has to be fetched before it can be sent back:
any GET issues the readable `XSRF-TOKEN` cookie, and the login POST echoes it in the
`X-XSRF-TOKEN` header.

```bash
curl -s -c cookies.txt http://localhost:8080/api/public/courts > /dev/null
TOKEN=$(awk '$6 == "XSRF-TOKEN" { print $7 }' cookies.txt)

curl -i -b cookies.txt -c cookies.txt \
  -X POST http://localhost:8080/api/session \
  -H "X-XSRF-TOKEN: $TOKEN" \
  -d 'username=admin' -d 'password=your-password'
```

`200` with a `SESSION` cookie and the header
`X-Courtside-Password-Change-Required: true` means it worked. That session can only replace the
one-time password or log out:

```bash
curl -i -b cookies.txt -c cookies.txt \
  -X PUT http://localhost:8080/api/account/initial-password \
  -H "X-XSRF-TOKEN: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"password":"a-new-permanent-password"}'
```

The successful `204` ends the session. Sign in again with the permanent password; every normal
admin operation is available then.

Posting without the header returns `401`, not `403`: a missing CSRF token raises an
`AccessDeniedException`, and for an anonymous caller Spring Security routes that to the
authentication entry point. The response is therefore indistinguishable from a wrong password —
if the login fails with `401` and the credentials are certainly right, the token is missing.

## Tests

```bash
JAVA_HOME=/path/to/temurin-25 ./mvnw -B clean verify
```

Testcontainers starts PostgreSQL 17, so Docker has to be running. The suite never mocks the
database: collision handling is the database's job and is tested as such.

## Documentation

- Design spec: `docs/design.md`
- Known deviations and follow-ups: the issue tracker, labeled `decision`, `known-limit`,
  `operations` or `debt`
- Conventions for contributors: `CLAUDE.md`. Courtside is developed with AI assistance, and
  that file is the ruleset it works under — architecture principles, migration policy, test
  discipline. It is written for a contributor of either kind.

## Licence

Copyright (C) 2026 The Courtside Contributors. Licensed under the GNU Affero General Public
License, version 3 — see [LICENSE](LICENSE). The Maven wrapper (`mvnw`, `mvnw.cmd`,
`.mvn/wrapper/`) is Apache-2.0 code of the Apache Software Foundation and is not covered by
that notice — see [NOTICE](NOTICE).

For a club that runs Courtside, the clause worth knowing is **section 13**. If you modify
Courtside and let people use it over a network, you owe those users the source of your
modified version. Running it unmodified asks nothing of you beyond leaving the licence and
notices intact.

That network clause is what separates the AGPL from the GPL, and it is a deliberate choice
here: a club's members should be able to see what handles their bookings.

Every instance answers `GET /api/source` with the version it is running, the commit it was built
from and where that source can be obtained. It needs no login, because the obligation runs to the
people using the service. An unmodified deployment reports this repository; a club that forked
sets `COURTSIDE_SOURCE_URL` to its own and has thereby discharged section 13.

That address must be one the members can actually open. An internal `https://git.intern.example/…`
discharges nothing — the offer is to them — and publishes an internal hostname to anyone who asks.
Courtside refuses to start on anything that is not an absolute `http` or `https` address.
