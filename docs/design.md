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

Fourteen modules exist: `api`, `audit`, `booking`, `card`, `config`, `dataexchange`, `demo`, `facility`,
`identity`, `member`, `performance`, `rules`, `securityassessment`, `shared`. `api` holds the OpenAPI-generated request, response and
controller-interface types and carries no logic of its own, which is why it is declared shared
alongside `shared` rather than given `allowedDependencies` of its own. `demo` and `performance`
seed disposable environments — a walkthrough dataset and a synthetic load-test dataset — and each
refuses to start unless its environment guard confirms the database it is about to fill is the
disposable one it names (`courtside_dev` for `demo`, `courtside_perf` for `performance`), not
whatever the deployment happens to point at. The `notification`, `reporting` and `integration`
modules of section 3 are designed and not built. `audit` is built: every configuration change made
through the admin API — facility, cards, config, rule sets and the roster — is recorded in the
append-only `domain_event` table before the commit that makes it: actor, time, entity, and, except
for free text, the values. A free-text field never carries its value — a create event omits it, a
change event names it in `changedFields` (`fields` for `roster.person.corrected`) — which is what
keeps section 11's erasure working, since the log then holds nothing personal to remove. Bookings
are not included; they carry their own status history. Coverage is enforced by a test, not by
memory: it inventories every public method of the seven administrative services against an event
type or an explicit `none`. The log is read back through `GET /api/admin/audit`, a cursor-paged,
administrator-only endpoint that resolves the subject and the acting account to the names they
carry today. `ConfigurationSubjectNames` is the port interface that resolution uses: an adapter
beside each of the five publishing modules, plus one in `identity` that resolves a roster event's
subject — a person id — to that person's display name, since `member` publishes the event but
`identity` owns the person. `audit` depends on none of the five directly. Three gaps are accepted
rather than closed: the bootstrap administrator's own account is created by writing `Person` and
`UserAccount` straight to their repositories, bypassing the roster service, so that one write is
never recorded at all; the demo seed does the same for its own two demo members — `Person`,
`UserAccount` and `Member` written straight to their repositories — so those writes are not
recorded either; and the demo seed's court changes, which do go through `FacilityService`, are
recorded with no actor, because the seed runs as an `ApplicationRunner` before any session exists.

Built and covered by tests: the booking core including the exclusion constraint, booking cards and
participant cards, booking series and multi-court allocation, the rule engine, opening hours and
courts, accounts, roles and session login, club configuration and branding, the audit log of every
administrative change, the roster — the club's
people, the account and roles a person holds, the membership they hold with the dates it runs
between, correcting a username and resetting a password — and the admin surface for all of it. A
club can also describe the systems it means to synchronise its roster from: the column mapping, the
membership types a source's categories stand for, the fields that source owns and the share of the
roster whose disappearance needs confirming — and it can say which member number of a source stands
for which person, which is what makes a second snapshot an update rather than a second set of
people. A club can upload a snapshot and see exactly what it would change — every creation, every
field of every update, every membership that would end, every row that could not be read and every
creation that resembles somebody the roster already holds — and it can then execute exactly that
reviewed change set, atomically, once per source at a time, refusing the run if anybody it would
touch has changed in the meantime. What is still missing is the browser journey for it, accounts
created from a snapshot, and export. `/actuator/health` is exposed. The
OpenAPI document is the source of truth: every controller implements an interface generated from
it, and an instance serves the document it actually answers to at `GET /api/openapi.yaml`. A
tagged release builds a multi-arch container image, publishes it to GHCR signed with cosign and
carrying an SBOM attestation, and attaches the OpenAPI document to the release. The reference
deployment carries the club's own mail server behind a profile, together with a check that resolves
the DNS a receiver looks at; nothing in the application sends through it yet.

The web client is built and covered by tests too: the court plan as the public landing page,
personal booking management, managed appointments for officers, and the browser admin surface for
configuration, facilities and the club's people — adding somebody, correcting their name or address,
giving them an account, changing its roles, correcting its username, handing out a new one-time
password and disabling it. Memberships and the import sources are the exceptions: they are served by
the API and have no browser surface yet, so a board reaches them through the API alone.

Designed and not built: observability alerts and the reference collector stack of section 9,
container image scanning, reports and exports, and the self-service password reset of section 4 — an administrator hands out a new one-time password
through the roster instead.

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
│ identity      Persons, accounts, roles, login    │
│ member        Memberships, the roster surface    │
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

The two consumers want different guarantees, and both are served from one publication. `audit`
listens **before the commit** and writes its row in the same transaction: no commit without a row,
which is the property that makes a log an audit log. That guarantee rests on the transaction, not
on where a publish sits in a method — the one `@TransactionalEventListener` is registered at
`BEFORE_COMMIT`, and a `RuntimeException` rolls the transaction back before it ever runs, so a
change that never commits is a change never recorded. Everything else listens **after** it, through
the event publication registry, which stores the publication in that same transaction and therefore
delivers again after a restart that interrupted it — at least once, never never. A producer knows
neither consumer.

An event carries ids and values that are not personal. A correction to a name or an address records
which fields changed, not what they were: an id whose row is gone is how section 11 erases somebody
from a table that is never rewritten. In the process the events are typed records the compiler
checks; in the table the payload is `jsonb` a reader reads defensively, because stored rows outlive
the code that wrote them. Payload changes are additive, a field that would be renamed or removed
gets a new event type, and a guard holds every payload shape against a recorded snapshot.

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
    cancelled_by  uuid REFERENCES user_account,
    moved_at      timestamptz,
    moved_by      uuid
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
    allowed_player_counts smallint[] NOT NULL,   -- see "Player slots" below
    counts_against_limits boolean    NOT NULL,   -- counts towards member quota?
    guest_allowed         boolean    NOT NULL,
    active                boolean    NOT NULL DEFAULT true
);

CREATE TABLE booking_card_allowed_role (
    booking_card_id uuid NOT NULL REFERENCES booking_card ON DELETE CASCADE,
    role            text NOT NULL,
    PRIMARY KEY (booking_card_id, role)
);

CREATE TABLE booking_card_managing_role (
    booking_card_id uuid NOT NULL REFERENCES booking_card ON DELETE CASCADE,
    role            text NOT NULL,
    PRIMARY KEY (booking_card_id, role)
);
```

A new card type is a row in the admin backend, not a deployment. A card with no allowed roles
is available to every authenticated member account; otherwise holding any listed role is
sufficient. Future external accounts are never covered by an empty role list and may use only
cards that explicitly allow `EXTERNAL_BOOKER`.

The two role tables read in opposite directions, and deliberately so. An empty *allowed* set
opens the card to everyone, because a card nobody gated is a card for the whole club. An empty
*managing* set opens it to nobody but the admin, because access to other people's bookings is
something a club grants rather than forgets to withhold. Section 10 covers what a managing role
may then see.

Cards express permissions and booking behaviour, never identity. Creating, changing or cancelling
a booking requires an authenticated account; no booking or participant card carries a shared
credential. Codes that unlock a local device or kiosk belong to that device and do not authorize
Courtside actions.

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

### Player slots have an exact configured count

A member booking has an **exact** number of player slots selected from its booking card's
`allowed_player_counts`, and the booker occupies one of them. Each remaining slot is filled by a
member, a guest, or a participant card. The seeded member card permits two or four players, but
the model does not assign sport-specific names to either count.

That is what makes a ball machine work: one member plus `Ball machine` satisfies a two-player
booking, and three members plus `Ball machine` satisfy a four-player booking. The machine fills
one participant slot in either case.

```sql
booking_card
    allowed_player_counts   smallint[] NOT NULL -- member card: '{2,4}'; training/closure: '{}'
    show_generic_occupancy  boolean NOT NULL    -- member card: true; named occupancy: false

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

The slot count is not mapped to a sport-specific label. `show_generic_occupancy` controls whether
the grid renders a neutral localised occupancy label, optionally with the numeric participant
count, or the configured booking-card label. This is independent of player tracking, so training,
league matches and special events keep their configured labels even when they record participants.

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
  this separation anyway. The column carries no unique person, so a second account is a row the
  schema tolerates and the roster reads past — but the admin surface refuses to create one,
  because every write there names an account by its person and a second account would be
  unreachable through the surface that made it.
- **`booking_participant`** references either a `person` (member) or carries a free-text
  `guest_name`. Guest bookings are prepared in the model without Release 1 having to do
  billing.
- **`rule` stores parameters as `jsonb`** rather than one column per rule type. A new rule
  kind is a validator class plus a row, not a schema migration.
- **`membership_type` → `rule_set`** is what makes "juniors only until 18:00" possible
  without a special case in code.
- **`member` is one dated row per person, and a membership that ends is kept rather than removed.**
  `UNIQUE (person_id)` holds, so "at most one membership" stays the database's answer and every
  reader finds one row. Ending a membership records the date it ended; the row keeps the type its
  holder last had, so a club can still see who was a member of what and until when, and a rejoin
  revives the same row from a new start date. The price is deliberate: after a rejoin the previously
  held type is gone. Bounded periods with a readable history are a different model, and widening
  `member` underneath a rule engine that assumes a single current membership is its own decision.

  **The dates record, they do not schedule.** Whether somebody is a member is decided by whether an
  end date is set, and no query compares a date with today. Neither date may therefore lie in the
  future: a start next month would make somebody a member now, and an end in December would stop
  their membership today — seven months of a member measured against no membership-scoped rule at
  all. The roster refuses a future date rather than storing one nothing honours. Scheduling a
  membership ahead needs date-aware currency in every reader, and that is the period model above.

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

This is a case standard frameworks do not provide and must be built explicitly. Until it is, the
roster is the only remedy: an administrator hands out a new one-time password (section 10), which
is what the self-service paths above would take the board out of.

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

**A person without a membership is bound by no membership-scoped rule.** *Accepted, not closed.*
This covers a membership that has **ended** exactly as it covers one never given: a person whose
membership carries an end date is no longer measured against its type, so ending a membership
loosens what its holder may book rather than tightening it. Anything that ends memberships in bulk
therefore has to take the account's permission away in the same step, or it hands departed members a
less restricted account than they had as members.

Section 10 states the same thing from the session side and calls it the most permissive state the
booking rules know; the roster reaches it in one step, because a person can be given an account
without being given a membership, and such an account then books as far ahead and as often as the
grid allows. It stays open because the alternative, reading "no membership" as "no booking",
changes what every installation already permits and is a decision of its own rather than a
correction. Three things bound it: the roster reports the membership on every entry, so a person
without one is visible in the list rather than hidden in it; opening hours, the slot grid and every
rule not scoped to a membership type still bind, because they describe the facility and not the
person; and only an administrator can create an account, so nobody reaches the state without a
board putting them there.

**Evaluation does not stop at the first violation.** All violations are collected —
otherwise a member works through three error messages one at a time.

A `RuleViolation` carries an **i18n key plus parameters**, never rendered text:
`booking.rule.maxOpenBookings.exceeded` with `{limit: 2, current: 2}`. This keeps messages
translatable and lets the frontend attach them to the right form field.

Adding a rule type = one validator class + one configuration row.

### Two kinds of rule: who may book, and what the grid is

Rules split along a line that matters more than it first appears:

**Overridable rules restrict who may book.** Advance window, maximum open bookings, and the
roles a booking card allows are all statements about a person's entitlement. `ADMIN` sets
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
create the card in question — the card's allowed roles are enforced by `BookingWriter` at
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
| Database (`config` module) | Club name, colours, logo, opening hours, booking grid, time zone, rules, card types, locale | The club, in the admin backend |

Rule of thumb: anything a club board would plausibly want to change belongs in the database
and the admin UI. Anything requiring a restart belongs in `.env`. Nothing functional
belongs in code.

**Branding** is served from a public endpoint `/api/public/config` that the PWA fetches at
startup: club name, primary and accent colour, logo URL, imprint link, default locale.
Colours are applied as CSS custom properties on `:root` — no rebuild per club.

The **booking-grid duration** is a club setting between 5 and 120 minutes in five-minute steps.
The public grid, booking rules and series validation read the current database value through the
same configuration port. A change applies immediately to new bookings. It is rejected when a
confirmed active or future booking, or an existing opening-hours window, would not align with the
new grid. Historical bookings remain unchanged. Changing opening hours applies the same alignment
rule so the public grid never offers a slot that booking validation would reject. Grid changes,
booking writes, series moves and opening-hours changes serialize on the single club-configuration
row so a concurrent write cannot pass validation against a stale grid.

The **club time zone** is managed configuration rather than an environment variable. Every
zone-dependent read resolves it through the same configuration port as the booking grid, so no
reader keeps its own copy. Changing it is refused while any confirmed booking that has not yet
ended exists, whatever the new zone would be, because the instant already promised to a member
must not acquire a different club-local meaning. Historical bookings remain unchanged.

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

- **Repeatable snapshot synchronisation** replaces today's manual re-keying from the external
  membership system. A club uploads its export, reviews what it would change, and executes exactly
  that. Running the same file twice changes nothing the second time.
- **A source** describes one system a club synchronises from and is configured once rather than
  chosen per file: which header holds which field, which category value means which membership
  type, which fields that source owns — a field it does not own is the club's own and no snapshot
  overwrites it — and above what share of the roster disappearing an execution needs confirming.
  Every part of it is correctable, and a change decides what the *next* snapshot means rather than
  touching the people an earlier one created.
- **The file is read as the club's own system wrote it.** The separator is taken from the header
  rather than assumed, and a file that is not UTF-8 is decoded as Windows-1252 rather than refused,
  because the exports clubs actually hold are semicolon-separated and often neither. Nothing about
  the dialect is configured on the source: it is a property of the file, not a decision a volunteer
  can be expected to make about their own export.
- **An email address is optional, for a person and for a snapshot.** A real member list carries
  people a club has no address for, and a required column would have turned each of them into a
  rejected row. A person without one simply holds none; what that costs them is that nothing can be
  sent to them, which is a fact about the club's data and not a state Courtside invents.
- **A record is matched by the source and the member number it carries**, never by a name and never
  by an email address: two members really are called John Roe, and a club enrols children under a
  parent's address. A member number a source does not yet know becomes a new person, and where a
  board recognises the resemblance it links the two by hand instead. One person may hold a
  reference from each of several sources, which is what lets a club migrate between membership
  systems without the second one duplicating everybody.
- **A preview writes nothing and is never edited.** It resolves the whole file and answers with the
  change set a later execution would apply, so what a board approves is what runs. A header problem
  fails the file, because nothing in it can then be trusted; a cell problem fails one row and is
  reported beside the rest. Correcting a mistake means uploading the corrected file — an editable
  preview would no longer be what anybody reviewed. Above the source's own threshold, the share of
  its memberships that would end is flagged as needing a deliberate confirmation, which is what
  stands between a truncated export and a club that has lost half its roster.
- **An execution applies the reviewed change set and nothing else.** It is one transaction — a
  change set whose last row fails leaves no person, no membership and no reference behind — and if
  anybody it would touch changed between the preview and the run, it is refused rather than writing
  over a roster it no longer describes. Executions of one source serialise, and a successful one
  supersedes every preview of that source, so a stale change set cannot be applied afterwards.
- **A synchronisation can take a membership away; it can never hand one out.** When a membership
  ends, an account that held `MEMBER` and nothing else is disabled and its sessions end; an account
  holding another role keeps it and loses `MEMBER` only, so a card requiring `MEMBER` refuses it.
  No snapshot ever enables an account, because a board disabled it for a reason no membership
  system knows, and none can disable the club's own administration: an account holding `ADMIN`
  keeps that role and stays enabled. An import cannot lock a club out of its instance.
- **CSV export** for every list view in the admin backend, matching what existing booking
  systems offer today.
- **Per-member JSON export** for subject access requests (section 11).

---

## 9. Observability

The application can export **metrics and traces over OTLP** using
`spring-boot-starter-opentelemetry` and Micrometer's OTLP registry. Export is disabled unless
`COURTSIDE_OTLP_ENABLED=true`; the trace and metrics endpoints are configured separately because
each is a complete OTLP/HTTP URL. Actuator and structured ECS console logs are always present.
Only `/actuator/health` is exposed over HTTP by default, so enabling OTLP does not broaden the
management surface.

**Structured logging** is built in since Spring Boot 3.4 (ECS / Logstash / GELF), with
trace and span IDs correlated into log lines automatically:

```properties
logging.structured.format.console=ecs
logging.structured.ecs.service.name=courtside
management.tracing.export.otlp.enabled=${COURTSIDE_OTLP_ENABLED:false}
management.opentelemetry.tracing.export.otlp.endpoint=${COURTSIDE_OTLP_TRACES_ENDPOINT:http://localhost:4318/v1/traces}
management.otlp.metrics.export.enabled=${COURTSIDE_OTLP_ENABLED:false}
management.otlp.metrics.export.url=${COURTSIDE_OTLP_METRICS_ENDPOINT:http://localhost:4318/v1/metrics}
management.tracing.sampling.probability=${COURTSIDE_TRACING_SAMPLING_PROBABILITY:0.1}
```

The OpenTelemetry SDK remains active when export is disabled. That keeps local trace context and
log correlation available without making network calls. ECS logs remain on standard output for the
container runtime or a collector to ingest; Courtside does not send logs through a second exporter.

**JavaMelody is not used** — it does not fit the OTLP model and offers nothing Actuator plus
Micrometer does not do better.

**Spring Boot Admin is planned**, for a different purpose than Grafana: fleet overview across
instances, which version runs where, health status, and raising log levels at runtime when
a club reports a problem. That is operational *control*; Grafana is trends, history and
alerting.

### Domain metrics

| Metric | State | Type | Why |
|---|---|---|---|
| `courtside.bookings.created` | Built | Counter | Successful booking volume |
| `courtside.bookings.rejected` | Built | Counter (**rule**) | Which rule actually bites in daily use |
| `courtside.bookings.conflicts` | Built | Counter | How often concurrent occupancy prevents a booking |
| `courtside.password.rehash.failed` | Built | Counter (stage) | A rehash that only logs still leaves hashes at the old cost |
| `courtside.outbox.pending` | Planned with outbox | Gauge | Are emails backing up — the key leading indicator |
| `courtside.notifications.failed` | Planned with notifications | Counter (reason) | See delivery problems before the complaint |
| `courtside.login.failed` | Planned | Counter | Attack detection and UX signal |
| `courtside.backup.age.seconds` | Planned with backup automation | Gauge | The alert everyone forgets |

`courtside.bookings.rejected` tagged by rule is close to a product feature: a club can see
whether its own booking rules are obstructing members.

Standard Spring HTTP, JVM and HikariCP metrics provide endpoint latency and resource context.
Hibernate logs statements exceeding `COURTSIDE_SLOW_QUERY_THRESHOLD_MS` with placeholders rather
than bind values. Sampled requests add the trace and span IDs to the structured slow-query entry,
allowing an operator to correlate endpoint latency with the responsible query without exporting
personal data or high-cardinality identifiers.

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
  Security's own defaults. Login by username (section 4). *Built.* A stored hash below the current
  parameters is re-encoded on its owner's next successful sign-in; storing it is best effort, so a
  database failure there leaves the old hash in place and never turns a correct password into a
  failed login.
- **Password age is observable on a failed login.** *Accepted, not closed.* A wrong password against
  an account still on an older hash costs less than one against an unknown username, because the
  dummy verification that hides unknown usernames encodes at the current parameters. It needs no
  credentials, and it identifies accounts that have not signed in since the parameters were raised.
  Closing it means padding every failed login to a constant worst-case duration, which is a change
  to how the whole login path is timed rather than to how a hash is stored. Two things bound it: an
  observer must average many samples to see a few milliseconds through network jitter, and rate
  limiting (below) counts every attempt before the password is checked, instance-wide as well as per
  address. The population shrinks on its own, since each sign-in removes one account from it.
- **Sessions:** server-side via Spring Session in the database, delivered as an
  `HttpOnly` / `Secure` / `SameSite=Lax` cookie. **No JWT** — the PWA and API share an
  origin, so no token gymnastics are needed, and an admin can terminate a session
  immediately, which JWT cannot do. A role, membership or account-status change must terminate
  that account's active sessions in the same operation — a role or an account status because
  cached authorities must not outlive the change, a membership because what its holder may book
  changes with it and neither direction of that change is harmless. Every path that ends an
  account's sessions deletes the stored rows and raises a persisted account security epoch, and the
  epoch is what carries the guarantee where the deletion cannot reach: a request already in flight
  saves its session again afterwards, and a store that refuses the deletion must not fail the
  operation that revoked the session. A session created before the change fails closed either way.
  *Built.* The roster is the admin surface for it:
  disabling an account, removing one of its roles, correcting its username, resetting its password
  and changing the membership of the person it belongs to each raise that account's epoch, so its
  next request is refused rather than served with the rights or the credential it was signed in
  with. A membership is not a role, and no session carries a stale copy of one — a booking resolves
  the membership as it evaluates the rules — so the epoch moves here for the second reason above
  and not the first. Neither direction is harmless: the advance window and the open-booking cap
  are looked up through a membership type and are found for nobody without one, so no membership
  is the most permissive state the booking rules know; and a person without one drops out of
  participant search, so ending a membership takes as much away as assigning one does. The policy
  is about what an account is, not about what the club has configured: repointing a membership type
  at another rule set changes what every member holding it may book and leaves every session
  standing, as a rule set's own parameters, a court's opening hours and a card's roles do, because
  all of them are read while a request is served and bind the next one. Enabling an account, adding
  a role, writing the username an account already holds and writing the membership a person already
  holds leave sessions alone, as does the rehash on a sign-in, which replaces the stored hash
  without touching the epoch. It does raise the account's row version, so an administrator editing
  that account at that moment is answered 409 and re-reads rather than overwriting the new hash.
  Ending one single session while leaving the account's rights untouched still has no surface.
- **CSRF:** on, double-submit cookie. *Built.*
- **Brute force:** rate limiting before password verification. *Built.* Source-address counters
  absorb concentrated attacks and an instance-wide Argon2 budget bounds distributed attempts;
  both are stored in PostgreSQL. There is deliberately no username lockout: an anonymous attacker
  could renew it against a known administrator indefinitely. Success clears its address counter,
  while `Retry-After` tells a client when an address or instance cooldown ends.
- **Admin roles:** optional TOTP second factor. **Designed, not built** — there is no second
  factor of any kind today.
- **Booking authorization:** every booking mutation has an authenticated account as its actor.
  Booking and participant cards carry no shared credentials; account roles decide which cards the
  actor may use. Anonymous access is read-only. *Built.*
- **Source offer:** `GET /api/source` reports the running version, the commit it was built from
  and where its source can be obtained, unauthenticated. *Built.* An operator who forked sets
  `COURTSIDE_SOURCE_URL`; unset, it names this repository.
- **Security headers and TLS** are terminated at the reverse proxy (Caddy in the reference
  deployment, which sets HSTS, `X-Content-Type-Options`, `X-Frame-Options` and a referrer policy
  and obtains its own certificate). An operator without a public address can use Tailscale Funnel
  instead, which terminates TLS the same way; that is documented as an option, not a dependency.
  That sentence binds the client too: a browser withholds `crypto.randomUUID`, service workers and
  the rest of the secure-context APIs from a plain-HTTP origin that is not `localhost`, so no such
  API may sit on the path of a booking. `crypto.getRandomValues` is one that carries no such
  condition and is what the booking form draws its idempotency key from. *Built.*
- **Supply chain:** Dependabot, container image scanning, cosign signatures and SBOM per
  release. *Dependabot is configured, and the release workflow signs each image keylessly with
  cosign and attaches an SBOM attestation. Image scanning is designed and not built.*
- **Accepted: the mail server fetches its admin interface unpinned.** The reference deployment
  pins every image it names by digest, and the mail image is no exception — but on first start
  that image downloads its own web interface from the latest GitHub release, outside the digest
  the deployment pinned. An operator watching the container's first start sees the download; an
  observer wanting more needs read access to the volume it lands in. It stays open because the
  download happens inside a third-party image and closing it would mean forking that image or
  vendoring an interface this product does not maintain. What bounds it: the admin port is bound
  to the loopback interface, nothing else in the deployment reads that interface, and it is
  reached only during setup and recovery. *Built, as described.*

### Roles

| Role | May |
|---|---|
| Guest (not logged in) | Read the grid, occupancy anonymised as "occupied" |
| Member | Own bookings, own data |
| Trainer | Place training blocks via special cards |
| Sport director | Place training, league match and configured event blocks |
| Youth director | Place training, league match and configured event blocks |
| Groundskeeper | Close courts |
| Treasurer | Financial reports and exports — **no** passwords, no access rights |
| Admin | Master data, user accounts, configuration |

The treasurer role exists in Release 1 but has limited scope until the billing project
lands: reports and exports only. Defining it now avoids reshuffling the permission model
later.

Roles are independent permission bundles rather than a hierarchy: in a club, one person often
wears several hats.

A booking card names two role sets, and they answer different questions. Its **booking roles**
decide who may place an occupancy with it. Its **managing roles** decide who may open, read and
cancel every booking already made on it. A card bookable by members and trainers alike therefore
does not hand a trainer the participants of a member's booking; only naming the trainer among the
card's managing roles does that. An empty managing set leaves the card's bookings to their own
booker and to the admin, which is what a member card wants. Naming `Member` there grants nobody:
the check drops the member role before it matches, so no configuration turns every member into a
manager of every booking.

### Authenticated external accounts

**Designed, not built.** A person who is not a club member may later create a full, verified
account for club-configured external bookings. A guest account is a `Person` plus `UserAccount`
without an active `Member` relationship; an active membership turns the same identity into a
member account. There is no immutable account-type field, so booking history and account credit
survive either transition.

External booking is disabled until a club configures suitable booking cards, prices, participant
limits and cancellation rules. A verified external account receives the dedicated
`EXTERNAL_BOOKER` permission and may use only cards that explicitly allow it; an empty card role
list never grants external access. Such bookings require sufficient account credit or a confirmed
PayPal payment before they become binding. The authenticated external account holder is distinct
from an accompanying guest entered as a participant. Anonymous visitors remain read-only.

### Name visibility in the grid

**Participant names are never shown for someone else's booking — not to guests, and not to
logged-in members.** Three surfaces resolve names: a member's own booking, the administrative
views (Admin, and Treasurer where a report requires it), and the managed-appointment view of the
roles a booking card names as managing. The last exists because an officer answerable for an
appointment has to know who is in it, and the club decides per card which roles carry that
responsibility. The grid itself is none of them: it is not an instance setting and clubs cannot
switch it on.

Data minimisation is the reason. A booking grid that names players publishes, to every member,
who plays with whom and when — a movement and social profile that the booking function does not
need. The club's legitimate interest is that a court is occupied, not by whom.

What the grid shows instead of a name is a neutral localised **booked** label, optionally followed
by the numeric participant count. The count is not mapped to a sport-specific term. Named special
occupancy keeps its configured booking-card label. This answers the only question the grid has to
answer — is this court taken, and for how long — without carrying personal data.

Consequences for the model and the API:

- `AllocationResponse.bookedByName` stays null on every member-facing response. It is filled
  only by the administrative endpoints, which are a separate authorisation surface.
- `Allocation.ownBooking` is decided from the authenticated account on the server and is always
  false anonymously. Clients do not infer ownership.
- An own member booking carries only the last names of other member participants. The client adds
  its localised viewer marker; guest names never enter the grid response.
- A booking's participant count is public; the participants are not.
- **A member is recorded as a co-player without being asked, and can undo it.** Any authenticated
  account may search the member directory and name anybody, so the record exists before the named
  member knows of it. `GET /api/my/participations` is how they find out and
  `DELETE /api/my/participations/{bookingId}` is how they object; neither needs the booker's
  agreement. Withdrawing takes the member's place out and leaves the booking, its court and its
  other participants standing — a booking left below its card's player count is not corrected,
  because an objection is not a rebooking. The list resolves no name at all, not the booker's and
  not the other participants', so exercising the objection reveals nothing the grid would not.
  **Built.**
- **The objection has no time limit and no card exception.** It reaches a booking that has already
  happened as readily as one still ahead — a member usually learns of the record after the fact, so
  the past is the case it exists for. It reaches whatever card recorded them, though as shipped only
  the member booking card records anybody: `allowed_player_counts` is empty for training, league
  match and court closure, so those carry no roster to leave. A club that gives a managed card
  player counts gets the objection there too, and the managing role learns of it by reading the
  appointment detail — there is no notification. **Built.**
- Guest names are personal data too and follow the same rule.
- The managed-appointment detail is not the grid. It resolves every participant of the booking,
  guests included, for a card's managing roles and for an admin. Widening a card's managing roles
  therefore widens who reads those names, which is why the API default for a card's managing set
  is empty: creating or changing a card never inherits management from who may book it, a club
  chooses it deliberately. The cards a fresh install ships with are the one exception in data, not
  in rule: their managing roles start as the officer roles that may book them.
- Any future partner-finding feature must be opt-in per member and must not be built by
  loosening this rule.

### Day plan interaction

The multi-court day plan is the primary member view. One to four active courts share its available
width; larger facilities keep a usable court width and scroll horizontally. Court headings and the
time axis remain fixed while the plan scrolls, and a 30-minute slot occupies 40 pixels on desktop.
An occupancy spans its complete duration instead of repeating in each slot.

Free, occupied, own and unavailable states combine text or a pattern with colour. Past slots remain
visible but cannot open the booking form. On the current day, the plan marks the current time,
initially moves to the next slot and offers a return-to-now action. It refreshes after mutations,
after a booking conflict, whenever the window regains focus and once per minute.

---

## 11. Data Protection

Each club is its own controller. Courtside cannot take that responsibility away, but it can
deliver the implementation.

- **Deletion concept as a scheduled job**, configurable: bookings are pseudonymised X
  months after season end (utilisation statistics survive, the personal reference does
  not); inactive accounts deleted after departure plus retention period; login logs after
  90 days.
- **The audit log is covered by that job rather than exempt from it.** `domain_event` is
  append-only and is never rewritten to erase somebody: it holds ids and values that are not
  personal, so removing the person the id names is what makes the entry anonymous. What the log
  keeps is that a change happened, when, and which account made it — never a name, an address or a
  credential. The event publication registry beside it holds an event only until its
  consumers finish: a completed publication is deleted rather than retained, so nothing accumulates
  there for a job to clean up later.
- **A sign-in session's row goes when the session does.** A session stops working the moment it
  expires, but its row — and the attributes cascading from it, which carry the username, the account
  id, the roles and the security epoch it was signed in with — is deleted on the cadence of
  `COURTSIDE_SESSION_CLEANUP_CRON`, a minute by default. The stored credential is not among them:
  it is erased once the account has been authenticated and never reaches the store. The cadence may
  be widened but not switched off, and an instance configured to switch it off refuses to
  start. **Built.**
- **An import never keeps the file it was given.** What a preview holds is the SHA-256 of the
  uploaded bytes and the change set resolved from them — a club's whole membership list, in other
  words — and that change set is bounded by `COURTSIDE_IMPORT_PREVIEW_RETENTION`. What survives
  past it is the row, the name of the uploaded file, its SHA-256 and the counts — what an audit of
  *what was executed* needs, and no member's name, address or number. A scheduled sweep enforces the
  bound, a preview past it answers without its change set, and a swept preview is refused rather
  than executed against one that is no longer there.
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
