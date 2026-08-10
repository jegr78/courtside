# Courtside — Design Specification (Release 1)

**Status:** Approved for planning
**Scope:** Release 1 — court booking, members and accounts, admin backend, import/export and reports

> **This document describes the design, not the build.** It is written in the present tense
> throughout, which is how a specification reads — but the present tense here means *"this is how
> Courtside is designed to work"*, not *"this is what today's code does"*. Nothing is released
> yet. **What is built** is the section immediately below; everything else in this document is
> the target. Where the difference matters for a decision — most of all in section 10, Security —
> it is marked inline.
>
> Do not read a described property as a shipped guarantee.

## 0. What is built today

Eight modules exist: `booking`, `card`, `config`, `facility`, `identity`, `member`, `rules`,
`shared`. The `notification`, `reporting` and `integration` modules of section 3 are designed and
not built, so nothing consumes domain events yet and the `domain_event` table does not exist. No
port interface has been introduced, because no second adapter has needed one.

Built and covered by tests: the booking core including the exclusion constraint, booking cards and
participant cards, booking series and multi-court allocation, the rule engine, opening hours and
courts, accounts, roles and session login, club configuration and branding, and the admin surface
for all of it. `/actuator/health` is exposed. The OpenAPI document is the source of truth: every
controller implements an interface generated from it, and an instance serves the document it
actually answers to at `GET /api/openapi.yaml`. A tagged release builds a multi-arch container
image, publishes it to GHCR signed with cosign and carrying an SBOM attestation, and attaches the
OpenAPI document to the release.

Designed and not built: `Idempotency-Key` handling, the observability stack of
section 9 beyond the health endpoint, container image scanning, CSV import, reports and exports,
and the frontend.

---

## 1. Context and Goal

Sports clubs widely run court booking systems that have stopped receiving updates and lack
features clubs need today. Replacing one is the situation Courtside is designed for.

Courtside is **not** a bespoke application for one club. It is a product: multiple clubs
run their own instance, brand it as their own, configure booking rules to their needs,
and connect it to whatever access control, payment or membership systems they already
have.

### Goals

- Replace a club's existing booking system completely for the functional areas listed in Release 1
- Be configurable per club without code changes
- Expose a documented, stable API so third-party systems can integrate
- Be operable by a club admin with basic Docker knowledge, not only by its author

### Non-goals for Release 1

The following are deliberately deferred to separate projects, each with its own spec.
Their **ports are defined in Release 1**, with no-op implementations, so that adding them
later is additive rather than invasive.

| Deferred | Port defined in Release 1 |
|---|---|
| Billing, balances, guest fees, invoices, online payment | `PaymentPort` |
| Access control: transponders, door and light automation | `AccessControlPort` |
| Bidirectional sync with an external membership system | `MemberSyncPort` |

CSV import and export **is** in Release 1. Only the live, bidirectional sync is deferred.

---

## 2. Product and Distribution Model

Courtside is distributed as **AGPL-3.0 open source on GitHub**. Each club operates its own
single-tenant instance: one application container, one PostgreSQL database, one club.
There is no shared multi-tenant deployment and no central SaaS.

This has a direct legal consequence that shapes the design: **each club is the data
controller for its own members' data.** The Courtside project is not a processor for
anyone else's data. Courtside therefore ships the *means* to comply (deletion jobs, data
export, documentation templates) but never holds foreign personal data.

### Code and deployment

The reference deployment lives in `deploy/` in this repository: a Compose file, a Caddy
configuration and the documented environment. Clubs copy the directory and adapt it rather than
configuring the application repository, and the maintainer runs the same thing they publish.

A separate `courtside-deploy` repository was the earlier plan, on the reasoning that clubs will not
all run the same infrastructure. That reasoning argues for the deployment being *copyable*, which a
directory is. What it does not survive is the release choreography: a new environment variable and
the Compose file that sets it belong in one change and one review, and two repositories would make
every release answer which deployment version pairs with which image tag.

Every instance is a consumer of the reference deployment; none is a special case.

### Release artifacts

Every tagged release publishes:

- Multi-arch container image on GHCR, semver-tagged
- Cosign signature and SBOM
- The OpenAPI document, which is written by hand and is the source of truth the API is
  generated from, not a by-product of it. The release workflow attaches
  `src/main/resources/api/openapi.yaml` to the tag unchanged — there is nothing to build, and a
  document assembled at release time would be a different document from the one the instance
  serves.
- Release notes including explicit upgrade notes for breaking changes

### Compatibility contract

Once third-party clubs deploy Courtside, two surfaces become public API and may not change
casually:

1. **Environment variables.** Documented set, defaults for everything optional. Renaming a
   variable is a breaking change.
2. **The REST API**, as published in the OpenAPI specification.

**Database migrations must be idempotent and support version skipping.** A club that has
not updated for a year must be able to go from 1.2 directly to 1.7. Flyway runs on
startup; the upgrade path is explicitly tested (see section 10).

### Language and internationalisation

Code, identifiers, comments, commit messages, documentation, API field names and the
database schema are **English**. User-facing text — UI strings and email templates — goes
through message bundles. German is the default locale, English the second. Locale is
stored per user account with a fallback to the instance setting.

Domain vocabulary:

| German | Code |
|---|---|
| Platz | `Court` |
| Buchung / Zeitfenster | `Booking` / `TimeSlot` |
| Platzbelegung (je Platz) | `CourtAllocation` |
| Mitglied / Person | `Member` / `Person` |
| Benutzerkonto | `UserAccount` |
| Buchungskarte / Spezialkarte | `BookingCard` |
| Platzsperrung | `CourtClosure` (a `BookingCard` kind) |
| Öffnungszeiten | `OpeningHours` |
| Mitgliedschaftsart | `MembershipType` |
| Mitspieler | `Participant` |
| Guthaben | `Balance` (deferred) |

Structural vocabulary — terms that name a shape rather than a domain concept, and therefore
have no German counterpart in the user interface:

| Term | Meaning |
|---|---|
| `DomainFailure` | The supertype every domain failure extends. It implements Spring's `ErrorResponse` and builds its own RFC 9457 body, so the mapping from a failure to its wire representation lives with the failure rather than in a `@RestControllerAdvice`. Deliberately **not** named `…Exception`: `CLAUDE.md` already separates the concept ("domain failures") from the mechanism ("are typed exceptions"), and this type names the concept. Concrete failures keep the suffix — `CourtNotFoundException extends DomainFailure`. |
| `ProblemType` | The value type a `DomainFailure` carries: `slug`, `status`, `title`, `detail`. Held as a static constant per failure class so a test can read it without constructing an instance. `detail` lives here and never comes from the exception's message — a message may carry an id or a caller's input, and neither belongs in a response body. |
| `CodedDomainFailure` | A `DomainFailure` that also carries an i18n `code` and named `params`. It emits them as a one-element `violations` array, which is the only shape a translatable failure travels in. The rest carry no code at all. |

`ErrorResponse` is implemented for `getStatusCode()`, `getHeaders()` and `getBody()` only. Its
`MessageSource` hooks — `getDetailMessageCode()` and the `MessageFormat` positional arguments
behind it — are deliberately left unused: this API resolves messages in the frontend from a `code`
and **named** parameters, and wiring Spring's positional mechanism alongside would give the same
response body two competing sources of truth. A failure's `detail` is developer-facing English and
is never what a member reads.

---

## 3. Architecture

A **modular monolith** on Spring Boot 4.1 / Java 25, using Spring Modulith to enforce
module boundaries at build time. One deployable artifact, one PostgreSQL database.

The frontend is a **React/Vite PWA** consuming the same REST API that third parties use.
This is deliberate: when the product's own UI is the first consumer of the public API, that
API stays good. A server-rendered UI would relegate the public API to a second-class
citizen.

```
┌──────────────── React PWA (Vite) ────────────────┐
│  Booking grid · My account · Admin backend       │
└──────────────────────┬───────────────────────────┘
                       │ REST/JSON  (= the public API)
┌──────────────────────▼───────────────────────────┐
│ identity      User accounts, login, roles        │
│ member        Persons, membership types          │
│ facility      Courts, opening hours, holidays    │
│ card          Booking cards / special cards      │
│ rules         Rule definitions and evaluation    │
│ booking       Bookings, participants, series     │
│ notification  Email templates and delivery       │
│ reporting     Analytics and exports              │
│ dataexchange  CSV import / export                │
│ config        Branding, instance settings        │
│ integration   Ports: Access · Payment · MemberSync│
│ audit         Change log (cross-cutting)         │
└──────────────────────┬───────────────────────────┘
                       │
                  PostgreSQL 17
```

### Dependency direction

`booking` is the core and depends on `rules`, `facility`, `member` and `card`. **Nothing
the core depends on may depend back on it.** `notification`, `reporting`, `audit` and
`integration` react to domain events instead:

- `BookingCreated`
- `BookingCancelled`
- `BookingSeriesCreated`
- `MemberRegistered`
- `UserAccountApproved`

The booking core therefore knows nothing about email, nothing about door control and
nothing about payment. Adding a new consumer is additive.

### Integration ports

Defined in Release 1 with no-op implementations:

```java
public interface AccessControlPort {
    void grantAccess(BookingSnapshot booking);
    void revokeAccess(BookingId bookingId);
}

public interface PaymentPort {
    PaymentIntent createIntent(PaymentRequest request);
    PaymentStatus statusOf(PaymentIntentId id);
}

public interface MemberSyncPort {
    SyncResult pull(SyncRequest request);
}
```

Cost is near zero; the benefit is that the deferred projects never require cutting into the
booking core.

### Event handling

Spring Modulith's **Event Publication Registry** provides a persistent, in-process event
bus with automatic retry of incomplete publications — this is the transactional outbox, and
it does not need to be hand-written.

```java
@ApplicationModuleListener   // = @Async @TransactionalEventListener(AFTER_COMMIT)
void on(BookingCreated event) {
    mailer.sendBookingConfirmation(event.bookingId());
}
```

A booking must never fail because a mail server is unreachable, and must never be confirmed
without the mail being safely queued.

**Explicitly rejected: event sourcing as the persistence model.** In event sourcing, state
is a projection, and a projection cannot enforce a database exclusion constraint. That
would move the one guarantee this system must never break — non-overlapping court
occupancy — from the database back into application code, reintroducing concurrency
problems that otherwise do not exist.

**Explicitly rejected: an external broker (Kafka, RabbitMQ).** One instance serves one club, and
a club's booking volume is bounded by the number of courts it has times the hours it opens them —
a few hundred a day at the top end, which a single PostgreSQL handles without noticing. A broker
adds no throughput that is needed but adds a component to operate and update per club instance.

**Adopted instead:** an append-only `domain_event` table alongside state — not as the
source of truth. It serves four purposes at once: the audit log for administrative
changes, traceability for members ("why is my booking gone?"), a reporting data source that
does not load the booking tables, and the natural attachment point for the future access
control adapter.

---

## 4. Data Model

### Core decision: everything that occupies a court is the same entity

A member booking, a team training session, a league match and a court closed for watering
differ in meaning but all exclusively occupy a time range on a court. Modelling this as cards
on the grid, the way existing booking systems do, solves two problems at once:

1. Every overlap becomes structurally impossible — including the one between a member
   booking and a court closure, which would otherwise need application logic.
2. The booking grid needs exactly **one** query for a whole day.

### Three levels

Because a single booking may span multiple courts, the exclusion constraint cannot live on
`booking` itself:

```
booking_series                  -- the recurrence rule (only for series)
    ├──< booking_series_court >── court   -- ordered target courts
    └──< booking                -- the booking: who, which card, participants
            └──< court_allocation       -- one row per court; the constraint lives here
```

Series courts are rows rather than a UUID array so PostgreSQL can enforce both sides of the
relationship. Their position preserves the order supplied by the API.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE booking (
    id            uuid PRIMARY KEY,
    series_id     uuid REFERENCES booking_series,
    card_id       uuid NOT NULL REFERENCES booking_card,
    status        booking_status NOT NULL DEFAULT 'CONFIRMED',
    booked_by     uuid REFERENCES user_account,   -- NULL for closures
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    cancelled_at  timestamptz,
    cancelled_by  uuid REFERENCES user_account
);

CREATE TABLE court_allocation (
    id          uuid PRIMARY KEY,
    booking_id  uuid NOT NULL REFERENCES booking ON DELETE CASCADE,
    court_id    uuid NOT NULL REFERENCES court,
    during      tstzrange NOT NULL,
    status      booking_status NOT NULL,   -- mirrored from booking, same transaction

    EXCLUDE USING gist (court_id WITH =, during WITH &&)
        WHERE (status <> 'CANCELLED')
);
```

A team training on courts 1–3 is **one** `booking` with three `court_allocation` rows: one
logical unit, one cancellation, one entry in "my bookings" — while non-overlap remains
guaranteed by the database rather than by application code. Participants attach to
`booking`, not to a court.

`court_allocation.status` is denormalised from `booking.status` so the partial index
predicate can use it. Both are always written in the same transaction.

### Booking cards carry the functional variant

```sql
CREATE TABLE booking_card (
    id                    uuid       PRIMARY KEY,
    label                 text       NOT NULL,   -- "League match", "Court closed"
    color                 text       NOT NULL,   -- rendering in the grid
    required_role         text,                  -- who may place this card
    allowed_player_counts smallint[] NOT NULL,   -- see "Player slots" below
    counts_against_limits boolean    NOT NULL,   -- counts towards member quota?
    guest_allowed         boolean    NOT NULL,
    active                boolean    NOT NULL DEFAULT true
);
```

A new card type is a row in the admin backend, not a deployment.

### Two kinds of card, often conflated into one

It is tempting to file everything that is "not an ordinary member booking" under one list, so
that Training, League match and Court closed sit beside Guest, Ball machine and Looking for a
partner. They are not the same thing, and modelling them as one type is what makes the
participant rules unexpressible.

| Kind | Answers | Per booking |
|---|---|---|
| **`booking_card`** | What kind of occupancy is this? | exactly one |
| **`participant_card`** | What fills a player slot? | one per slot |

`Training`, `League match` and `Court closed` are booking cards. `Ball machine` and
`Looking for a partner` are participant cards — they occupy a place on court without being a
person. A guest is a third kind of filler, carried as a name rather than a card.

### Player slots: singles is two, doubles is four

A member booking has an **exact** number of player slots — two for singles, four for doubles —
and the booker occupies one of them. Each remaining slot is filled by a member, a guest, or a
participant card.

That is what makes a ball machine work: one member plus `Ball machine` is a legitimate singles
booking, and three members plus `Ball machine` is a legitimate doubles booking. The machine
stands where the fourth player would.

```sql
booking_card
    allowed_player_counts smallint[] NOT NULL   -- member card: '{2,4}'; training/closure: '{}'

participant_card
    id, label, active                           -- Ball machine, Looking for a partner

booking_participant
    kind         text NOT NULL                  -- MEMBER | GUEST | CARD, CHECK constraint
    person_id    uuid   REFERENCES person
    guest_name   text
    card_id      uuid   REFERENCES participant_card
    -- exactly one of the three is set, enforced by CHECK
```

An empty `allowed_player_counts` means the card does not track players at all, which is right
for training and closures — the club does not record who attended a junior session.

An array rather than a boolean, because a boolean could only say "at least one" and had no upper
bound: nothing would stop twenty people being attached to one court, and "exactly four" would be
unexpressible.

Deriving the match type from the slot count is also what lets the grid label a booking as
`SINGLES` or `DOUBLES` without naming anyone, as section 10 requires. The API carries the
constant; the frontend renders it in the viewer's language.

**`Looking for a partner` is the opt-in that section 10 anticipates.** A member leaves a slot
open and marks it as looking for a partner; that publishes the slot, and only that slot, on
purpose. It is the one place a name may become visible to other members, because the member
chose it.

### Remaining core entities

```
person ────< member >──── membership_type ──── rule_set ──< rule
   │                                                        (type + params jsonb)
   └──< user_account (username UNIQUE, email NOT UNIQUE) >──< role

court ──< opening_hours       booking ──< booking_participant
                                             └─ person_id OR guest_name
```

Deliberate decisions:

- **`person` and `user_account` are separate.** Not every person has an account (children,
  dormant records from a membership import), and the future guardian/child relation needs
  this separation anyway.
- **`booking_participant`** references either a `person` (member) or carries a free-text
  `guest_name`. Guest bookings are prepared in the model without Release 1 having to do
  billing.
- **`rule` stores parameters as `jsonb`** rather than one column per rule type. A new rule
  kind is a validator class plus a row, not a schema migration.
- **`membership_type` → `rule_set`** is what makes "juniors only until 18:00" possible
  without a special case in code.

### Identity model

`username` is the login identifier, unique per instance, freely chosen by the member
(suggested at registration as `lastname.firstname`).

`email` is **mandatory but not unique**, and changeable at any time. Clubs enrol children and
juveniles under a parent's address, and a family with several children then shares one address
across several accounts — so an email address cannot serve as the identifier.

**Consequence for password reset.** The standard "enter your email" flow does not work. Two
paths, both supported:

1. Reset via **username** — single account, single link.
2. Reset via **email** — the message lists *all* accounts registered to that address, each
   with its own reset link ("Accounts for this address: *doe.jane*, *roe.john*").

This is a case standard frameworks do not provide and must be built explicitly.

A **guardian relation** (a parent seeing their children's bookings) falls out of this model
almost for free. It is noted as a candidate for a later release, not Release 1.

---

## 5. Booking Rules

All rule categories are configurable per club, per membership type or role:

| Category | Examples |
|---|---|
| Time grid and opening hours | Slot granularity (30/60 min), opening hours per weekday, season start/end, holiday handling, per-court deviations |
| Per-member limits | Max concurrent open bookings, max hours per week, advance booking window, min/max booking duration |
| Cancellation and no-show | Free cancellation deadline, automatic release on no-show, lockout after repeated no-shows |
| Role and group dependent | Juniors only until 18:00, trainers may block slots, restricted rights for passive members, different advance windows per membership type |

Rules are **declarative data**, not nested conditionals:

```java
public interface BookingRule {
    RuleType type();
    List<RuleViolation> check(BookingRequest request, BookingContext context);
}
```

A rule set belongs to a membership type or role. On a booking attempt, all applicable rules
run as a chain.

**Evaluation does not stop at the first violation.** All violations are collected —
otherwise a member works through three error messages one at a time.

A `RuleViolation` carries an **i18n key plus parameters**, never rendered text:
`booking.rule.maxOpenBookings.exceeded` with `{limit: 2, current: 2}`. This keeps messages
translatable and lets the frontend attach them to the right form field.

Adding a rule type = one validator class + one configuration row.

### Two kinds of rule: who may book, and what the grid is

Rules split along a line that matters more than it first appears:

**Overridable rules restrict who may book.** Advance window, maximum open bookings, and the
role a booking card requires are all statements about a person's entitlement. `ADMIN` sets
them aside — no flag, no per-request opt-in, the role itself is the override. An admin
placing a training block six weeks out is doing their job, not circumventing anything.

**Non-overridable rules describe the grid itself.** Opening hours and the slot granularity
are properties of the facility, not of the person booking. The booking UI renders exactly
the slots these rules permit, so a violating booking is one the interface cannot express and
cannot display afterwards. Nobody creates one — not through the UI, not through the API, and
not as an admin.

The escape hatch for the exceptional case is configuration, not override: a tournament that
starts at six in the morning means the club changes that day's opening hours. That is an
edit an admin can already make, it is visible to every member, and it leaves the grid and the
bookings on it consistent.

```java
public interface BookingRule {
    List<RuleViolation> check(RuleContext context);
    default boolean isOverridable() { return true; }
}
```

`RuleEngine.evaluate` runs every rule; `evaluateNonOverridable` runs only the second kind. A
new rule is overridable unless it says otherwise, which is the safe default: forgetting the
flag costs an admin a restriction they could have skipped, never a booking the grid cannot
hold.

Below all of it sits the court's non-overlap constraint, which is not a rule at all. Two
bookings on one court at one time is not a permission question, and the guarantee lives in
the database precisely so that no caller can talk their way past it.

---

## 6. Booking Flow and Error Handling

```
POST /api/bookings
      │
      ├─ 1. Authentication and role check           → 401 / 403
      ├─ 2. Input validation (slot grid, card)      → 400
      ├─ 3. Rule evaluation                         → 422 + all violations
      ├─ 4. Transaction: booking + court_allocation → 409 on collision
      ├─ 5. Domain event BookingCreated → outbox
      └─ 6. 201 Created + booking as JSON
```

Errors are returned as RFC 9457 Problem Details:

```json
{
  "type": "urn:courtside:error:booking-rules-violated",
  "title": "Booking not allowed",
  "status": 422,
  "violations": [
    { "code": "booking.rule.maxOpenBookings.exceeded",
      "params": { "limit": 2, "current": 2 } },
    { "code": "booking.rule.advanceWindow.exceeded",
      "params": { "maxDays": 7 } }
  ]
}
```

**`violations` is the only shape a translatable failure travels in**, and it is an array even
where only one entry is ever possible — a court that does not exist produces a one-element array,
not a `code` on the problem itself. A client therefore resolves messages against the bundle in one
place instead of branching on where the code happened to sit. The rule engine forces the plural
case anyway, since evaluation collects every violation rather than stopping at the first.

A second array, `fieldErrors`, carries what Bean Validation rejected. Its entries are
`{ field, code, params }` — the same violation, plus the name of the input it came from — so a
client that can render a violation can render these by ignoring one key.

### Three failure modes that are easy to get wrong

**Concurrent booking of the same slot.** Rule evaluation in step 3 cannot prevent this in
principle — time passes between check and insert. The database decides: the constraint
violation is caught and translated into `409 Conflict` with "this court was just booked".
No locking, no retry loop, no race condition.

**Duplicate submission.** An `Idempotency-Key` header per booking attempt; the same key
returns the same booking rather than creating a second one. This matters on a club site
with poor mobile reception.

**Email delivery failure.** Handled by the Modulith event publication registry (section 3):
the confirmation is written in the same transaction as an event, and a worker delivers it
with retry afterwards.

### Notifications in Release 1

All templates are i18n message bundles and editable per instance:

| Trigger | Recipient |
|---|---|
| Registration submitted | Member (confirmation) + admins (approval request) |
| Account approved or rejected | Member |
| Password reset requested | Member — lists all accounts for that address (section 4) |
| Booking confirmed | Booking member + participating members |
| Booking cancelled | Booking member + participating members |
| Booking cancelled by an admin | Affected members, with reason |
| Series created | Creator, with the list of skipped occurrences |

Per-notification opt-out where legally permissible; transactional messages about one's own
bookings are not opt-out.

---

## 7. Series and Multi-Court Bookings

Recurring bookings are a **must-have** for the recurring training blocks that run through
the season. A single booking can also occupy **several courts at once** — a training block
spanning three adjacent courts is one `booking` with one `court_allocation` row per court,
not three separate bookings that happen to share a time.

`booking_series` stores the rule: frequency, interval, weekdays, start time and duration,
and an end defined either by **date or by occurrence count**. `SeriesRule` rejects a rule
that gives neither or both, that names no weekday, or whose occurrence count is zero or
negative — an unbounded or empty series is not a valid recurrence, so these are rejected at
construction rather than left to silently expand into nothing.

### Series are materialised, not computed

On creation, all concrete `booking` rows are generated immediately. This is mandatory: a
series that exists only virtually cannot be checked against collisions by the database, and
that check is the entire point of the construction. A 30-week training block on 3 courts
produces 30 bookings with 90 allocations — trivial for PostgreSQL.

Two safeguards:

- A configurable **horizon** — `courtside.booking.series-horizon-months`, 12 months by
  default. `SeriesSchedule.expand` never generates an occurrence past `startsOn` plus that
  horizon, regardless of what the rule itself asks for.
- A mandatory **preview step** before creation.

### Conflict handling on creation: preview and explicit decision

`POST /api/booking-series/preview` lists every occurrence the rule produces up to the
horizon, together with the court ids already occupied on that date, if any. Nothing is
written; a preview is open to any authenticated user, including one who could not actually
create the card in question — the card's role requirement is enforced by `BookingWriter` at
creation time, exactly as it is for a single booking.

```
Series: Team training, weekly, 18:00–20:00
Courts 1–3 · first to last occurrence · 10 occurrences

  ✓ 8 occurrences can be created
  ⚠ occurrence 3   Court 2 occupied (League match)
  ⚠ occurrence 7   Courts 1–3 closed (holiday)

  [ Create 8, skip 2 ]   [ Cancel ]
```

The creator decides: `POST /api/booking-series` names exactly the confirmed occurrences
(each an `Instant`, which must be one the preview actually offered), and the service creates
what it can and reports what it skipped. Nothing happens unnoticed — including when the
horizon itself is the reason an occurrence never appeared in the preview to begin with. A
club asking for 100 weekly occurrences, or for a rule that runs into 2028, gets however many
the horizon allows and no more; the preview response says so explicitly —
`truncatedByHorizon` and `horizonLimit` — rather than letting the count silently come up
short. This has to live in the preview and not in the create response: by the time `create`
runs, a date the horizon dropped was never among the confirmed occurrences to report against
in the first place. `SeriesSchedule.expand` is the only place that can tell whether it
stopped because the rule was satisfied or because the horizon cut it off, so it returns that
fact alongside the occurrences instead of making every caller re-derive it.

### Editing and cancelling

Calendar semantics are required for both cancelling and moving: **this occurrence**, **this
and all following**, or **the whole series**. Anything less causes real frustration when a
single session is cancelled for a holiday.

### Three operations, one asymmetry

Creating a series is deliberately **not** transactional: it tolerates partial success. A
user who previewed 26 occurrences and confirmed 24 already accepted that two dates were
blocked; if one more collides in the moment between preview and create — or turns out to
violate a booking rule the preview does not evaluate, such as an advance-booking window —
skipping that one occurrence and creating the rest is what they asked for. Nothing locks the
calendar between the two calls, so the create path re-checks every occurrence against both
the database's exclusion constraint and the rule engine, and reports collisions and rule
violations the same way: as a skipped date, not a failed request.

Cancelling and moving a series are both, by contrast, **transactional and all-or-nothing**.
A series cancelled from Tuesday onward either loses every one of those occurrences or none
of them — a half-cancelled tail is a worse outcome than the cancellation simply failing. A
moved series is the sharper case: half the occurrences at the old time and half at the new
one is actively wrong, not merely incomplete, so `SeriesService.move` previews the whole
move first, refuses outright if any occurrence would collide (`409` with the blocked booking
ids), and only then executes every remaining change inside a single transaction — the same
mid-flush exclusion-constraint race that a create tolerates instead rolls the whole move
back.

---

## 8. Configuration and Branding

Three layers, separated by the question "who changes this?":

| Layer | Contents | Changed by |
|---|---|---|
| Build | Defaults, migrations, card type templates | The project, in code |
| Instance (`.env`) | DB credentials, SMTP, OTLP endpoint, base URL, secrets | Club admin, at deployment |
| Database (`config` module) | Club name, colours, logo, opening hours, rules, card types, locale | The club, in the admin backend |

Rule of thumb: anything a club board would plausibly want to change belongs in the database
and the admin UI. Anything requiring a restart belongs in `.env`. Nothing functional
belongs in code.

**Branding** is served from a public endpoint `/api/public/config` that the PWA fetches at
startup: club name, primary and accent colour, logo URL, imprint link, default locale.
Colours are applied as CSS custom properties on `:root` — no rebuild per club.

The **PWA manifest is served dynamically** so the home screen icon shows the club logo, not
a generic Courtside symbol. This is what decides whether the product feels like "our app"
to a club.

### System check

An admin page — a common feature of existing booking systems, and essential for self-operated
instances:

- Is the database at the expected schema version?
- Is SMTP reachable, and does a test mail arrive?
- Is the most recent backup younger than 26 hours?
- Is a current Courtside version running?
- Are TLS and the base URL configured consistently?

For third-party clubs this replaces a large share of support requests, because the club
admin sees the diagnosis themselves.

---

### Reporting and data exchange in Release 1

Reports read from `domain_event` and the booking tables, and every one of them is also
available as CSV:

| Report | Purpose |
|---|---|
| Court utilisation by day, week, month | The board's core question |
| Bookings per card type | How much capacity training and league matches consume |
| Bookings per member / membership type | Fairness discussions, quota tuning |
| Cancellations and no-shows | Whether the cancellation rules work |
| Rejected bookings by rule | Which rules obstruct members (mirrors the metric in section 9) |

Import and export:

- **CSV member import** with column mapping, dry-run preview and a per-row error report.
  This is what replaces today's manual re-keying from the external membership system.
- **CSV export** for every list view in the admin backend, matching what existing booking
  systems offer today.
- **Per-member JSON export** for subject access requests (section 11).

---

## 9. Observability

**Designed, not built.** Today only `/actuator/health` is exposed; none of the metrics, traces or
alerts below exist yet. The section stays in the present tense because it defines the target — a
club operating a current build should plan for a health check and nothing more.

The application exports **metrics, traces and logs over OTLP** using
`spring-boot-starter-opentelemetry`. The protocol is the commitment, not the backend — the
target is a configuration line, and a club that sets no `OTLP_ENDPOINT` simply exports
nothing. Actuator and structured logs are always present.

**Structured logging** is built in since Spring Boot 3.4 (ECS / Logstash / GELF), with
trace and span IDs correlated into log lines automatically:

```properties
logging.structured.format.console=ecs
logging.structured.ecs.service.name=courtside
management.otlp.metrics.export.url=${OTLP_ENDPOINT:}
management.tracing.sampling.probability=0.1
```

**JavaMelody is not used** — it does not fit the OTLP model and offers nothing Actuator plus
Micrometer does not do better.

**Spring Boot Admin is used**, for a different purpose than Grafana: fleet overview across
instances, which version runs where, health status, and raising log levels at runtime when
a club reports a problem. That is operational *control*; Grafana is trends, history and
alerting.

### Domain metrics, defined from the start

| Metric | Type | Why |
|---|---|---|
| `courtside.bookings.created` | Counter (card, court) | Utilisation, usage per card type |
| `courtside.bookings.rejected` | Counter (**rule**) | Which rule actually bites in daily use |
| `courtside.bookings.conflicts` | Counter | How often the exclusion constraint fires |
| `courtside.outbox.pending` | Gauge | Are emails backing up — the key leading indicator |
| `courtside.notifications.failed` | Counter (reason) | See delivery problems before the complaint |
| `courtside.login.failed` | Counter | Attack detection and UX signal |
| `courtside.backup.age.seconds` | Gauge | The alert everyone forgets |

`courtside.bookings.rejected` tagged by rule is close to a product feature: a club can see
whether its own booking rules are obstructing members.

### Alerts that may wake someone

Instance unreachable · outbox backlog > 15 min · HTTP 5xx rate · backup older than 26 hours
· certificate expiring in < 14 days · disk space < 15 %.

### Reference stack

A recommendation, not a requirement: Grafana Alloy as collector on each application host,
shipping to one central instance running Grafana, Loki and Prometheus, alongside Spring Boot
Admin and Uptime Kuma. Clubs that want no monitoring at all rely on the system check plus an
uptime ping.

**Logs must never contain personal data** — no names, email addresses or IBANs. Log the
`user_account_id`, not the user. Log retention: 30 days.

---

## 10. Security

A club admin decides here whether to trust Courtside with member credentials, so each item says
whether it is built or designed. **Designed means absent today.**

- **Passwords:** Argon2id at `m=19456`, `t=2`, `p=1`, OWASP's current guidance and above Spring
  Security's own defaults. Login by username (section 4). *Built.* Nothing rehashes an older,
  cheaper hash on login — it keeps verifying, and only a password change moves it up.
- **Sessions:** server-side via Spring Session in the database, delivered as an
  `HttpOnly` / `Secure` / `SameSite=Lax` cookie. **No JWT** — the PWA and API share an
  origin, so no token gymnastics are needed, and an admin can terminate a session
  immediately, which JWT cannot do. *Built, except that terminating another member's session
  has no admin surface yet.*
- **CSRF:** on, double-submit cookie. *Built.*
- **Brute force:** rate limiting before password verification. *Built.* Source-address counters
  absorb concentrated attacks and an instance-wide Argon2 budget bounds distributed attempts;
  both are stored in PostgreSQL. There is deliberately no username lockout: an anonymous attacker
  could renew it against a known administrator indefinitely. Success clears its address counter,
  while `Retry-After` tells a client when an address or instance cooldown ends.
- **Admin roles:** optional TOTP second factor. **Designed, not built** — there is no second
  factor of any kind today.
- **Card PINs** are stored hashed. They are shared secrets, but still credentials.
  **Designed, not built** — `booking_card` carries no PIN column yet.
- **Source offer:** `GET /api/source` reports the running version, the commit it was built from
  and where its source can be obtained, unauthenticated. *Built.* An operator who forked sets
  `COURTSIDE_SOURCE_URL`; unset, it names this repository.
- **Security headers and TLS** are terminated at the reverse proxy (Caddy in the reference
  deployment, which sets HSTS, `X-Content-Type-Options`, `X-Frame-Options` and a referrer policy
  and obtains its own certificate). An operator without a public address can use Tailscale Funnel
  instead, which terminates TLS the same way; that is documented as an option, not a dependency.
- **Supply chain:** Dependabot, container image scanning, cosign signatures and SBOM per
  release. *Dependabot is configured, and the release workflow signs each image keylessly with
  cosign and attaches an SBOM attestation. Image scanning is designed and not built.*

### Roles

| Role | May |
|---|---|
| Guest (not logged in) | Read the grid, occupancy anonymised as "occupied" |
| Member | Own bookings, own data |
| Trainer | Place training blocks via special cards |
| Groundskeeper | Close courts |
| Treasurer | Financial reports and exports — **no** passwords, no access rights |
| Admin | Master data, user accounts, configuration |

The treasurer role exists in Release 1 but has limited scope until the billing project
lands: reports and exports only. Defining it now avoids reshuffling the permission model
later.

Roles are permission *bundles*, not a rigid enum: in a club, one person often wears several
hats.

### Name visibility in the grid

**Participant names are never shown for someone else's booking — not to guests, and not to
logged-in members.** Only two views resolve names: a member's own booking, and the
administrative views (Admin, and Treasurer where a report requires it). This is not an
instance setting and clubs cannot switch it on.

Data minimisation is the reason. A booking grid that names players publishes, to every member,
who plays with whom and when — a movement and social profile that the booking function does not
need. The club's legitimate interest is that a court is occupied, not by whom.

What the grid shows instead of a name is the **match type**, derived from the participant
count: `SINGLES` for two players, `DOUBLES` for four, rendered by the frontend in the viewer's
language. That is more useful than a name for the
only question the grid has to answer — is this court taken, and for how long — and it carries
no personal data.

Consequences for the model and the API:

- `AllocationResponse.bookedByName` stays null on every member-facing response. It is filled
  only by the administrative endpoints, which are a separate authorisation surface.
- A booking's participant count is public; the participants are not.
- Guest names are personal data too and follow the same rule.
- Any future partner-finding feature must be opt-in per member and must not be built by
  loosening this rule.

---

## 11. Data Protection

Each club is its own controller. Courtside cannot take that responsibility away, but it can
deliver the implementation.

- **Deletion concept as a scheduled job**, configurable: bookings are pseudonymised X
  months after season end (utilisation statistics survive, the personal reference does
  not); inactive accounts deleted after departure plus retention period; login logs after
  90 days.
- **Subject access and portability** (Art. 15/20) as self-service: every member can export
  their own data as JSON. The Release 1 export covers this.
- **Documentation templates in the repository**: a pre-filled record of processing
  activities, a TOM list, and a privacy policy template for the application. For German
  clubs this is a genuine adoption argument and costs only writing.
- **No personal data in logs** (section 9).
- **Data minimisation on import**: only pull what the booking system needs. Bank details
  belong in Courtside only if the club actually collects payments there.

---

## 12. Testing Strategy

Organised along risk, not coverage percentage.

| Area | Approach | Rationale |
|---|---|---|
| Booking rules | Unit tests, pure functions | Largest area of business logic |
| Booking flow | Testcontainers with real PostgreSQL | The exclusion constraint *is* business logic and must not be mocked |
| Concurrency | Parallel booking of the same slot | Exactly one `201`, exactly one `409` |
| Series creation | Integration test with conflicts | The preview must be correct or trust is lost |
| Module boundaries | Spring Modulith `verify()` + ArchUnit | Prevents creeping cycles |
| **Upgrade path** | Migration from previous versions to current | Third-party clubs skip versions |
| Booking journey | Playwright E2E | The one path that must always work |
| Public API | OpenAPI contract test | Part of the release promise |

The upgrade path test is the one most likely to be skipped and most painfully missed: once
AGPL users run version 1.2 in the wild, a broken migration means data loss for strangers.

---

## 13. Technology Summary

| Concern | Choice |
|---|---|
| Language / runtime | Java 25, Spring Boot 4.1 |
| Modularity | Spring Modulith |
| Database | PostgreSQL 17 (`btree_gist`, range types, exclusion constraints) |
| Migrations | Flyway, on startup |
| Frontend | React + Vite, PWA |
| API | REST/JSON, OpenAPI-documented, RFC 9457 errors |
| Sessions | Spring Session, database-backed |
| Observability | OTLP via `spring-boot-starter-opentelemetry`, structured ECS logs |
| Packaging | Multi-arch container image, GHCR |
| Reference deployment | Docker Compose + Caddy, in `deploy/` |
| Licence | AGPL-3.0 |

**PostgreSQL is not interchangeable here.** Exclusion constraints over range types are the
foundation of the overlap guarantee; MySQL and MariaDB cannot express them.

---

## 14. Open Questions for the Implementation Plan

1. Exact rule types to ship in Release 1. The four categories in section 5 are fixed; which
   concrete rules make the first cut is a sequencing decision for the plan.
2. Migration path from whatever a club runs today — which exports such systems offer and what is
   worth carrying over.
3. A public domain, should the project ever want one. Nothing depends on it: the base package
   is `org.courtside` and the error types in section 6 are URNs, which name a problem without
   claiming a host.
