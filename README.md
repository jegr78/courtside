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
- Node.js 24 or later
- Docker — for PostgreSQL and for the Testcontainers-backed test suite
- PostgreSQL 17. The non-overlap guarantee is a GiST exclusion constraint; no other database
  will do.

## Running locally

```bash
export JAVA_HOME=/path/to/temurin-25
node tools/courtside.mjs dev
```

Open the application at `http://127.0.0.1:5173` and its Swagger UI at
`http://127.0.0.1:8082/api-ui/`. For the persistent HTTPS acceptance environment, every CLI
command, database access, certificates, API clients, backups, and reset behavior, see
[`docs/local-environments.md`](docs/local-environments.md).
The isolated, disposable reference environment for load tests is documented in
[`docs/performance-testing.md`](docs/performance-testing.md).

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
administrator or reset a password. Remove them after the initial password has been changed. Because
a restart cannot bring one back, the roster refuses the change that would leave the instance with no
enabled account holding `ADMIN` — an officer may step down once a successor exists, and a board may
demote a former one.

`POST /api/session` limits attempts by source address and by an instance-wide Argon2 budget before
another password verification is allowed. The counters live in PostgreSQL, survive restarts and
apply across application instances. A limited request returns `429` with `Retry-After`; successful
login clears its address counter. No username can be locked independently, so anonymous failures
cannot keep a known administrator account in a renewable lockout.

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
