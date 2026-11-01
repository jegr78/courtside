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
- a first-in, first-out waitlist for taken courts;
- configurable booking rules;
- people, memberships, accounts, roles and sessions;
- repeatable membership snapshot imports;
- roster, booking, audit-log, message-log and per-person data exports;
- an in-app notification centre, localized email notifications and a message log;
- an append-only audit log;
- a key-protected court occupancy signal that building automation polls;
- court-utilisation reporting and board statistics for any period;
- a React and Vite progressive web application;
- a multi-architecture image and four reference deployment recipes.

Bookings and administrative changes require authentication. Anonymous callers may read public
configuration and anonymised occupancy and may use the bounded account-recovery endpoints. A caller
holding the board's occupancy key may read the per-court occupancy signal. The product has no
anonymous booking path.

Courtside is licensed under AGPL-3.0-or-later. Each instance publishes its version, build commit and
configured source location through `GET /api/source`.

## Distribution and compatibility

A tagged release publishes a multi-architecture image on GHCR, its OpenAPI document, release notes,
a software bill of materials and provenance. The release candidate workflow builds and qualifies the
image from the release commit before the tag exists, and the release workflow then signs and
publishes that exact digest without building again. A release candidate follows the same
qualification path but receives no floating version tag.

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
restore checks use the locally trusted immutable release model, an empty PostgreSQL 18 target and
the matching application image, with cleanup recorded before the target starts. Exact-release
updates create a recovery unit before pulling or migrating. A bundled PostgreSQL 17 to 18 update
restores into an isolated named volume and can reactivate the old application and untouched old
volume if target startup fails. Ordinary application schema migrations never start an older
application afterward and never claim an automatic database rollback. The manifest carries
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

The repository UAT smoke also accepts an existing local engine-native image ID and full source commit
for isolated native Linux qualification. It verifies the clean source checkout, image filesystem,
TLS source response, image and host architecture, and running image identity without building or
pulling. Its deployment, authentication, booking-persistence and hardening receipt follows owned
cleanup. This local identity is not a registry manifest digest or release-archive qualification.
The isolated lifecycle does not use persistent UAT or host Funnel state.

Explicit local PERFORMANCE and SECURITY starts reuse a production image and its separately
selected fixture overlay. Their proof binds the clean source commit, actual parent layers,
compiled application and helper bytes, and observed engine/runtime image identities. Seeding
uses the retained fixture proof. Runtime image drift or foreign ownership refuses execution or
cleanup. Imported images remain shared inputs and are retained after owned resource cleanup.

Two interfaces are public compatibility contracts:

1. documented environment variables used by the application and reference deployment;
2. the REST API published in the OpenAPI document.

Renaming or removing either is a breaking change, and so is narrowing what either accepts, such as a
tighter bound on a request field. Additive changes remain compatible when existing clients and
configurations continue to work.

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
as one application process and uses PostgreSQL 18.

| Module | Responsibility |
| --- | --- |
| `access` | Dynamic access grants per booking and the port to an access-control system |
| `api` | OpenAPI-generated controller interfaces and transport models |
| `audit` | Domain-event log and administrative audit view |
| `booking` | Bookings, participants, series and court allocations |
| `card` | Booking and participant card configuration |
| `config` | Club identity, time zone, language and grid configuration |
| `dataexchange` | Imports, exports and subject-access responses |
| `facility` | Courts, access points and opening hours |
| `identity` | People, accounts, roles, credentials and sessions |
| `member` | Membership types, memberships and roster administration |
| `notification` | Notification centre, email creation, delivery state and preferences |
| `reporting` | Board statistics composed from the read ports of the other modules |
| `rules` | Rule-set administration and rule evaluation |
| `shared` | Shared domain events and cross-cutting value types |

The `demo`, `performance` and `securityassessment` modules contain fixtures for disposable
environments. Packaging places them in a separate artifact. The production image rejects them.

### Module boundaries

Each module's base package is its public Java API. Subpackages are implementation details. A
module's `package-info.java` declares allowed dependencies. Modulith verification rejects
undeclared dependencies and cycles. `shared` and generated `api` are the shared modules.

`booking` depends on `rules`, `facility`, `member` and `card`. Notification and audit behavior uses
domain events instead of reverse dependencies into the booking core. `reporting` reads booking,
membership, account and message figures through interfaces those modules publish in their base
packages; none of them depends on it. `access` depends on `card`, `config`, `facility` and `rules`,
reads bookings only through `shared.BookingAnnouncer` and reacts to their events after commit;
`booking` does not depend on it and reads a booking's own code through `shared.IssuedAccessCodes`,
which `access` implements. `notification` depends on `facility` and `member` only to tell current
members a door code, which no booking event carries, and on `access` only for `access.grant.installed`.

Controllers implement generated interfaces and translate HTTP. Services own business operations.
Repositories persist state and do not decide policy.

### Events and transactions

State-changing services publish typed domain events. The audit listener runs before commit and
writes its row in the same transaction. A covered change cannot commit without its audit event.
Series creation is the exception: each occurrence commits on its own, and the series event commits
in a transaction of its own after them, also when a later occurrence fails unexpectedly. A crash
between the last occurrence commit and the event commit leaves those occurrences without an event.

Mail listeners run before commit, like the audit listener, and store the notification-centre entry
and the outbox message in the same transaction. A committed change therefore always has its queued message, and a change whose
message cannot be stored does not commit: the request fails and nothing of it remains. A mail
listener never talks to the relay, so a failed handover cannot roll back a change that committed.
The members' door code is the exception: its listener runs after commit through the publication
registry, off the request thread, and queues one page of current members per transaction. After a
crash the walk repeats from the start, so earlier pages may be told twice and none is skipped.
Publishing such an event outside a transaction is refused. Other after-commit listeners run through
Spring Modulith's event publication registry, whose incomplete publications remain available after
a restart.

`booking` publishes an event when a booking is confirmed, cancelled or displaced or falls due for
its reminder, when a participant is recorded or withdraws, when a series is created, cancelled
or moved, and when a freed slot is offered to a waiting member. A series change is one event naming the series and every occurrence it touched, and no
occurrence announces itself beside it. Cancelling an occurrence as a single booking announces that
booking alone. Cancellations and moves name the acting account, so a consumer can tell an owner's
change from a board's. A cancellation carries its reason code when one was given, and a move the
slot and courts its earliest occurrence held before. A cancellation that finds the booking already
cancelled changes nothing and announces nothing.

Events contain identifiers and non-personal change descriptions. Free text, names and email
addresses are not copied into audit payloads. Stored event payloads evolve additively.

Every application connection cancels a statement after 15 seconds and gives up a contended lock
after 5. Statistics reads allow 30 seconds per statement, scheduled sweeps ten minutes, and
migrations run without a statement limit on connections the pool replaces afterwards. A transaction
that begins while serving a request is checked against a 30-second deadline at each statement;
statistics, exports, subject access and imports state 120. A deadline that fires rolls that
transaction back and answers `503` `urn:courtside:error:statement-timeout` or
`urn:courtside:error:transaction-timeout`; work an earlier transaction of the same request committed
stays. Startup, scheduled and mail work has no caller waiting and is not held to the request
deadline.

PostgreSQL state remains the source of truth. Courtside does not use event sourcing or an external
message broker. The database must enforce occupancy, and one club does not need another service for
internal events.

## Domain model

[`data-model.md`](data-model.md) is the table reference. This section explains the choices behind it.

### People, memberships and accounts

`Person`, `Member` and `UserAccount` are separate concepts. A person is the identity and contact
record. A member row is one dated period of a person's membership: its type, its first day and an
optional end, the first day it no longer holds. A person may hold several periods, which never
overlap. An account grants sign-in access and roles. A person may have no account.

Email is optional for a person and mandatory before that person receives an account. It is not
unique because several people may use one family mailbox. Username is unique within an instance.

A period holds on a day when it began on or before it and has no end or ends after it. Start and
end may lie in the future, so a board can schedule a departure or a type change; a period that has
not begun grants nothing yet. A rejoin adds a period and keeps the earlier ones, an import type
change ends the running period on the run day and opens one of the new type, and ending a
membership also removes the periods scheduled to begin later.

A guardian relationship lets one person act for another, for example a parent for a child. Only
the board creates, changes, ends and removes one, and every change is recorded in the audit log. It
grants exactly the actions the board chose from a fixed list: viewing the dependant's bookings,
booking for them, cancelling their bookings, reading their messages and account tasks such as
requesting new credentials. It is not an account type and grants no club role. Both people hold their
own account, and a relationship grants nothing while the guardian's account is disabled or either
account is gone. It starts on the day the board creates it and holds until the end the board may set,
change or clear at any time; there is no birth date, so the board ends it when the dependant comes of
age. A guardian holds one relationship to a dependant on any day, and two people cannot be each
other's guardians at once.

A guardian acts for a dependant from their own session, and every action reads the relationship
afresh, so ending it takes effect at once; only an action whose check passed just before the board
ended it can still complete. A booking a guardian makes is held by the dependant's
account with the dependant in the first place, and every rule, quota, card and deadline is measured
against the dependant and the dependant's roles; neither the guardian's roles nor the dependant's
administrator override apply. The guardian is recorded on the booking and in the change log as the
one who acted. A guardian cancels only bookings the dependant holds, in the dependant's name and
under the dependant's deadline. Reading a dependant's messages marks nothing read. A guardian never
requests new credentials for a dependant whose account holds the administrator role. Somebody acted
for without a relationship holding today is answered as no dependant, and an action the
relationship does not grant is refused by name.

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
toward limits, booking roles, managing roles, whether its bookings receive access codes and whether
they signal occupancy. The access attribute, `grantsAccess`, is off by default and never on for the closure card: `CardService`
refuses it with `card.closure.grantsNoAccess`, and the `booking_card_closure_grants_no_access` CHECK
refuses it below the service. The last, `signalsOccupancy`, decides whether its bookings count as
occupied for building automation; it is on by default and off for the closure card the same way.

An empty booking-role set permits every authenticated member account. An empty managing-role set
permits only the owner and administrators to manage the booking. Managing roles never inherit from
booking roles.

A participant card fills a player slot without identifying a person. A free-text guest is another
participant kind. A booking card defines exact allowed player counts. The booker fills one slot;
each remaining slot contains a member, guest or participant card. The member search that fills those
slots leaves out the searching person, because the booker already holds a slot. Cards with no player
count do not track participants.

### Series

A series stores its recurrence rule and ordered courts. Creation materialises each accepted
occurrence as a normal booking so the same database constraint protects it.

A series ends by date or occurrence count, never both or neither. Expansion is bounded by the club's
configured horizon, and the preview reports truncation.

Creation tolerates partial success because the creator approves skipped dates. Each occurrence is
checked again when written and commits on its own, and the series is announced with the occurrences
that committed. Moving and cancelling a series are atomic across the selected scope:
one occurrence, this and following, or the complete series. Moving or cancelling this and following
or the complete series leaves occurrences that have already started as they were played.

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
| `BOOKING_HOURS` | The period lies between the category's earliest start and latest end |
| `WEEKLY_BOOKED_HOURS` | The member's booked time in one week stays within this many hours |
| `MIN_BOOKING_DURATION` | One booking lasts at least this long |
| `NO_SHOW_LIMIT` | The member has fewer than this many counting no-shows in the last days |

Membership-scoped rules come from a membership type, and only for a person who holds a period
today. A booking, move, series occurrence or cancellation is measured against the type of the
period covering the slot's club-local day. Where no period covers that day, the rule set the club
bound for people without a membership type applies, and without one the type held today. A person
who holds no period today is measured by that fallback, and without one by no membership-scoped
rule. Facility rules still apply.

Entitlement rules are administratively overridable. Opening hours and grid alignment describe the
calendar and are not. `NO_COURT_BOOKING`, `MAX_BOOKING_DURATION`, `MIN_BOOKING_DURATION`,
`BOOKING_HOURS` and `WEEKLY_BOOKED_HOURS` also apply when a member moves an existing booking.

`WEEKLY_BOOKED_HOURS` measures the club-local week, Monday 00:00 to Monday 00:00 in the club time
zone. It sums the confirmed bookings the member booked on cards that count against limits, each
with its duration once whatever the number of courts, by the week its start falls in. A booking on
a card that does not count against limits is not judged. Bookings judged together, such as the
occurrences of a series, count for each other, and a move leaves the moved bookings out of the
week they leave. The booking grid lock serialises the check with the write, so concurrent
requests cannot together pass the limit. Taking a waitlist offer is a booking and is judged like
one, and a member past the limit is skipped when the slot frees.

`BOOKING_HOURS` narrows the opening hours for one membership category and never widens them. Its
window holds for every weekday, is read in the club time zone and does not cross midnight. Like the
opening hours it ends at 23:59 at the latest, so a window that lasts until closing names the
closing time.

`NO_SHOW_LIMIT` counts the unlifted no-shows recorded for bookings the member holds whose start lies
within its window of days before now. It counts nothing while the club records no attendance, and
it does not judge a move, because a move adds no booking.

### Attendance

A club switches attendance on in its attendance policy. Without it nothing below has an effect and
existing installations keep their behaviour. The member who holds a booking checks in from 15
minutes before its start until its end, and a board records `ATTENDED` or `NO_SHOW` for a booking
that has started, replaces it or removes it. A booking cancelled before its start has nobody to
wait for and takes no record. A booking with nothing recorded is never a no-show.

The policy may name a release time of 5 to 120 minutes. A sweep then cancels every confirmed
booking on a card that counts against limits whose start lies that long in the past while nobody
checked in, frees its courts under the booking grid lock and records the release. The booker and
every player with an account receive one `BOOKING_RELEASED` message, because only the booker can
check in and a player at the court would otherwise not learn why it is gone. A release is not
a no-show. A board lifts a person's counting no-shows: they stay recorded and stop counting, which
lifts a `NO_SHOW_LIMIT` refusal.

A booking request authenticates and authorizes, validates the request, evaluates all rules, writes
booking and allocations in one transaction, translates a collision to `409 Conflict`, publishes
the committed event and returns the identifier. An `Idempotency-Key` identifies the attempt, so
repeating it returns the same result.

### Errors

The API uses RFC 9457 problem details. Every type is a stable `urn:courtside:error:<slug>`.
Translatable domain failures contain `violations` with i18n codes and named parameters. Bean
Validation uses `fieldErrors`, adding the rejected field to the same shape. The web client
carries a message for every declared type, and a violation code it does not know yet reads as a
refusal it cannot name rather than as a general failure.

The API refuses unknown JSON fields, duplicate keys, repeated scalar parameters and incompatible
JSON types. It also refuses a query parameter the operation does not declare and an optional one
sent without a value, which Spring would otherwise read as absent and replace with its default. Framework, filter, connector and unmapped-path failures use the same problem format even
when no controller runs. Invalid HTTP framing is rejected at Caddy and the application connector.

### Court plan and privacy

The day plan is the primary member view. Courts share the available width and larger facilities
scroll horizontally. Headings and the time axis stay visible. Occupancies span their duration.

Mouse users may drag over adjacent free cells. Touch and pen input keep scrolling and use the
duration control. The booking dialog mentions the drag only on a device with a fine pointer. The current day marks the current time and offers a return action. A date control
opens another day directly.

The public grid shows occupancy, the booking-card label where appropriate and participant count. It
does not publish participant names. Owners see their details. Administrators and configured managing
roles use a separate managed-booking view. The plan reads a week's occupancy and its reserved slots
with one request each; such a read covers one day or at most seven, so a week costs the caller's
request budget the same however many days it shows.

The session reports whether an active card names one of the account's roles other than MEMBER as
managing role, the same filter the managed-booking view applies, and whether an active card that
tracks no players permits one of its roles. The client offers the
managed-booking view and the series form only on those grounds; an administrator always has both.

A member recorded as a participant receives a message and may remove themselves without the
booker's approval. Removing one participant does not cancel the booking.

A confirmed booking whose card grants access carries the static codes of every active access point
that serves one of its courts, with a validity window from its start less the club's access lead to
its end plus the access lag. The booker's own bookings, a granted guardian's view of a dependant's
bookings and a player's own participations carry them; the managed-booking view, the public plan,
admin views and anybody outside the booking never do. A response carries a code only while the
window has not ended. With an access-control system the booker's own bookings and a player's own
participations also carry the booking's own code under each active access point without a static
code that serves it, read from `IssuedAccessCodes` only after the page has established that the
reader takes part; a guardian's view carries static codes only. Until a door accepted the code the
grant says `codePending`, and `emergencyCodeKept` says that one of those access points keeps an
emergency code. The installed app keeps the first page of the member's upcoming bookings and of
their participations offline, codes included, and drops a code from a cached page once its window
has ended.

### Waitlist

A member may queue for a court and period somebody else holds by selecting it in the court plan. The
entry names the card, players and note the eventual booking will carry, and joining runs every check
a booking of that slot runs except that its court is free. A slot nobody else holds, a second open
entry on the same court at an overlapping time and a 21st entry whose slot has not ended are
refused. The 21 counts every entry until its slot ends except one whose booking still holds its court
at an overlapping time, so neither leaving nor cancelling or moving the booking an entry became can
get round it.
Each court, start and end has its own first-in, first-out queue.

The waitlist is part of `booking`, in `booking.waitlist`. The booking write has to refuse a
reservation and an acceptance has to write a booking, so a module of its own would depend on
`booking` while `booking` depended on it.

When a cancellation, a cancelled series or a moved series frees the slot, the same transaction
offers it to the first entry that passes every check a booking of the slot would pass, with the
card, players and note named on joining. A disabled account or any refused check closes that entry
as skipped and the next one is asked. The offer reserves the court for the club's offer window, 15
minutes unless the board changes it, and ends at the slot's start at the latest. While it stands,
the booking write and a series move refuse the court to every other account, a new series and its
preview treat that date as taken, and the court plan shows it as reserved without naming anybody.
The board and a closure go first: a booking by an admin or on the closure card, a series an admin
creates and a series move an admin makes take the court and close the offer as withdrawn. A move
of a closure series goes first only while the closure card still admits the mover's roles. A
closure card whose allowed roles are cleared admits every account, so any account can then end an
offer by closing the court. The
member accepts in Courtside, which turns the reservation into an ordinary booking under every rule
in one transaction; a refused rule leaves the offer open until the next sweep, which passes it on if
its member still fails the checks. Declining or
leaving passes the offer on at once. The member's own booking of the slot, or a move of their own
series onto it, closes their entry as booked. A refusal of the offer mail that names the
recipient's address skips an offer that is still open and passes it on, because its member will not
hear of it by mail. A sweep every 30 seconds expires offers past their deadline, skips offers whose
member no longer passes the checks, passes both on, closes entries whose slot has started, deletes
entries whose slot has ended and offers any free slot a queue still waits for.

Every path that writes a booking, cancels one, moves a series or changes a queue first takes the
lock the booking grid coordination holds on the club configuration row, so a booking and an offer
never meet on one court. GiST exclusions back this up in the database: one over offered entries
per court and time, one over each account's open entries per court and time. A member sees only
their own entries and their state, never another waiting member or a position.

### Partner search

The "looking for a partner" participant card holds a player slot like any other card and names
nobody. Its holder may offer that slot to other members while the booking stands, has not started
and is not part of a series; offering it again changes nothing, and withdrawing it ends the offer.
A booking offers one place at most, the first slot the marker holds.

`GET /api/partner-invitations` lists the offered places a member may take: the slot, the courts and
the card, and nothing that names the holder, another player or the booking. A member sees a place
only when their account is enabled, their membership type may book, the booking's card admits their
roles, and they neither hold nor play in the booking. The court plan shows nothing new, because it
is readable without an account.

Taking a place locks the booking row, checks all of the above again and rewrites the marker's
participant row into the member's, so the booking keeps its player count and positions and no
booking rule that judges the booking itself runs again. The row lock orders every acceptance against
a second one and against a cancellation; a unique index on the booking's members refuses a member
who already plays. The offer is deleted with the acceptance. A cancelled or started booking offers
nothing from that moment, and a sweep every five minutes deletes those offers. A closure that
displaces the booking leaves the offer standing, as it leaves the booking.

The holder is told who took the place, as they are told who withdrew; the member is told where they
now play. Both messages may be switched off.

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
an absent override uses the published Courtside documentation on GitHub Pages. The link is the one
configurable target a club can redirect but not remove, because a member who cannot reach any
documentation has no way to learn what the product does.
The PWA manifest and the browser tab icon use the same identity: the club logo, or the Courtside
mark while none is set. Logo URLs are root-relative or HTTPS. Remote logos disclose the visitor's
address and Courtside origin to their host, so club-hosted images are preferred.

An installed instance carries the club rather than the product. `/api/public/config/icon` serves PNG
icons at 180, 192 and 512 pixels, rasterised from the uploaded logo or drawn from the Courtside mark.
A maskable icon is opaque and keeps its content inside the central 80 % a launcher may crop to: a logo
sits on the colour of its top-left pixel when that pixel is opaque and on white otherwise, the mark
on shade. A logo configured only as a URL is never fetched by the server, so such a club keeps the
URL as its plain icon and gets the Courtside mark for the PNG and maskable icons. The manifest names
each icon with a version derived from the logo, so a new logo reaches an installed app as a new URL.
iOS ignores the manifest and reads the `apple-touch-icon` link, which names the 180-pixel maskable
icon.

The manifest's `short_name` is what fits under a home-screen icon, at most twelve characters. A
board may choose one; otherwise it is the club name when that fits, its leading words when they do,
and its first twelve characters otherwise. `background_color` is the dark page colour the
application paints first, so the splash screen does not flash another colour, and `theme_color` is
the primary colour. The web client also sets `<meta name="theme-color">` to the primary colour
whenever the club configuration arrives or changes, so the status bar follows a new colour without a
release. `lang` and the texts of the description and the two shortcuts, to the court plan and to the
member's own bookings, follow the club's default language.

Opening hours are versions of one weekly template, each taking effect on a date in the club's time
zone. The seeded version has governed since the beginning; a change creates or replaces the version
starting on the chosen day, today or later, so the days before it keep the hours they had. A
version that has not started yet can be removed, and the one before it governs its days again. The
court plan, the opening-hours rule, utilisation statistics and the impact preview each read the
version in force on the day they evaluate. Members whose bookings a change leaves outside the hours
are told about the bookings from that day up to the next scheduled version.

Seasons and holidays replace the weekly hours for a range of days. Each is a weekly template with a
first and a last day; a holiday holds the same window, or none, on every weekday. On a given day a
holiday governs first, then a season, then the version in force. Seasons do not overlap each other
and holidays do not overlap each other, which an exclusion constraint on `opening_period` enforces;
a holiday inside a season is the intended case. A court closure takes one court out of the plan for
whole days while the other courts keep the hours of the day, and closures of one court do not
overlap, enforced the same way. The public booking grid carries the seasons and holidays that
overlap the days it is asked for, today by default, with their names, which the court plan shows,
and the closures on those days without the reason the board entered.

These entries are correctable while they lie ahead: an entry starts today or later and ends by
9999-12-31, and until it starts every field can change, its kind and court included, and it can be
removed. Once it has started, its first day, its kind, its court and its hours are fixed and it
cannot be removed; it can only be renamed and ended early, as early as yesterday. An entry that has
ended is read-only. This is a deliberate exception to correcting whatever a club entered: the days
before today keep the hours that governed them, so statistics and the audit trail stay true. A
board corrects a running entry by ending it yesterday and adding a new one from today.
Bookings already on a day that a new entry closes stay; the opening-hours rule refuses every booking
written or moved after it, a closed court with `booking.rule.openingHours.courtClosed`. Storing an
entry tells the people in each future booking it newly leaves outside the hours or on a closed
court, naming the kind of entry and never its name; a booking the stored version or another entry
already closed is not announced again, so widening an entry tells nobody twice. The impact preview
answers the same question for an entry before it is stored, and the availability form shows its
count while the board edits an entry, saying nothing while the count is zero. Utilisation
counts open time from the hours that governed each day and does not subtract court closures from
capacity.

Access points are the doors and gates between the players and the courts. A board names each one,
picks the courts it leads to, several courts sharing one and one court served by several, and may
keep the static access code its keypad accepts. A PUT replaces every field, the courts and the code
included, and an active flag takes an access point out of use without losing it. A code is digits
only. A new or changed code has exactly the club's access code length, which `FacilityService`
checks where the code is stored and refuses with `facility.accessPoint.codeLength`; a code stored
before the length changed keeps working. The admin projection under `/api/admin/access-points` is
the only administrative response that carries a code. The audit entries of an access point name its
id, its courts and the fields that changed, never a code, and no error message or log line carries
one either.

A board may open an access point with a static code to every member, for a clubhouse door that is
not tied to a court. `GET /api/my/door-codes` lists the name and code of every active access point
open to members, and it is empty for an account that is not a current member: one whose person holds
a membership period covering today and whose account is enabled. My bookings shows that list at its
top. The installed app reads it from the network first and keeps the last answer beside the bookings
for offline use, with no end of validity, until the next refresh or sign-out. The mark needs a static code: `FacilityService` refuses a mark without one,
or clearing the code of a marked access point, with `facility.accessPoint.openToMembersNeedsCode`
before `access_point_open_to_members_has_code` would. Such an access point may still serve courts and
then hands its code to their bookings as any other one does.

An access point without a static code may keep an emergency code, which the board leaves on the
keypad for the case that a booking's own code is missing or does not work. It follows the static
code's length rule, differs from every static code and is refused beside a static code with
`facility.accessPoint.emergencyCodeNeedsDynamicCodes` before
`access_point_emergency_code_without_static_code` would; a static code that equals another point's
emergency code, or the reverse, is refused with `facility.accessPoint.emergencyCodeCollides`. A new
static or emergency code that equals a dynamic code a door may still accept, drawn or released and not
yet expired in `access_code`, is refused with `facility.accessPoint.codeIssued`, which the access
module answers through the facility port `DynamicAccessCodes`. No message carries it. `POST /api/my/bookings/{id}/emergency-code` and
`POST /api/my/participations/{id}/emergency-code` answer the emergency codes of the booking's dynamic
access points to its booker and players from the start of its window to its end; anybody else, a
request outside the window, a cancelled booking and a booking without such a code answer `409
urn:courtside:error:emergency-code-refused` with `booking.emergencyCode.notParticipant`,
`booking.emergencyCode.outsideWindow`, `booking.emergencyCode.cancelled` or
`booking.emergencyCode.noneKept`. Each answer is audited as
`booking.emergencyCode.requested` with the booking and the access points, never the code. The code
stays valid until the board changes it.

The configuration holds three access settings beside the deadlines: how many minutes before a
booking starts and after it ends its access code works, 0 to 240 and 15 by default each, and the
length of a static access code, 4 to 8 digits and 6 by default. A request that leaves one out keeps
its stored value. A board edits them on the access points page.

#### Dynamic access grants

An access-control system can install a code of its own per booking. `AccessControlConnector` is the
port: `grant`, `reschedule`, `revoke`, `probe`, the board's `connectionChecks` and a local `mappingOf`
that fingerprints how access points map onto the system. An install or revoke answers `Accepted` with the system's reference,
`CodeRejected` when the code is not on the remote user, `RetryLater` with an optional moment before
which it must not be asked again, or `Refused`; the last two carry a scope, `GRANT` for this grant or
`CONNECTOR` for the whole connector. An exception or a call past its deadline is an unclear answer,
and Courtside counts an unclear answer as applied. A reason a connector returns is fixed text for an
operator and never carries a URL, a credential or a code. The deployment selects the connector with
`COURTSIDE_ACCESS_CONTROL_CONNECTOR` and bounds each call with
`COURTSIDE_ACCESS_CONTROL_CALL_DEADLINE`, 15 seconds by default. `none`, the default, registers no
worker, records no grant and leaves every booking path unchanged. `simulated` accepts every call in
memory; it serves development, the demo profile and the browser journeys.

`loxone` manages a Loxone Miniserver over HTTPS: the user-management web services and a token with
the user-management right (0x800) and the right to change codes (0x20) from `getkey2` and `getjwt`; the
Miniserver refuses `updateuseraccesscode` to a token without 0x20. It reaches the Miniserver by serial through the
`getip` answer of `connect.loxonecloud.com`, accepted only under `remcov3.loxonecloud.com` on ports
20000 to 49000 or under `dyndns.loxonecloud.com` on any port, or at a fixed
`https://` URL. A failed request forgets the relay address, and the next call asks for it again. Each
grant is one timespan user named `courtside_` plus the grant id's hex digits, with deletion at its
end, the code and the Loxone groups of its access points. Its window is sent as seconds since
2009-01-01T00:00:00Z, which the Miniserver reads in UTC and its app shows in local time; the token's
`validUntil` is read on the same base. A board picks each
access point's group from the normal groups the last successful probe read; the connector refuses any
other group, and a grant whose access point has none. It changes or deletes only users of that name
that are not administrators, counts a change only on the Miniserver's own reply, and a revoke answers
`Accepted` only after a listing finds none left. The Miniserver's lock after requests without rights
holds every request for five minutes. Once an hour, at the end of a completed pass, a connector that
lists its users is compared with the rows: a listed grant that is removed here and no longer wanted or
refused is revoked again, an installed grant it no longer lists is installed again while wanted, and a
listed id without a row is left alone.

A board's connection check runs at the start of the next pass, before the grants. Each check is its
own call with its own deadline, skipped when a check it requires did not pass, and a check the call
runner abandons is a timeout for that check alone. A failing check does not end the pass; a check that
keeps running past its deadline occupies the call thread like any abandoned call, so the pass's next
call is not sent and the pass ends as an outage. The pass runs a check only while it still holds its
lock and is not stopping; a run cut short keeps no result and stays requested for the next pass. A
result carries the check's name, `PASSED`, `FAILED`, `SKIPPED` or `MANUAL`, an i18n code and string parameters. A Loxone check
that the Miniserver refuses reports `access.check.refused`, and one without a clear answer
`access.check.unclear`, each with the connector's fixed, sanitized text as `reason`; any other
exception from a check becomes `access.check.failed` without its text. A connector without checks of
its own answers one `connector` result, `SKIPPED`. The Loxone connector checks, in this order: `miniserver` resolves
the serial afresh through `getip`, reaches `jdev/cfg/apiKey` over verified TLS in one call and reads
the config version from its answer, which must be at least 14.2.5.16, comparing each segment as a
number; `login` kills the cached token and logs in again with both rights; `groups`
reloads the normal groups and needs one mapped and present for every active access point without a
static code; `probe-user` deletes leftover users named `courtside_probe_` plus 16 hex digits that are
not administrators, creates one without group or code as a timespan user from now for two minutes with
deletion at its end, reads its window and expiry action back through `getuser`, deletes it and finds
none listed; `keypad` is `MANUAL`, because the API does not show whether a keypad accepts a code.
`groups` and `probe-user` need `login`. The probe user's name never matches the grant pattern, so
neither a grant call nor the reconciliation counts it.

An access point with a static code is served by that code only and never by a dynamic grant. A
booking has demand when it is confirmed, its card grants access and at least one of its courts sits
behind an active access point without a static code; the grant covers the union of those access
points with one code shared by everyone in the booking. Its window is the booking's start and end
widened by the club's minutes before and after. A grant is wanted while it has demand and its window
has not ended.

One worker thread runs passes and nothing else. A booking, series, card or access point event and a
board's retry signal it after their commit, a signal during a pass starts the next one at once, and
it runs a pass every 60 seconds without a signal. Across instances a pass holds a PostgreSQL session
advisory lock on a connection of its own and checks that it still holds it before every remote call;
an instance without the lock tries again after five seconds. A row's transaction reads the
application clock once and makes every comparison against that instant, so a fixed instant in a
disposable run governs the pass too. A pass has three steps:

1. It inserts an `access_grant` row, one per booking and never deleted, for every booking with demand
   whose start lies within the booking horizon, the longest `ADVANCE_WINDOW` of any rule set or 14
   days without one, and whose window has not ended. A distant series occurrence waits until it
   enters the horizon. A failure in this step is logged and the pass still acts and releases.
2. It reads the ids of every open row once, rows that may hold something remote first and among them
   those no longer wanted, and visits each at most once. In the
   row's locked transaction it derives the demand again, draws a code when the grant is wanted and
   has none, and decides the action: `grant` while nothing is installed for sure, `reschedule` when
   the installation differs from what is wanted in window, access points or mapping, `revoke` when
   the grant is no longer wanted and something may be installed, and nothing otherwise. A refused
   grant installs nothing more and revokes an installation that is unsure or differs from what is
   wanted, so a refused change never leaves an older window at the door. Before the first call of a
   pass the worker probes the system, and a probe that does not answer or refuses for the whole
   connector ends the pass as an outage without changing a row. Before an install it commits the
   remote side as possibly installed and raises the window end the code may be exposed until, which
   is never lowered. The call runs with no transaction open on one call thread with the deadline.
   When an abandoned call still occupies that thread, the attempt is already committed: it is
   recorded as unclear, the re-probe finds the thread occupied too, so the attempt is undone, the row
   is retried after a minute and the pass ends as an outage. The answer is recorded in a transaction
   of its own. A decision that fails, a mapping that throws, is missing or exceeds 200 characters, or
   a draw that finds no free code, is recorded on the row in a transaction of its own as a counted
   attempt with backoff and its sanitized reason, and the overview lists the row while it has
   attempts.
3. It releases the code of every grant that is not wanted, holds nothing remote and whose exposure
   has ended, and deletes released codes whose exposure has ended.

Every code in use is a primary key in `access_code`, so a code is never drawn for another booking while
a door may still accept it, and a draw never takes the static or emergency code of any access point,
active or not. A
code is drawn with the club's access code length from a `SecureRandom`. `CodeRejected` before the first
acceptance holds the old code until its exposure ends and sends a new one in the next pass; the third
rejection in a row refuses the grant. After the first acceptance the delivered code must stay, so a
rejection refuses it. `Refused(GRANT)` refuses an install, while a refused revoke stays due, because a
revocation never stops. `RetryLater(GRANT)` and every other counted failure wait 1, 5, 15 and 60
minutes, then 60, or until a moment the system names, an hour ahead at most. A `CONNECTOR` answer probes
again at once: when the probe fails, the row's attempt is undone and the pass ends as an outage; when it
answers, the answer counts as the grant's own. `RetryLater(CONNECTOR)` with a moment still ahead holds
the worker until then, an hour at most; without one, or with one already past, it holds nothing and the
backoff applies. An unclear answer probes again too; a failed probe retries the row after a minute
without counting the attempt. A revoke accepted within two call deadlines of the last install is sent
once more after that bound, because the system may still process the install late.

The admin overview labels each grant `FAILING` when it was refused or failed five counted attempts in
a row, `REMOVING` when it is no longer wanted but may still be installed, `INSTALLED` when the system
holds it as wanted, `WAITING` when it is wanted and not yet installed as wanted, and `DONE` otherwise.
A grant that becomes installed for the first time publishes `access.grant.installed` and one that
becomes failing publishes `access.grant.failing`, once per transition and naming only the booking.
`AccessGrantQuery.grantOf` answers a booking's grant status and window, and its code only once the
system accepted it and while the grant is wanted.

`/admin/access-grants` lists up to 100 grants that are wanted, may be installed or are failing,
failing ones first, with booking, courts, access points, window, attempts, last failure and next
attempt, and the total. It names the selected connector and shows the last probe the worker made:
its class, `ANSWERED`, `UNREACHABLE`, `TIMEOUT`, `CALL_THREAD_OCCUPIED` or `REFUSED`, the time and
the connector's own reason when it gave one. Reading the overview never calls the system. The page's
"Verbindung prüfen" asks for a connection check with `POST /api/admin/access-control/check`, which
also requests a probe and so reloads the groups, and lists each check of the latest one from
`GET /api/admin/access-control/check`, whose `checkedAt` is `null` and list empty before the first.
The request is audited as `access.control.checkRequested` without a subject, because the check creates
and deletes a user on the system.
Without a connector the request answers `409 urn:courtside:error:access-control-not-connected`, as a
retry does. A board sends a
failing grant again with `POST /api/admin/access-grants/{id}/retry`: it marks the grant under its row
lock, signals the worker and is audited as `access.grant.retryRequested`, and the next pass clears
the refusal and the count; an unknown grant answers
`404 urn:courtside:error:access-grant-not-found` and any other status `409
urn:courtside:error:access-grant-not-failing`. A changed demand clears the refusal and the count the
same way. No domain event, log line, stored failure, problem body or administrative response carries a
dynamic code: connector text is stored and logged with URLs reduced to scheme, host and path, the
call's code masked and every standalone run of four to eight digits masked.

Known limits: probe readings and the latest connection check are kept in memory per instance. A
board that types a live dynamic code as a gate's static code is not stopped, and both then open with
that code until the grant's window ends.

#### Court occupancy for building automation

Floodlight, irrigation and similar equipment stay under the club's own building automation, which
polls Courtside; Courtside never switches anything. `GET /api/public/occupancy?key=<key>` answers
`200 text/plain` with two `name=value` lines per active court in the order of its number:
`court<N>.occupied` is `1` while a confirmed booking whose card has `signalsOccupancy` runs on court
`N`, and `court<N>.minutes` counts the whole minutes, rounded down, until the next such booking
starts. It is `0` while the court is occupied and `1440` when nothing starts within the next 24
hours. `N` is the court's number, so deactivating another court does not shift it. An inactive court
is left out. Nothing else is answered: no booker, card, booking or court id.

`signalsOccupancy` is on by default and never on for the closure card: `CardService` refuses it with
`card.closure.signalsNoOccupancy`, and `booking_card_closure_signals_no_occupancy` refuses it below
the service. A closure therefore reads `0`.

The poll presents one board-managed key in the query, because a Loxone Virtual HTTP Input sets no
request headers. `/admin/facility/access-points` creates it, shows it and the ready address once, and
revokes it; the instance keeps only its SHA-256 and compares hashes in constant time. A new key
replaces the old one and both changes take effect on the next poll. Without a key, with a wrong one
or after revocation the poll answers an empty `401`, since a poller cannot parse a problem body.
Creating and revoking are audited as `booking.occupancyKey.created` and
`booking.occupancyKey.revoked` without a subject and without the key. The query string is masked as
`key=[REDACTED]` before Spring's request logging sees it, and the operational log redacts any
`key=` query value it collects.

Grid changes are refused when active or future bookings, or the opening hours, seasons and holidays
in force today or scheduled after it, no longer align. Time-zone changes are refused while a confirmed booking has not
ended. These writes serialize with booking and opening-hours changes through the club configuration
row.

The setup checklist derives progress from current configuration, facilities, membership types and
roster state. It stores no checklist flags and shows a failed state request instead of partial
progress.

Administration opens on an overview. It shows today's bookings by the club's calendar date and the
ones still to come, the accounts whose holder has not chosen a password yet, refused and failed
messages, and the latest recorded changes. Each part reads the endpoint its own page reads, asks
for five entries, fails on its own and links to that page with the matching filter. The setup
checklist leads the overview unfolded while a required step is open and folds to one line once all
of them are complete. `/admin/setup` shows it in full.

Four key figures sit between the setup checklist and those parts: utilisation of the seven
club-local days ending today, confirmed bookings of the current ISO week from Monday to Sunday,
active members of the thirty days ending today with their share of current members, and current
members with the joins of those thirty days. The week includes bookings already made for its
remaining days and is compared with the whole week before. Each figure shows its change against the
statistics read's preceding period of equal length, in percentage points for utilisation, and none
when that period or its value is missing. Each links to `/admin/utilisation` with its period in
`from` and `to`. The overview sends one read per statistics section, the two member figures share
theirs, and a failed read takes down only the figures built on it.

Statistics answer four reads under `/api/admin/statistics`: utilisation, bookings, members and
messages. Each takes a period of club-local dates in the years 0001 to 9999 spanning at most
36,525 days, defaults to the last full calendar month, answers aggregates only and repeats its figures for the
equally long period before it. None of them names a person. A fifth read, `range`, answers the
club-local date of the earliest allocation of any booking and today's date, so "all time" is the
period between them. Each read runs its statements under a 30-second statement timeout and answers
`503` with `urn:courtside:error:statement-timeout` when it runs out.

- Utilisation counts confirmed allocations inside open time. Open time comes from the opening hours
  in force on each day. Court availability is not dated, so a court counts towards
  capacity when it is active now or held a confirmed allocation in the scope computed: the period
  for the totals and the weekday and hour grid, each bucket for the progression. Allocations under the shipped "court closed" card are closures: they are reported
  separately and taken out of the bookable time, so occupancy is booked time divided by open time
  minus closed time. A club card of its own is never treated as a closure. The weekday and hour
  grid uses club-local hours, and the progression uses ISO weeks up to 92 days and calendar months
  beyond.
- A booking belongs to the period its earliest allocation starts in. Closures are left out of the
  booking figures; series, guests and participant cards count confirmed bookings only.
- A membership runs on a day when it started on or before it and has no end date or ends after it.
  An active member holds a running membership on the period's last day and, in a confirmed booking
  starting in the period, booked it or was recorded as a participant. Members are grouped by the
  type of the period running on that day. A period that directly follows another period of the same
  person, such as a type change, is neither a join nor a leaving. A period reaching past today is
  read up to today, so a scheduled start or end does not count before its day.
- Account figures describe the enabled accounts as they are now; a disabled account counts in none
  of them. Only the latest sign-in is stored, so for
  a past period the 30- and 90-day windows count the accounts whose latest sign-in falls inside
  them.
- Messages are counted per kind and state by the time they were queued. Retried counts the
  messages whose handover failed at least once and was scheduled again, whatever became of them.

The usage report under `/api/admin/reports/usage`, shown at `/admin/usage` in the records group, answers four further questions for a period with
the utilisation report's rules: both dates or none, the last full month by default, at most 366
days. It counts the bookings whose earliest allocation starts in the period, closures left out, and
names no person, account or booking.

- Capacity groups confirmed bookings by card and by the holder's membership type, with their court
  minutes and their share of the open court minutes that were not closed.
- Cancellations split into those by the holder, by the club and by the release of an unattended
  booking, and the club's are counted by the reason it gave. They are also grouped by card.
- A card or membership-type group fewer than three accounts stand behind
  (`UsageReportService.MINIMUM_GROUP_ACCOUNTS`) is never shown on its own. It joins one `other` row
  without card or type, so the totals stay whole and a type one member holds does not expose that
  member's bookings. When every group is small, the other row is the only one. The minimum group
  keeps a single person from being read off the report by chance; it is not built to withstand an
  admin, who manages personal data anyway, deliberately comparing different periods.
- Attendance counts attended bookings, no-shows that still count and lifted ones. A booking with
  nothing recorded counts in none of them.
- Rule rejections count the booking and cancellation attempts the rules refused in the period, per
  violation code. A refused attempt is written to `booking_rule_rejection` in a transaction of its
  own with the card and the club-local hour, nothing that names the holder.

## Membership data exchange

A source describes one external export. It stores column mapping, separator, character set,
category mapping, source-owned fields, default membership type and the threshold for confirming
disappearing memberships.

A source reads its files in one of two modes. By header, the default, the first row names the
columns and each field is found by the header mapped to it. By position, for an export without a
header row, each field comes from a numbered column and the source stores how many columns a file
has. A file whose first row has a different count is refused before a preview exists, because its
columns can no longer be trusted to mean what they did; a single short row inside an intact file
fails as a row. Switching a source between the modes needs an explicit confirmation, and nothing
guesses a mapping in place of the stored one.

Source plus member number identifies an external record. Names and email addresses do not. One
person may hold references from several sources.

The browser reads a selected file locally to offer its headers, numbered columns and category
values, so describing a source uploads no personal data. Uploading a
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

Current exports cover the roster, confirmed bookings for a club-local period, the audit log, the
message log and all data held about one person. CSV exports use a separator and character set the
board picks per download; a configured import source only preselects them. A cell opening with
`=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe so a spreadsheet reads it
as text. The per-person JSON export is available from the roster and records that the request was
answered.

The two log exports carry the columns the administrative log views show, names included, and admit
only administrators. They hold every entry up to the moment of the request, optionally limited to
club-local days, and stream the file in batches of 500 read by keyset, so neither the response nor a
transaction holds the whole log while the interactive views stay paginated. Each export records a
`dataexchange.log.exported` entry naming the log and the period. That entry concerns the whole
instance, so its `subject_id` is empty, and it is never part of the file it records.

## Identity and credentials

Accounts sign in by username. Passwords use Argon2id with `m=19456`, `t=2`, `p=1`. Successful login
rehashes an older encoding when possible. Failure to store that opportunistic rehash does not reject
the correct password.

The global account control displays the signed-in username. Its single My account entry opens
`/account`, with a read-only profile followed by account security. The profile shows username,
separate first and last names from the account's Person, and every role assigned to that account.
It is available to every authenticated account without requiring membership or roster access.
Managing a dependant does not replace the session holder's identity. Session status supplies the
name fields only for an authenticated account; anonymous and revoked sessions expose none.
`/account/security` remains a direct authenticated entry that scrolls and focuses the security
section. Initial-password requirements and sign-in return targets apply to both routes.
The identity remains in session memory only. Offline fallback shows unavailable account details
and never presents its synthetic booking-access role as an actual assignment.
Pending security continuations belong to the account that started them. An account change
discards old completions and unsubmitted proof actions. Cancelling a pending proof prevents its
follow-up action; a server action already submitted still applies its confirmed result to that
same account.

Temporary login admission refusals are retried only for the typed login rate-limit problem with a
valid server-directed wait of one to five seconds. One submission allows at most five credential
POSTs, including CSRF recovery, and ten seconds of accumulated waiting. The fifteen-second deadline
includes the session refresh. The browser shows the waiting state, cancels when the member leaves
and does not persist the submitted password. Wrong credentials and unrelated admission failures do
not trigger capacity retries. Server-side verification capacity and rate limits remain authoritative.

Sign-in keeps the page that sent the visitor there. A signed-out visitor who opens a page that
needs a session, including administration, reaches the sign-in form with that page's path, query
and fragment in the `returnTo` parameter. A session that ends while a page is open, a sign-out from
the error page and a session that must first replace its one-time password carry the current page
the same way. Account recovery and the password form pass the target on. After sign-in the browser
returns there, also after the second sign-in a required password change asks for. The browser
follows the target only when its path stays a relative path on the same origin under every
percent-decoding and NFKC folding: it starts with one `/`, holds no second leading `/`, no `\`, no
`.` or `..` segment and no control character. Query and fragment cannot change the origin, so they
are only checked for control characters, before and after one decoding. Any other target leads to
the start page. A deliberate sign-out carries no target.

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

### Voluntary multi-factor authentication

Every account can enable MFA under "My account", in the account security section. Enrollment is
voluntary for every role. An enrolled account signs in with its password and one enrolled factor.
TOTP, WebAuthn and single-use recovery codes are alternatives. Courtside offers no passwordless
login or trusted-browser exception.

TOTP uses a separate 160-bit secret, six digits and a 30-second period. Enrollment shows a QR code
and a manual key, but activates only after a valid test code. Verification accepts the neighbouring
time steps and persists the consumed counter to reject replay. A replacement setup leaves the
current method usable until confirmation. Recovery codes appear once when generated; the database
holds only their verifiers. Regeneration invalidates the previous set, and concurrent redemption
has one winner.

WebAuthn supports up to twenty credentials per account with holder-private labels, individual removal
and renaming. A twenty-first registration is refused with a problem that names the limit.
An account may enroll WebAuthn without TOTP. Registration and authentication require local user
verification. Courtside receives the signed result, never biometric data. Relying-party ID and
allowed origin come from the explicitly configured public HTTPS address, including maintained local
HTTPS and shared UAT. Request Host headers cannot choose them. The relying-party ID is the
address's host in lower-case ASCII, so its spelling in `COURTSIDE_PUBLIC_URL` does not matter.
Browsers refuse an IP address as relying-party ID, so an address whose host is one leaves WebAuthn
unavailable while the instance and TOTP keep working. A credential is bound to its domain.
After a domain change, the holder signs in with a remaining method or recovery code and enrolls a
new credential. A lost-factor account uses controlled recovery.

Password verification creates an unauthenticated, roleless pending session for an MFA account.
Its database challenge binds account ID, security epoch, browser session and purpose. Challenges
expire after five minutes and permit at most five proof attempts. Requesting fresh WebAuthn options
does not extend the password challenge's lifetime or reset its attempt budget. Account and address
budgets also survive a restarted login. Every five consecutive failed proofs of an account pause its
second-factor checks, for one minute at first and twice as long after each further run, up to 24
hours. Only a successful proof or 30 days without a failure reset the count. The first pause of a
run mails the holder. Enrollment confirmations count separately. Only a completed factor creates an authenticated session,
records sign-in and establishes recent proof. WebAuthn signature counters cannot decrease; a
synchronized credential that consistently reports zero remains supported.

Initial enrollment requires recent password proof. Later factor changes, recovery-code generation,
disablement and sensitive actions require recent password plus one existing factor. The proof
window remains five minutes, so disabling MFA or removing a method asks the holder to confirm it
first even within that window. Security-relevant factor changes revoke existing sessions and notify
the holder without naming a credential or exposing a secret. Generated recovery codes remain in
that browser's memory long enough to save them after its own session ends. External account changes
and a different signed-in holder clear them. Administrators see only whether another account has
MFA and whether controlled recovery blocks it.

Ordinary password recovery and administrative credential issuance preserve enrolled factors. A
controlled rescue requires a fresh MFA-authenticated administrator and an explicit identity check.
It applies only to an account with an enrolled factor or a pending rescue; a password-only account
is refused unchanged and uses ordinary password recovery.
It immediately revokes sessions and blocks login, ordinary password recovery and issued credentials.
Existing factors remain until the holder redeems the single-use code mailed to the account's
current address together with a new permanent password. Redemption removes all factors, recovery
codes and pending challenges. Expiry, address changes, security-epoch changes and guessing limits
invalidate or refuse the code without clearing the block. The maintained operator command supports
a sole administrator who has lost every method. Its separately audited address-correction command
invalidates an older rescue code and requires a new rescue request.

Whenever an account holder's email address changes, through the roster, a synchronisation or that
command, the previous address receives a notice that the account's address changed. It names
neither the new address nor any code, so a holder whose mail was redirected learns of it at the
address they still read. A change that only alters letter case, or a person without an account,
sends no notice.

TOTP secrets use account-bound AES-256-GCM encryption with random nonces. The instance generates its
keyring automatically and persists it outside PostgreSQL, under a private local directory or a
separate writable container volume. A database installation ID selects the default key location;
a canary and encrypted state validate the matching keyring before the instance reports healthy,
and afterwards health reads the keyring and its canary again once the previous reading is 5 seconds old.
An operator may supply a private key file. Rotation retains prior keys for existing ciphertext.
A database with encrypted factors cannot start using missing or mismatched keys. Complete backup
and restore preserve both the database and key material, and preflight validates them together
before replacing the target database. A database-only restore with encrypted factors needs the
matching keys restored separately.

### Sessions

Spring Session stores sessions in PostgreSQL. HTTPS uses `__Host-SESSION` with `HttpOnly`, `Secure`,
`Path=/`, no `Domain` and `SameSite=Lax`. The readable CSRF cookie follows the same host boundary.
Local HTTP uses unprefixed development names.

Inactivity and absolute lifetime both bound a session. The absolute lifetime survives application
restart. Cleanup removes rows expired by either rule.

An account may hold a configured number of sessions. A later sign-in removes least-recently-active
excess sessions rather than refusing access. Members can list browsers and revoke sessions.
Administrators may revoke one account or all sessions after recent full authentication proof.

Browser-visible revocation handles are one-way values, not session credentials. The view exposes
neither raw user agents nor source addresses.

## Notifications

German and English notification templates ship as resource bundles. A message uses the recipient
account's language.

An administrator may store the club's own subject and body of a message, per language, in
`message_template_override`, preview it filled with example values and reset it to the shipped
wording. The wording is plain text. Only the subject and body of a message are replaceable; the
fragments inside them, such as a closure or a cancellation reason, stay shipped. A wording may name
only placeholders the message fills in either language, plus `{instanceLink}`. It must keep the
placeholders the message exists to deliver: the username and generated credential of the two
credential messages, the username and code of a reset code, the username of a reminder. A credential
or reset code may not appear in the subject, and in the body it stands on its own, apart from quotes
and punctuation, so a wording cannot make it part of a link. The subject stays on one line and
neither part holds a control character. Nothing else is
refused, links included. The wording changes what a message says and never who receives it, whether
it is sent or whether a member may decline it. Changing or resetting a wording needs a recent
full authentication proof, because it decides what the credential and reset-code mails say, and each
change is recorded as `notification.template.changed` or `notification.template.reset`. When a
message is composed, a stored wording is checked again with the same rules and the same placeholder
parser; a wording that fails that check or cannot be filled is skipped, and the shipped wording goes
out instead, so no message, a security message least of all, is lost to a club's wording.

The confirmation and the reminder carry `{accessCodes}`: the window and the code of each access point
the booking needs, read when the message is written and filled only for a recipient who is still the
booker or a player at that moment; an `ACCESS_CODE_CHANGED` notice for anybody else fails as
`NotInBooking`. A booking's own code is looked up only for such a recipient.

With an access-control system, a booking behind an access point without a static code queues its
confirmation ten seconds ahead, so the worker usually installs the code first and the confirmation
carries it. A confirmation written before a door accepted the code says that it follows instead,
and its message record keeps the booking id after settling. When the grant is installed for the
first time, every such handed-over record of the booking is cleared and its account receives one
`ACCESS_CODE_READY` with the current code; one written after the grant stopped being wanted fails as
`AccessWithdrawn`. A reminder written before the code exists says that it is missing and points to
My bookings. If the door accepts the code while that confirmation is being sent, the clearing misses
it and the member finds the code in My bookings and the reminder instead; this is accepted. The mail
of a series move carries the booking's own code, with any static codes beside it, only when the move
covers one date, because each date has its own code; a code not issued yet is simply left out. Without a code the placeholder's line disappears,
so such a mail reads exactly as it did before access points existed. A club's own wording that lacks
the placeholder gets the block when there is one: above the link when the wording ends with a line
holding only `{instanceLink}`, at its end otherwise. Like a credential, the codes may not
appear in a subject and stand apart from links in the body.

A code that newly reaches a booking is announced as `ACCESS_CODE_CHANGED`. That happens when a board
changes the static code of an active access point, creates an access point with a code, adds a court
to an active access point with a code, reactivates an access point that has a code, or switches a
card to grant access. Adding a court announces to the added court's bookings only, and switching a
card announces to that card's bookings behind an active access point with a code only. Each covers
every confirmed booking on those courts whose card grants access, whose window has not ended and
which already handed a code out, once to its booker and once to every player with an account, the
audience of the reminder. A single booking handed it out with its confirmation and a series
occurrence only with its reminder, so an occurrence not yet reminded is not told and its reminder
carries the current code. The notice must keep `{accessCodes}` and carries the code current when it
is sent. Removing a code or a court, deactivating an access point, switching a card's access off and
any change to an inactive access point or one without a code announce nothing. The chain runs
through `shared` events, `facility.accessPoint.codeChanged` or `card.bookingCard.accessGranted` and
then `booking.booking.accessCodeChanged`, so `notification` gains no dependency on `card`.

An active access point open to members announces `MEMBERS_DOOR_CODE_CHANGED` to every current member
when its code changes, when it gains the mark or is created with it, and when it is activated again.
`facility.accessPoint.membersDoorCodeChanged` names the access point only. `notification` pages the
current members' accounts a hundred at a time, one transaction per page, and the message carries the
code current when it is written; one written after the access point lost its mark, its code or its
active flag fails as `AccessWithdrawn`, and one written after the recipient stopped being a current
member fails as `NoLongerMember`. A member who also holds a booking behind that access point
may receive the booking notice as well.

Current messages cover the welcome for a new account, generated credentials, password-reset codes, username reminders, booking
confirmations, participant additions and withdrawals, displaced bookings, upcoming reminders,
booking cancellations, bookings freed without a check-in, new series, waitlist offers, a taken open place,
a changed access code, a booking's own access code that followed its confirmation and a members' door code. A series sends no confirmation per occurrence. Its holder
receives one summary naming the card, weekdays, time, courts, first and last date and the number of
occurrences, and its centre entry leads to the first occurrence. Displacement informs people but
does not cancel the booking.

Creating an account queues a welcome ahead of the first password in the same transaction, also for
an account an import opens. It names the club, says that the sign-in details follow in a separate
message and that Courtside never sends a link together with a password. The outbox hands an
account's first password over only once that account's welcome has left or failed for good. A
password the board issues for an existing account sends no welcome, even when the account never
signed in.

A booking message and the welcome end with a link to the instance on its own last line. The address is the
operator's `COURTSIDE_PUBLIC_URL`, because it is bound to DNS and the certificate and a scheduled
reminder has no request to derive it from. Only an absolute `https://` address without path, query
or credentials is accepted, and anything else refuses startup. Without the setting, every message
goes out without a link. A template line holding nothing but an empty link is dropped, and inside a
sentence the link renders empty. Confirmation, participant addition and withdrawal, displacement,
reminder, both messages about a taken open place, a changed and a followed access code lead to the booking on
`/my-bookings#booking-<id>`. Cancellations, cancellations by the
club, series messages and a members' door code lead to `/my-bookings`. A waitlist offer leads to its entry on
`/my-bookings#waitlist-<id>`, where the member takes it. The welcome leads to the start page `/`. The confirmation's calendar entry carries
the same link as its `URL`. The shipped messages with a generated credential, a reset code or a
username carry neither a link nor the address, so members learn that a genuine one does not ask
them to follow a link. Those messages still fill `{instanceLink}` with the start page `/`, so a club
that words them itself may place the address. A mail client may still turn text that looks like an address into one. The
address is written in its ASCII form, so an internationalised domain appears as Punycode.

A cancelled booking is announced to its holder and its players, except the account that cancelled
it. When the holder cancels, the message says the booking is gone. When anybody else cancels, an
administrator or an account the card lets manage it, the message says the club cancelled it. Neither
names the person who acted. Whoever cancels somebody else's booking or series may choose a reason
from a fixed list of codes, never free text. The booking keeps the code, the event and the centre
entry carry it, and the club's message names it or, without one, refers the member to the club. A
holder cancelling their own booking cannot name a reason; the request is refused and cancels
nothing.

When somebody other than the holder cancels or moves occurrences of a series, only the holder
receives one message for the whole change, never one per occurrence. It names the card, weekdays,
time, courts, the first and last affected date and their number, the reason of a cancellation and
the previous time and courts of a move. The holder's own change to their series sends nothing.

Each message is a `message_record` with account, kind, `Message-ID`, time and state. The states are
`queued`, `handed_over`, `refused` and `failed`. `handed_over` means the relay accepted the message,
not that a mailbox delivered it.

`message_record` is the mail outbox. A listener stores a `queued` row holding identifiers only, and
two outbox workers hand rows over. No request thread hands a message over, so a slow relay never
lengthens a response. A worker claims a due row with `FOR UPDATE SKIP LOCKED` under a five-minute
lease. It then locks the row, checks that its claim is still the current attempt, composes the
message from the current data, hands it over under the `Message-ID` chosen when it was queued and
records the outcome, all in one transaction. A pass runs after every queued commit and every five
seconds, which also resumes what a restart left queued. A worker that dies during a handover leaves
its row to the next pass after the lease, which can send that message a second time under the same
`Message-ID`; `security-risks.md` records that bound.

A transport failure reschedules the row after 15 seconds and then after gaps three times as long,
and fails it on the sixth attempt, about half an hour after the first. A definite recipient refusal
is not retried. When its enhanced status is 5.1.x, which names the address itself, a waitlist offer
that is still open is skipped and passed on; a relay refusing to relay at all lists every recipient
as refused too, so any other refusal leaves the offer standing. A message fails at once when its booking or recipient is gone, its booking was
cancelled and the message is not the one announcing that, a series message finds no occurrence
left, or, for a reminder, its booking has already started by the time it is due. Every outcome
stays on the row with its reason, and the message statistics count the messages that needed a
retry. Credential creation and handover share a transaction, so a credential the relay never
accepted does not replace the stored one, and no plaintext credential waits in the outbox. Credential
issuance takes its account lock after relay handover and password encoding. It checks controlled
recovery before handover and again under that lock, and replaces the credential only while the
stored password hash still matches the one read before handover. A password change during handover
fails that credential job permanently instead of retrying it against the new password.

Starting controlled recovery permanently supersedes that account's older credential and ordinary
password-reset-code jobs. The rescue message's retained queue sequence binds this boundary after
redemption as well, so an older job's first delivery or retry cannot issue new credentials.
Credential and ordinary reset-code requests hold the account lock through queue creation and refuse
or silently omit requests while recovery is pending. Explicit requests after redemption remain
allowed. Before settling a successful handover, the same transaction checks the recovery boundary
again while the issuer still holds the account lock. A later recovery rolls back that old job's
credential or reset-token write. The outbox continues to serialize credential messages for one
account.

Every message addressed to an account also becomes an entry in that account's notification centre,
whether or not mail goes out. An entry stores the kind, the identifiers it concerns and when it was
read, never rendered text. The centre resolves the booking an entry concerns when it is read and
links to a page of the client by target, so an entry cannot lead off the instance. It names and
links that booking only while the account owns it or plays in it; an entry about a booking the
account has left stays listed without either. A waitlist offer's entry names the offered slot, its
deadline and whether it is still open while the account's own entry exists, and links to it in My
bookings. An account reads
and marks only its own entries; another account's id answers
`urn:courtside:error:notification-not-found`. The entry has no channel of its own, so another
channel can be added beside email without changing it.

Members choose optional message kinds and, separately, channels. No opt-out means enabled. A
declined kind reaches the account on no channel, the centre included. A declined email channel
stops mail and keeps the entry. The welcome, credentials, password-reset codes and username
reminders are mailed whatever the channel choice says, because whoever receives them cannot sign in
to read the centre yet.
A waitlist offer cannot be disabled either: joining the queue is the consent to hear of it, and
leaving the queue is how a member stops it. It always reaches the centre, follows the email channel
choice and is handed to the relay before ordinary booking mail because it runs out within minutes.
A mail composed after the offer was taken, declined or expired fails instead of being sent.
The welcome, credentials, displacement, participant-addition notices, the club's cancellations,
freed bookings and series moves cannot be disabled as kinds, because no other product path tells the member that
somebody else wrote them into a booking, took one away or moved it. A holder's own cancellation and the
series summary can be declined, like the confirmation: My bookings already shows what they say. A
declined email channel stops the mail for displacement, participant-addition notices and the club's
cancellations and moves as well; the centre then replaces it, and every centre page carries the
account's unread count, which the primary navigation shows beside the centre's entry. An account
without an address still receives its entries.

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
a concurrency guard bounds Argon2 work. A blocked source and a full guard are refused before the attempt
is recorded, so a refusal costs a read and no write. A successful sign-in withdraws only its own attempt from its
source's bucket, so one valid account cannot reset the failures spent on other accounts from the same
address. Distributed attempts produce a privacy-safe metric and log
event instead of an instance-wide lockout an anonymous caller could hold closed. Caddy replaces the
client-address header before the application sees it, and the reference deployment publishes no
application port that could bypass that assertion.

Admission control decides whether a request that reaches a handler may run. It sits after the
security filter chain and before the handler, so a refused request costs authentication and, for a
signed-in caller, the session lookup and touch, but no service work. Sign-in and sign-out never
reach a handler and keep the password protection above. A signed-in account spends its own token
budget, a caller without an account that of its client address, where an IPv6 address counts by its
/64. An operation costs what its class in the resource demand inventory costs, from 1 token for
ordinary work and 5 for a statistics read to 20 for exports and imports. Demanding classes such as
series, exports, imports, log search and logo normalization also run only as often in parallel as
their class allows, and one principal holds at most one of those places at a time: a principal's
further requests of that class wait up to fifteen seconds for it, so a page that asks for several
reports at once gets them one after another. Booking writes are deliberately not capped in parallel,
so a busy booking morning is decided by the database rather than refused. A request beyond its
budget answers `429` `urn:courtside:error:request-rate-limited`, one beyond its class's capacity
`429` `urn:courtside:error:operation-capacity-exhausted` and keeps its tokens; both carry
`Retry-After`. The browser waits once for a read it is told to retry within five seconds and shows
any other refusal. A budget that starts refusing writes one security event, and every capacity
refusal writes one. The instance refuses to start when a demanding class has no admission decision,
when a decision names a class no request reaches, or when a cost exceeds the burst of either budget.

Budgets bound what requests cost, not what the JVM spends on itself. The image therefore compiles
with C1 only: the optimizing C2 compiler would keep a one-CPU instance busy for minutes after every
start, recompiling as traffic arrives, while C1 code serves a club's load with room to spare.

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

The self-hosted mail recipe uses Stalwart. An update from the pinned 0.16.27 image to 1.0.x can
explicitly initialize a new store pair while retaining the originals and a complete recovery unit.
It does not carry old mail state into the new server. Without that explicit option, incompatible
store transitions are refused before mutation. The launcher configures the new stores and verifies
sender authentication over STARTTLS and certificate reload before starting the application. Backup,
reconfiguration and subsequent updates use the same persisted store pair. An interrupted transition
retains a journal and blocks ordinary lifecycle commands until update recovery completes.
The application requires STARTTLS and validates its relay
certificate by default. An operator may explicitly disable issuer and hostname verification for a
relay whose certificate the container cannot validate; the
[`operations guide`](../deploy/guides/operations.md) states what that permits. Other recipes use an
operator-selected relay.

GitHub Actions are pinned by commit. Dependabot reports updates. The image build applies the base
distribution's published package updates, so a security fix does not wait for the next rebuild of the
digest-pinned base image. Build and release scan source and images with Trivy. Release and nightly images are signed and carry SBOM and provenance attestations.
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
not copy names, addresses, credentials, static access codes or free text. Erasing the referenced person removes the link
without rewriting the append-only event.

A board keeps two categories of record for a number of months it chooses, and a category without a
period is never touched. `BOOKINGS` pseudonymises bookings and series that ended before the cut-off:
booker, canceller, mover, creator, notes, member players and guest names leave the booking, while
court time, status, card and guest places stay for utilisation and booking counts. `FORMER_MEMBERS`
removes a person all of whose periods ended, the latest before the cut-off, and whose accounts neither signed in nor
were opened since, with those accounts and everything they hold. Removal does not record a
departure: a member who leaves is deactivated, and only the period the board set after that ending
erases them. A person is reported as blocked instead while an account of theirs holds the
administrator role, a booking or series the run keeps still names them, or they wait for a court.

Every run starts as a preview that changes nothing, counts what it would change and lists the
blocked people with their reason. Only the account that took the preview can run it, with a recent
full authentication proof, once, before it expires and while the periods it applies are unchanged. A run
re-checks each former member under a lock and skips one who became ineligible. Pseudonymising a
booking also reaches the records that would tie it back to a person: its change log entries lose
their actor and the person and account fields of their payload but keep type, time and subject, and
its notification entries and queued messages are deleted. Removing a person leaves their entries
untouched, as described above. The change log records periods and run counts, never whom a run
removed. Courtside ships no period and gives no legal advice: the club chooses the period its own
lawful basis allows.

Session rows are deleted after inactivity or absolute expiry. Import previews retain their resolved
change set only for the configured period and never store the uploaded file. Message records,
notification-centre entries and message choices leave with their account.

An administrator can export all data held about one person. The response excludes other people's
identity even when they share a booking or audit event. Producing it is itself recorded.

Application and security logs contain no names, email addresses, payment data or request content.
Known accounts use immutable identifiers. The reference deployment also redacts database and proxy
output before bounded local retention. Administrators can inspect only those normalized records;
the operator still owns durable storage, external access and the longer retention policy.

## Operations and observability

The image exposes `/actuator/health`. Mail health is available to administrators at
`/actuator/health/mail`, and the access-control connector with its last probe reading at
`/actuator/health/access-control`. That indicator never contacts the access-control system and always
reports `UP`, so an unreachable Miniserver never changes the status the container health check reads.
Other management endpoints are not public by default.

Structured ECS logs go to standard output. Metrics and traces can use OTLP when the operator enables
their separate endpoints. Courtside requires no monitoring backend.

The reference deployment routes application, database and proxy output through a loopback-only,
fixed-source collector. It writes a small rotating volume that the application reads without Docker
control access. The administration distinguishes unavailable, dropped, rotated and incomplete
evidence and never presents this lossy recent view as a durable audit log.

Current domain metrics cover created bookings, rule rejections, booking conflicts, failed password
rehashes and message outcomes. Spring metrics cover HTTP, JVM and connection pools. Slow-query logs
contain placeholders rather than values and include trace identifiers when sampled.
`courtside.events.pending` counts event publications between modules that have not completed,
`courtside.backup.age` gives the seconds since the backup the operator recorded, and
`courtside.login.failures` counts refused sign-ins labelled only by the catalogued reason. None of
them carries an account, a person or an address. Without a backup record the age reads `NaN`.

The reference deployment is a supported starting point, not a managed service. Courtside validates
configuration it owns and supplies lifecycle tools. The operator owns the machine, external
services, credentials, backups and availability.

### Operator health overview

`GET /api/admin/operator-health` answers administrators only and reads what the instance can prove
about itself without changing it:

- the version and, when the build had a repository, its commit and build time;
- the migration state, read from the history the migration process wrote. Pending or failed
  migrations fail and name the first such version;
- mail handover, from the outbox. A queued message waiting for another attempt, or a newest failure
  later than the newest handover, fails and names the relay. Before any message has settled the
  check is unavailable;
- the public origin, exactly as messages link to it, or unavailable when none is configured;
- the backup age, from a JSON file `{"completedAt": "<instant>"}` that the operator's backup job
  writes and `COURTSIDE_BACKUP_EVIDENCE_FILE` names. Unset or missing, the check is unavailable. An
  unreadable record or one dated in the future fails and names the file.

Each check is `OK`, `FAILING` with the place that fails, or `UNAVAILABLE` with the reason the
evidence is missing. A check without evidence never reads as healthy. The overview sets no
thresholds: whether a backup is too old is the operator's decision, made in whatever alerting reads
the metric.

### Start sequence

An instance migrates its schema, opens its port and runs its startup tasks, such as creating the
bootstrap administrator. It then warms its busiest request paths and only afterwards reports ready.
Until the warm-up ends, readiness is refused and `/actuator/health` answers `503`.

The warm-up repeats its steps for `COURTSIDE_WARM_UP_ROUNDS` rounds, 200 by default, so that the
methods a request runs are called often enough to be compiled before members arrive. A step may stop
earlier at its own budget:

- the public reads (club configuration, courts, opening hours, booking grid, card legend and web
  manifest) and the court plan for today in the club's time zone, as HTTP requests to its own port
  on `127.0.0.1` without any proxy, so the security filters, admission control, Spring MVC and
  Jackson run as they do for a member. They stop after 40 rounds;
- a series preview for the first active court and a card that tracks no players, evaluated as a
  trainer so the overridable rules run too, in every round;
- an administrator's booking on the first free opening slot about 400 days ahead, created and
  cancelled inside a transaction the warm-up rolls back. It stops after 20 rounds;
- an Argon2id verification of a fixed password it hashed itself in memory, for 10 rounds.

Nothing it does survives it in the database. The rolled-back transaction never reaches the
before-commit listeners that store audit events and outbox messages, and `courtside.bookings.created`
counts committed bookings only. Its work still shows in telemetry: the reads appear in the HTTP
request metrics, a rule rejection or a lost race of the booking step counts in
`courtside.bookings.rejected` or `courtside.bookings.conflicts`, and with OTLP enabled its requests
and transactions are traced. The reads open no session and attempt no sign-in.

The reads spend at most 400 tokens of the loopback address's request budget and stop without a
warning once that budget refuses them, so a smaller configured burst shortens them. Behind the reference
ingress, which overwrites `X-Forwarded-For`, no client is admitted under that address; an instance
whose port clients reach directly from the same host shares it with them.

The booking step takes the booking-grid lock like any booking. Each of its rounds holds it from the
insert to the rollback, so a real booking, a series or a configuration change arriving at that
moment waits for it, as it would for another member's booking.

A step with nothing to exercise is skipped: the booking steps need an active court, a card that
tracks no players and opening hours. A step that fails is logged once as a warning with its cause
types and problem type, and the other steps still run. With `COURTSIDE_APP_TLS_MODE` at `serve`
the read steps are skipped, because the served certificate does not name the loopback address.
`COURTSIDE_WARM_UP_DEADLINE`, 30 seconds by default, bounds the whole warm-up. At the deadline the
instance reports ready, no further step starts, and the running step is interrupted and ends at the
latest with its transaction or request timeout. One log line states the duration and the steps that ran, were
skipped and failed. `COURTSIDE_WARM_UP_ENABLED=false` reports ready without a warm-up.

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
set. A pull request that can change the image also runs the release gates against an image it builds
itself; npm advisories and the image CVE scan stay with the nightly and the release because they
move while the repository does not. A scheduled test is regression evidence, not the first execution of a changed scheduled path.

See [`quality-strategy.md`](quality-strategy.md), [`security-assessment.md`](security-assessment.md)
and [`releasing.md`](releasing.md) for the detailed workflows.
