# Courtside

Court booking system for sports clubs. Each club runs its own single-tenant instance:
members book courts, trainers place training blocks, the groundskeeper closes courts —
all of it the same booking entity, distinguished only by its booking card.

Java 25, Spring Boot 4.1, Spring Modulith, PostgreSQL 17. Licensed under AGPL-3.0.

**Status:** no tagged release yet. There is no published container image, and
`courtside-deploy` — the reference deployment the design spec describes — is planned but
not yet published. For now, run it from source as below.

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
weekday, four courts numbered 1 to 4 (unnamed — give them names through the admin UI), the four
booking cards, the two participant cards (Ball machine, Looking for a partner) and the Standard
and Youth rule sets. Adjust all of it later through the database or the admin UI. Migrations
currently run to `V9`, which adds `club_config` for the club's branding (name, colors, logo) on
top of `V8`'s `booking_series` and the multi-court allocation it needs for recurring bookings.

Behind TLS, set `COURTSIDE_COOKIE_SECURE=true` so the session and CSRF cookies are marked
`Secure`. It defaults to `false` so plain HTTP works during development.

## First start: creating the first admin

No account is seeded — a shipped password is a shipped vulnerability. Create the first
admin by hand. The password hash must be **Argon2id** with the parameters this application
hashes with, which are OWASP's current guidance: `m=19456`, `t=2`, `p=1`, 16-byte salt, 32-byte
hash.

```bash
echo -n 'your-password' | argon2 "$(openssl rand -base64 12)" -id -k 19456 -t 2 -p 1 -l 32 -e
```

`-k` sets the memory in KiB; `-m` would set it as a power of two and cannot express 19456. Older
`argon2` help output and the manpage omit `-k`, but every release since 20190702 accepts it.

That prints `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`. Paste it into the insert below:

```sql
INSERT INTO person (id, first_name, last_name, email) VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'First', 'Last', 'admin@example.org');

INSERT INTO user_account (id, person_id, username, password_hash, enabled) VALUES
    ('00000000-0000-0000-0000-0000000000a2',
     '00000000-0000-0000-0000-0000000000a1',
     'admin',
     '$argon2id$v=19$m=19456,t=2,p=1$REPLACE$REPLACE',
     true);

INSERT INTO user_account_role (user_account_id, role) VALUES
    ('00000000-0000-0000-0000-0000000000a2', 'ADMIN');
```

An account created before these parameters were raised keeps the hash it has — Argon2 stores its
own cost, so it still verifies, and nothing rehashes it on login. Change the password to move it up.

Until rate limiting lands (see `docs/design.md`), `POST /api/session` will happily spend this much
memory per attempt, including for a username that does not exist. Rate-limit it at the reverse
proxy on any deployment facing the public internet.

`enabled` defaults to `false` — accounts normally wait for approval, and the first one has
nobody to approve it.

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

`200` with a `SESSION` cookie means it worked.

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
