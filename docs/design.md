# Courtside technical design

**Status:** Current implementation contract

**Scope:** The application and supported reference deployment on `main`. Release notes describe
changes between published versions. The member and board handbooks explain how to use the product.

This document records current product boundaries and durable design decisions. It is not a roadmap.
The detailed contracts have their own sources:

- [`openapi.yaml`](../src/main/resources/api/openapi.yaml) defines the HTTP API.
- [`data-model.md`](data-model.md) describes persisted data.
- [`authorization-policy.json`](../security/authorization-policy.json) defines access rules.
- [`production-architecture.json`](../security/production-architecture.json) records deployed
  services and trust boundaries.
- [`security-risks.md`](security-risks.md) records accepted limitations and their bounds.
- [`deploy/README.md`](../deploy/README.md) selects a deployment recipe; its linked guides are the
  canonical English operator handbook.

## Product boundaries

Courtside is a court booking system for sports clubs. Each club runs one single-tenant instance
with its own application and PostgreSQL database. Courtside is not a central service and does not
hold data from installations operated by other organizations.

The club configures courts, opening hours, booking cards, participant cards, membership types,
rules, branding and language. Members use the same REST API as the browser application.
Administrative work is available through the browser and does not require database access.

The current product includes:

- a public multi-court day plan;
- personal and role-managed bookings;
- recurring and multi-court bookings;
- configurable booking rules;
- people, memberships, accounts, roles and sessions;
- repeatable membership snapshot imports;
- roster, booking and per-person data exports;
- localized email notifications and a message log;
- an append-only audit log;
- court-utilisation reporting;
- a React and Vite progressive web application;
- a multi-architecture image and four reference deployment recipes.

Bookings and administrative changes require authentication. Anonymous callers may read public
configuration and anonymised occupancy and may use the bounded account-recovery endpoints. The
product has no anonymous booking path.

Courtside is licensed under AGPL-3.0-or-later. Each instance publishes its version, build commit and
configured source location through `GET /api/source`.

## Distribution and compatibility

A tagged release publishes a multi-architecture image on GHCR, its OpenAPI document, release notes,
a software bill of materials and provenance. The release workflow signs the image with cosign. A
release candidate follows the same qualification path but receives no floating version tag.

The reference deployment lives in `deploy/`. Its recipes are `standard`, `full-self-hosted`,
`existing-infrastructure` and `funnel`. A tagged release also publishes
`courtside-deployment-<version>.zip`: the four recipes and the resolver that reads them, the Compose
files any recipe can select, the files those Compose files bind, the configuration example, the
recipe and operations guides, the container contract and the Bash `courtside` lifecycle launcher, with a
manifest naming the release, its image digest, its source revision and the release workflow that
attests it. The launcher publishes read-only versioned releases separately from private mutable
configuration, secrets and backups beneath a path-bound installation marker. It strictly parses
its versioned configuration as data and resolves every Compose invocation from the selected
recipe. Its recovery units bind a validated
PostgreSQL dump to that release, image, configuration, local material and checksum inventory;
restore checks use the locally trusted immutable release model, an empty PostgreSQL 17 target and
the matching application image, with cleanup recorded before the target starts. Exact-release
updates create a recovery unit before pulling or migrating, never start an older application after
a newer schema may have run and never claim an automatic database rollback. The manifest carries
a checksum per file and the release page carries one for the archive. Installing from it needs no
clone of this repository or application runtime. The official recipes compose the fixed GHCR
repository and SHA-256 algorithm with that manifest digest, so they cannot run a moving tag. An
explicit `custom-image` overlay composes another repository with a required SHA-256 digest and source URL,
marks the rendered service as custom, and warns that the official release trust guarantee no
longer applies.

The CLI recipe files also generate the English and German command fragments. Documentation checks
fail when a recipe, its resolved Compose files or either committed fragment changes alone. Release
qualification downloads the archive job's exact bytes, verifies every manifest checksum and binds
all four recipes to the candidate image digest before the `amd64` and `arm64` runtime journeys.
The controlled Stalwart journey is a separate publication gate. Its evidence and the image journey
record archive and image identities, platform and tool versions, and individual results without
credentials or target addresses. Provider-owned DNS, routing, reputation and delivery observations
remain warnings or unknown; they never become software passes.

Two interfaces are public compatibility contracts:

1. documented environment variables used by the application and reference deployment;
2. the REST API published in the OpenAPI document.

Renaming or removing either is a breaking change. Additive changes remain compatible when existing
clients and configurations continue to work.

Flyway applies migrations at startup. Until the first published release, a correction may
edit an unshipped migration. Afterwards, shipped migrations are immutable and every schema change
receives a new migration. Upgrade verification covers version skipping.

## Language and configured names

English is used for code, API fields, schema objects and technical documentation. German is the
default user language and English is also shipped. An account stores its language. The instance
default applies before an account chooses one.

The supported locale set is derived from the frontend, application messages, mail templates and
seed bundles. Startup fails when those sets differ. `GET /api/public/config` publishes the result.

Booking cards, participant cards, rule sets and membership types have one club-wide name. They are
not translated per reader. Shipped rows follow the club language until a board gives one its own
name. A club-defined name survives later language changes.

## Architecture

Courtside is a modular monolith built with Java 25, Spring Boot 4.1 and Spring Modulith 2.1. It runs
as one application process and uses PostgreSQL 17.

| Module | Responsibility |
| --- | --- |
| `api` | OpenAPI-generated controller interfaces and transport models |
| `audit` | Domain-event log and administrative audit view |
| `booking` | Bookings, participants, series and court allocations |
| `card` | Booking and participant card configuration |
| `config` | Club identity, time zone, language and grid configuration |
| `dataexchange` | Imports, exports and subject-access responses |
| `facility` | Courts and opening hours |
| `identity` | People, accounts, roles, credentials and sessions |
| `member` | Membership types, memberships and roster administration |
| `notification` | Email creation, delivery state and preferences |
| `rules` | Rule-set administration and rule evaluation |
| `shared` | Shared domain events and cross-cutting value types |

The `demo`, `performance` and `securityassessment` modules contain fixtures for disposable
environments. Packaging places them in a separate artifact. The production image rejects them.

### Module boundaries

Each module's base package is its public Java API. Subpackages are implementation details. A
module's `package-info.java` declares allowed dependencies. Modulith verification rejects
undeclared dependencies and cycles. `shared` and generated `api` are the shared modules.

`booking` depends on `rules`, `facility`, `member` and `card`. Notification and audit behavior uses
domain events instead of reverse dependencies into the booking core.

Controllers implement generated interfaces and translate HTTP. Services own business operations.
Repositories persist state and do not decide policy.

### Events and transactions

State-changing services publish typed domain events. The audit listener runs before commit and
writes its row in the same transaction. A covered change cannot commit without its audit event.

Notification listeners run after commit through Spring Modulith's event publication registry.
Incomplete publications remain available after a restart. A failed mail handover cannot roll back
a booking that already committed.

Events contain identifiers and non-personal change descriptions. Free text, names and email
addresses are not copied into audit payloads. Stored event payloads evolve additively.

PostgreSQL state remains the source of truth. Courtside does not use event sourcing or an external
message broker. The database must enforce occupancy, and one club does not need another service for
internal events.

## Domain model

[`data-model.md`](data-model.md) is the table reference. This section explains the choices behind it.

### People, memberships and accounts

`Person`, `Member` and `UserAccount` are separate concepts. A person is the identity and contact
record. A member links one person to one current membership type and records its start and optional
end. An account grants sign-in access and roles. A person may have no account.

Email is optional for a person and mandatory before that person receives an account. It is not
unique because several people may use one family mailbox. Username is unique within an instance.

A membership with an end date is inactive. The row remains with its last type and dates. The
current model does not schedule membership changes and refuses future start or end dates.

Every value entered through an administrative surface can be corrected there. Identifiers are not
editable descriptions. Deactivation represents records that should no longer be used. Erasure
follows the data-protection lifecycle rather than an ordinary edit.

### Bookings and allocations

Everything that occupies court time is a `Booking`. Member bookings, training, league matches and
court closures differ through their booking card, not separate occupancy tables.

A booking has one or more `CourtAllocation` rows. Each stores start and end instants. A PostgreSQL
GiST exclusion constraint rejects overlapping active allocations for the same court. Application
checks improve the response, but the database is the final concurrency guard.

A multi-court appointment is one booking with several allocations. It has one cancellation, one
participant list and one entry in booking views.

### Cards and participant slots

A booking card controls its name and colour, allowed player counts, guest use, whether it counts
toward limits, booking roles and managing roles.

An empty booking-role set permits every authenticated member account. An empty managing-role set
permits only the owner and administrators to manage the booking. Managing roles never inherit from
booking roles.

A participant card fills a player slot without identifying a person. A free-text guest is another
participant kind. A booking card defines exact allowed player counts. The booker fills one slot;
each remaining slot contains a member, guest or participant card. Cards with no player count do not
track participants.

### Series

A series stores its recurrence rule and ordered courts. Creation materialises each accepted
occurrence as a normal booking so the same database constraint protects it.

A series ends by date or occurrence count, never both or neither. Expansion is bounded by the club's
configured horizon, and the preview reports truncation.

Creation tolerates partial success because the creator approves skipped dates. Each occurrence is
checked again when written. Moving and cancelling a series are atomic across the selected scope:
one occurrence, this and following, or the complete series.

## Booking rules and flow

Rules are configured data evaluated by `RuleEngine`. Evaluation collects every applicable
violation instead of stopping at the first.

| Rule | Meaning |
| --- | --- |
| `OPENING_HOURS` | The period lies inside configured hours |
| `SLOT_GRID` | Start and end align with the booking grid |
| `ADVANCE_WINDOW` | The member may book this far ahead |
| `MAX_OPEN_BOOKINGS` | The member may hold this many future bookings |
| `MAX_BOOKING_DURATION` | One booking may last this long |
| `CANCELLATION_DEADLINE` | The member cancels before the boundary |
| `NO_COURT_BOOKING` | The membership category may not book courts |

Membership-scoped rules come from the current membership type. A club may configure a fallback for
people without current membership. Without it, no membership-scoped rule applies. Facility rules
still apply.

Entitlement rules are administratively overridable. Opening hours and grid alignment describe the
calendar and are not. `NO_COURT_BOOKING` also applies when a member moves an existing booking.

A booking request authenticates and authorizes, validates the request, evaluates all rules, writes
booking and allocations in one transaction, translates a collision to `409 Conflict`, publishes
the committed event and returns the identifier. An `Idempotency-Key` identifies the attempt, so
repeating it returns the same result.

### Errors

The API uses RFC 9457 problem details. Every type is a stable `urn:courtside:error:<slug>`.
Translatable domain failures contain `violations` with i18n codes and named parameters. Bean
Validation uses `fieldErrors`, adding the rejected field to the same shape.

The API refuses unknown JSON fields, duplicate keys, repeated scalar parameters and incompatible
JSON types. Framework, filter, connector and unmapped-path failures use the same problem format even
when no controller runs. Invalid HTTP framing is rejected at Caddy and the application connector.

### Court plan and privacy

The day plan is the primary member view. Courts share the available width and larger facilities
scroll horizontally. Headings and the time axis stay visible. Occupancies span their duration.

Mouse users may drag over adjacent free cells. Touch and pen input keep scrolling and use the
duration control. The current day marks the current time and offers a return action. A date control
opens another day directly.

The public grid shows occupancy, the booking-card label where appropriate and participant count. It
does not publish participant names. Owners see their details. Administrators and configured managing
roles use a separate managed-booking view.

A member recorded as a participant receives a message and may remove themselves without the
booker's approval. Removing one participant does not cancel the booking.

## Configuration and administration

| Layer | Examples | Changed by |
| --- | --- | --- |
| Build | defaults, migrations and shipped rows | the Courtside project |
| Deployment | database, mail, origin, telemetry and secrets | the operator |
| Database | branding, courts, hours, grid, time zone and rules | the board |

Routine board settings belong in the database and administration UI. Process wiring and external
dependencies belong to deployment configuration.

The public configuration contains club identity, legal and documentation links, time zone, language
and grid duration. The frontend always links to documentation: a club may override the target, and
an absent override uses the published Courtside documentation on GitHub Pages.
The PWA manifest and the browser tab icon use the same identity: the club logo, or the Courtside
mark while none is set. Logo URLs are root-relative or HTTPS. Remote logos disclose the visitor's
address and Courtside origin to their host, so club-hosted images are preferred.

Grid changes are refused when active or future bookings or opening hours no longer align. Time-zone
changes are refused while a confirmed booking has not ended. These writes serialize with booking
and opening-hours changes through the club configuration row.

The setup overview derives progress from current configuration, facilities, membership types and
roster state. It stores no checklist flags and shows a failed state request instead of partial
progress.

## Membership data exchange

A source describes one external export. It stores column mapping, separator, character set,
category mapping, source-owned fields, default membership type and the threshold for confirming
disappearing memberships.

Source plus member number identifies an external record. Names and email addresses do not. One
person may hold references from several sources.

The browser reads a selected file locally to offer its headers and category values. Uploading a
snapshot creates a preview with creations, changes, ending memberships, invalid rows, possible
duplicates, shared mailboxes and accounts to create. It writes no roster data.

Execution applies the reviewed change set in one transaction. It refuses stale previews. Runs for
one source serialize, and success supersedes older previews. Repeating the same snapshot makes no
further changes.

Source ownership applies to updates. A source does not overwrite a club-owned field on an existing
person. A new person receives every mapped value.

An import may open a `MEMBER` account when the membership type grants one and the person has an
address. It never overwrites an account or grants an administrative role. Generated credentials are
mailed and never returned to the board.

When membership disappears, an account holding only `MEMBER` is disabled. An account with another
role remains enabled and loses `MEMBER`. Import never re-enables an account or disables an admin.

Current exports cover the roster, confirmed bookings for a club-local period and all data held about
one person. CSV exports use configurable separator and character set. The per-person JSON export is
available from the roster and records that the request was answered.

## Identity and credentials

Accounts sign in by username. Passwords use Argon2id with `m=19456`, `t=2`, `p=1`. Successful login
rehashes an older encoding when possible. Failure to store that opportunistic rehash does not reject
the correct password.

A permanent password has 12 to 256 characters. Courtside rejects common passwords, identity terms
and an issued one-time credential. Password changes also check the Have I Been Pwned range API. Only
the first five hexadecimal characters of its SHA-1 protocol digest leave the instance. Failure of
that check refuses a password change but never blocks sign-in.

The board can create an account, correct username and language, change roles, change availability
and issue credentials. Generated credentials are mailed, expire and require a permanent password.
The board never receives plaintext credentials.

Self-service recovery mails a single-use code for a username without changing the account. Redeeming
the code accepts a permanent password and ends every session. An email-address request mails each
username registered to that address. Responses do not reveal whether the subject exists.

Correcting an email address invalidates credentials and reset codes sent to the old one. Disabling
an account, removing a role, changing membership, correcting username or replacing a password raises
the security epoch and invalidates older sessions.

### Sessions

Spring Session stores sessions in PostgreSQL. HTTPS uses `__Host-SESSION` with `HttpOnly`, `Secure`,
`Path=/`, no `Domain` and `SameSite=Lax`. The readable CSRF cookie follows the same host boundary.
Local HTTP uses unprefixed development names.

Inactivity and absolute lifetime both bound a session. The absolute lifetime survives application
restart. Cleanup removes rows expired by either rule.

An account may hold a configured number of sessions. A later sign-in removes least-recently-active
excess sessions rather than refusing access. Members can list browsers and revoke sessions.
Administrators may revoke one account or all sessions after recent password proof.

Browser-visible revocation handles are one-way values, not session credentials. The view exposes
neither raw user agents nor source addresses.

## Notifications

German and English notification templates ship as resource bundles. They are not editable at
runtime. A message uses the recipient account's language.

Current messages cover generated credentials, password-reset codes, username reminders, booking
confirmations, participant additions and withdrawals, displaced bookings and upcoming reminders. A
series sends no confirmation per occurrence. Displacement informs people but does not cancel the
booking.

Each attempted message has a `message_record` with account, kind, `Message-ID`, time and state. The
states are `queued`, `handed_over`, `refused` and `failed`. `handed_over` means the relay accepted the
message, not that a mailbox delivered it.

Temporary transport failures are retried. A definite recipient refusal is not. Failed publication
remains outstanding for a later retry. Credential creation and handover share a transaction, so a
credential the relay never accepted does not replace the stored one.

Members choose optional message kinds. No opt-out means enabled. Credentials, displacement and
participant-addition notices cannot be disabled because no other product path replaces them.

## Security model

The application owns authentication, authorization, validation, sessions, CSRF, data minimisation
and safe failures. The reference deployment owns its network topology and proxy policy. The operator
owns hosts, credentials, DNS, certificates, backups, monitoring and incident response.

Maintained security contracts include the production architecture and workflow maps, authorization
policy, cryptographic inventory, published-resource inventory and data-protection inventory. Tests
compare them with the running application, API, source, schema, workflows and Compose files. New
entry points, clients, listeners, cryptographic uses and stored fields must be classified.

Spring Security applies an explicit access decision to every operation, including the routes open
to anonymous callers. Object checks prevent an account from reaching another member's booking
merely by knowing its identifier. An invisible booking answers `404` like an unknown one.

CSRF uses a double-submit cookie. Only the session endpoint issues its token, so a cookieless service
worker request cannot replace the token held by a signed-in page.

Rate limiting runs before password verification. Source buckets contain concentrated attempts, and
a concurrency guard bounds Argon2 work. Distributed attempts produce a privacy-safe metric and log
event instead of an instance-wide lockout an anonymous caller could hold closed. Caddy replaces the
client-address header before the application sees it, and the reference deployment publishes no
application port that could bypass that assertion.

The application sets `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin` on its own responses.
For secure requests, Spring Security also sets `Strict-Transport-Security`. Caddy repeats nosniff,
frame denial and the referrer policy at the edge. `Permissions-Policy` is the only response policy
here that comes only from Caddy.

Every supported recipe routes web traffic through Caddy. The `standard` and `full-self-hosted`
recipes let Caddy terminate public TLS on ports 80 and 443. The `funnel` and
`existing-infrastructure` recipes put an operator-owned HTTPS ingress in front of Caddy's
loopback-only listener. That outer ingress replaces client forwarding headers and supplies an exact
HTTPS signal. Caddy accepts client-address metadata only from the documented same-host boundary,
refuses another scheme, normalizes every header sent to the application and applies the same host,
request-size, error and response-header policy as the public path.

Verified TLS to PostgreSQL and between Caddy and the application is optional hardening. Enabling it
fails closed on inconsistent certificates, keys, authorities or transport settings. The standard
single-host installation remains supported without these optional components.

The self-hosted mail recipe uses Stalwart. The application requires STARTTLS and validates its relay
certificate by default. An operator may explicitly disable issuer and hostname verification for a
relay whose certificate the container cannot validate; the
[`operations guide`](../deploy/guides/operations.md) states what that permits. Other recipes use an
operator-selected relay.

GitHub Actions are pinned by commit. Dependabot reports updates. Build and release scan source and
images with Trivy. Release and nightly images are signed and carry SBOM and provenance attestations.
Assessment profiles combine contract, authorization, browser, OpenAPI fuzz and bounded scanner
checks. Public evidence excludes credentials, cookies, bodies and exploit details.

See [`security-assessment.md`](security-assessment.md),
[`security-findings.md`](security-findings.md) and [`security-risks.md`](security-risks.md).

## Data protection

The operating club is controller for its members' data. Courtside supplies controls and guidance but
does not choose lawful basis, retention periods or operating policy.

The data-protection inventory classifies every database column and API path or query parameter as
personal, pseudonymous, secret or operational. A migration or API change fails until new data has a
classification and lifecycle.

Values that directly name a person do not travel in URLs. Searches containing names or external
member numbers use bodies. Random internal identifiers may remain in authorized paths and queries;
their boundary is recorded in `security-risks.md`.

The audit log stores identifiers, event types, actors and non-personal change descriptions. It does
not copy names, addresses, credentials or free text. Erasing the referenced person removes the link
without rewriting the append-only event.

Session rows are deleted after inactivity or absolute expiry. Import previews retain their resolved
change set only for the configured period and never store the uploaded file. Message records leave
with their account.

An administrator can export all data held about one person. The response excludes other people's
identity even when they share a booking or audit event. Producing it is itself recorded.

Application and security logs contain no names, email addresses, payment data or request content.
Known accounts use immutable identifiers. The reference deployment also redacts database and proxy
output before bounded local retention. Administrators can inspect only those normalized records;
the operator still owns durable storage, external access and the longer retention policy.

## Operations and observability

The image exposes `/actuator/health`. Mail health is available to administrators at
`/actuator/health/mail`. Other management endpoints are not public by default.

Structured ECS logs go to standard output. Metrics and traces can use OTLP when the operator enables
their separate endpoints. Courtside requires no monitoring backend.

The reference deployment routes application, database and proxy output through a loopback-only,
fixed-source collector. It writes a small rotating volume that the application reads without Docker
control access. The administration distinguishes unavailable, dropped, rotated and incomplete
evidence and never presents this lossy recent view as a durable audit log.

Current domain metrics cover created bookings, rule rejections, booking conflicts, failed password
rehashes and message outcomes. Spring metrics cover HTTP, JVM and connection pools. Slow-query logs
contain placeholders rather than values and include trace identifiers when sampled.

The reference deployment is a supported starting point, not a managed service. Courtside validates
configuration it owns and supplies lifecycle tools. The operator owns the machine, external
services, credentials, backups and availability.

## Verification strategy

| Risk | Evidence |
| --- | --- |
| Booking rules | focused unit tests |
| Court overlap | PostgreSQL integration and concurrency tests |
| Upgrades | migration, backup and restore qualification |
| Module boundaries | Spring Modulith and architecture tests |
| API compatibility | OpenAPI generation, coverage and wire tests |
| User journeys | Playwright in Chromium, Firefox and WebKit |
| Deployment | recipe and container qualification on amd64 and arm64 |
| Security | inventories, CodeQL, dependency scanning and bounded assessments |

The pull-request classifier selects checks from closed path inventories and falls back to the full
build for unknown or structural changes. Pushes to `main`, schedules and releases execute the full
set. A scheduled test is regression evidence, not the first execution of a changed scheduled path.

See [`quality-strategy.md`](quality-strategy.md), [`security-assessment.md`](security-assessment.md)
and [`releasing.md`](releasing.md) for the detailed workflows.
