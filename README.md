# Courtside

Courtside is a court booking system for sports clubs. Each club runs a separate instance. Members
book courts, trainers reserve training periods and groundskeepers close courts. Courtside stores all
three as bookings and uses the booking type to apply the correct rules.

Java 25, Spring Boot 4.1, Spring Modulith, PostgreSQL 17. Licensed under AGPL-3.0.

**Status:** Courtside has no tagged release yet. The reference deployment in [`deploy/`](deploy/)
expects a published image, so run Courtside from source until the first release.

## Requirements

- JDK 25 (Eclipse Temurin)
- Node.js 24 or later
- Docker for PostgreSQL and the Testcontainers test suite
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
a restart cannot restore one, the roster rejects any change that would leave the instance without an
enabled `ADMIN` account. An administrator can step down after another enabled administrator exists.

`POST /api/session` limits attempts by source address and bounds simultaneous Argon2 work in each
application instance. Address counters live in PostgreSQL, survive restarts and apply across
application instances; the verification slots are deliberately process-local capacity, not a
renewable distributed lock. A limited request returns `429` with `Retry-After`; successful login
clears its address counter. No username or whole instance can be locked independently, so anonymous
failures cannot repeatedly lock a known administrator or every member out of the instance.

`enabled` defaults to `false`, so new accounts normally wait for approval. The bootstrap process
enables the first administrator because no existing administrator can approve it.

`ADMIN` overrides restrictions on who may book, including required roles, advance windows and the
limit on open bookings.

It does not override what defines the grid. Opening hours and slot granularity bind everyone,
because the booking UI shows exactly the slots they permit: a booking outside them is one the
interface cannot offer and cannot render back. To open the courts early for a tournament,
change that day's opening hours rather than booking around them.

The court's non-overlap constraint binds everyone too, and lives in the database.

Then log in. CSRF protection is on, so the token has to be fetched before it can be sent back.
The local development command uses the explicit HTTP-only `XSRF-TOKEN` and `SESSION` names shown
below. The HTTPS reference and UAT deployments instead issue host-bound `__Host-XSRF-TOKEN` and
`__Host-SESSION` cookies. In both cases the login POST echoes the readable CSRF value in the
`X-XSRF-TOKEN` header.

```bash
curl -s -c cookies.txt http://localhost:8080/api/public/courts > /dev/null
TOKEN=$(awk '$6 == "XSRF-TOKEN" { print $7 }' cookies.txt)

curl -i -b cookies.txt -c cookies.txt \
  -X POST http://localhost:8080/api/session \
  -H "X-XSRF-TOKEN: $TOKEN" \
  -d 'username=admin' -d 'password=your-password'
```

For this local HTTP flow, `200` with a `SESSION` cookie and the header
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
authentication entry point. The response is therefore indistinguishable from a wrong password. If
login returns `401` for known valid credentials, check the CSRF token.

## Tests

```bash
JAVA_HOME=/path/to/temurin-25 node tools/courtside.mjs check
```

Commit the reviewed changes first. The command applies the same conservative path classification as
pull-request CI, checks out that commit in a temporary worktree and runs the required local backend,
frontend, combined, or full verification there. Use `check --plan` to inspect the decision and
`check --full` to escalate it. Testcontainers starts PostgreSQL 17 for every selected code profile,
so Docker has to be running for those profiles. The suite never mocks the database: collision
handling is the database's job and is tested as such.

## Documentation

- Start with the [wiki](https://github.com/jegr78/courtside/wiki) for an introduction to the modules
  and their boundaries. The code and the files in `docs/` remain authoritative.
- Design specification: `docs/design.md`
- Data model: `docs/data-model.md`
- Release process: `docs/releasing.md`
- Recorded decisions, known deviations and follow-ups: the issue tracker, labeled `decision`,
  `known-limit`, `operations` or `debt`. Completed decisions and accepted known limits are closed;
  pending choices use `question` and planned remediation uses a work label so both remain visible
  work.
- How to contribute a change: `CONTRIBUTING.md`. The code of conduct that governs this
  repository is `CODE_OF_CONDUCT.md`.
- Contributor conventions: `CLAUDE.md`. These rules apply to human and AI contributors and cover
  architecture, migrations and testing.

## Licence

Copyright (C) 2026 The Courtside Contributors. Licensed under the GNU Affero General Public
License, version 3. See [LICENSE](LICENSE). The Maven wrapper (`mvnw`, `mvnw.cmd`,
`.mvn/wrapper/`) is Apache-2.0 code of the Apache Software Foundation and is not covered by
that notice. See [NOTICE](NOTICE).

For a club that runs Courtside, the clause worth knowing is **section 13**. If you modify
Courtside and let people use it over a network, you owe those users the source of your
modified version. Running it unmodified asks nothing of you beyond leaving the licence and
notices intact.

Courtside uses the AGPL so club members can inspect the modified software that handles their
bookings.

Every instance answers `GET /api/source` with the version it is running, the commit it was built
from and where that source can be obtained. It needs no login, because the obligation runs to the
people using the service. The reference deployment requires `COURTSIDE_SOURCE_URL` explicitly, so
an unchanged installation points it here and a fork points it at that fork's corresponding source.

Members must be able to open that address. Do not use an internal address such as
`https://git.intern.example/…`; it does not provide members with the source and exposes an internal
hostname. Courtside accepts only absolute `http` or `https` addresses without embedded credentials.
