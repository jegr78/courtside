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

Fifteen modules exist: `api`, `audit`, `booking`, `card`, `config`, `dataexchange`, `demo`,
`facility`, `identity`, `member`, `notification`, `performance`, `rules`, `securityassessment`,
`shared`. `api` holds the OpenAPI-generated request, response and controller-interface types and
carries no logic of its own, which is why it is declared shared alongside `shared` rather than given
`allowedDependencies` of its own. `demo` and `performance` seed disposable environments — a
walkthrough dataset and a synthetic load-test dataset — and each refuses to start unless its
environment guard confirms the database it is about to fill is the disposable one it names
(`courtside_dev` for `demo`, `courtside_perf` for `performance`), not whatever the deployment
happens to point at. The `reporting` and `integration` modules of section 3 are designed and not
built. `audit` is built: every configuration change made through the admin API — facility, cards,
config, rule sets, the roster and the import configuration — is recorded in the append-only
`domain_event` table before the commit that makes it: actor, time, entity, and, except for free
text, the values. Which services that covers is derived from the admin API rather than listed, so a
surface is covered on the day its controller is written instead of on the day somebody remembers to
name it. A free-text field never carries its value — a create event omits it, a change event names
it in `changedFields` (`fields` for `roster.person.corrected`) — which is what keeps section 11's
erasure working, since the log then holds nothing personal to remove. Bookings are not included;
they carry their own status history. Coverage is enforced by a test, not by memory: it walks the
admin API's own controllers to the services behind them and inventories every public method of each
against an event type or an explicit `none`. The log is read back through `GET /api/admin/audit`, a
cursor-paged, administrator-only endpoint that resolves the subject and the acting account to the
names they carry today. `ConfigurationSubjectNames` is the port interface that resolution uses: an
adapter beside each of the six publishing modules, plus one in `identity` that resolves a person id
— the subject of a roster event and of an import's link events — to that person's display name,
since `member` and `dataexchange` publish those but `identity` owns the person. `audit` depends on
none of the six directly. Three gaps are accepted rather than closed: the bootstrap administrator's
own account is created by writing `Person` and `UserAccount` straight to their repositories,
bypassing the roster service, so that one write is never recorded at all; the demo seed does the
same for its own two demo members — `Person`, `UserAccount` and `Member` written straight to their
repositories — so those writes are not recorded either; and the demo seed's court changes, which do
go through `FacilityService`, are recorded with no actor, because the seed runs as an
`ApplicationRunner` before any session exists.

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
touch has changed in the meantime. A membership type can be marked as granting an account, and an
execution then opens one for every person it covers who does not already hold one, holding `MEMBER`
alone and with its one-time password mailed to that member rather than shown to anybody; the
preview names per row whether an account would be opened and, where it would not, why, and it
reports every row whose mailbox more than one person reads. A board can also answer, from a
person's page, what the instance holds about that one person — the file described in section 11 —
while the CSV export of the admin list views is still missing. `/actuator/health` is exposed. The
OpenAPI document is the source of truth: every controller implements an interface generated from
it, and an instance serves the document it actually answers to at `GET /api/openapi.yaml`. A
tagged release builds a multi-arch container image, publishes it to GHCR signed with cosign and
carrying an SBOM attestation, and attaches the OpenAPI document to the release. The reference
deployment carries the club's own mail server behind a profile, together with a check that resolves
the DNS a receiver looks at, and the application sends through it: the `notification` module reacts
to an event and generates the credential at the moment it is sent. Both message bundles ship, and
which one an account is written to in is the club's configured default at creation, the member's
own choice afterwards, and an administrator's correction where a member cannot reach it. Mail
configuration is mandatory — an instance without it refuses to start and names
the variables it is missing — and `/actuator/health/mail` reports the sending path to an
administrator without ever opening it. The message names the date its password stops working, and
sign-in enforces that date: once it has passed the credential no longer authenticates, and the
board issues a new one. How long an invitation and a reset last is a club setting, one figure for
each, so a board that knows its own members decides it rather than inheriting ours. The date binds
the issued credential only, so a member who has since chosen their own password keeps it. A message a
transport failure interrupts is retried, and if the ladder is spent the event stays outstanding
rather than being recorded as sent, so a restart republishes it instead of losing it. A recipient
the relay itself rejects is not retried at all: an address nobody holds is not going to start
existing between attempts. Issuing and sending are one transaction: a credential nobody received
never replaces the one on file, and a member is not locked out by a mail server that was briefly
away. The price is that the retry ladder holds a database connection and that account's row for as
long as it runs.

Every outgoing message leaves a record of its own, in `message_record`: which account, which kind of
message, the `Message-ID` this instance set, when it was queued and what became of it. Four states,
and none of them says delivered — `queued`, `handed_over`, `refused`, `failed` — because handing a
message to the club's mail server is the last thing this instance can observe, and a state claiming
more would claim knowledge nobody has. A refusal carries the kinds of failure the mail library
reported and the SMTP status code, never the relay's own words about an address. The record stands
on its own transaction per state change, so the rollback that protects the credential above cannot
take the row that explains it. `GET /api/admin/messages` reads it back, cursor-paged and
administrator-only — who was written to and when is personal data, and no officer role needs it —
and the administration surface shows it as a log of its own and as the last message beside the
credential state on the person's page. There is no control anywhere that sends the same message
again: a credential exists only as a hash once it has gone out, so the remedy for a refusal is to
correct the address and ask for new credentials. What raises the
event is the roster: creating an account asks for a credential at once, and one action sends a new
one afterwards, for a message that never arrived, a deadline that passed, or a member who no longer
knows their own password. Nobody on the board chooses it, sees it, or has to pass it on, and it
appears in no response, log or problem detail. Which of the two lifetimes applies is read from the
account rather than chosen by the caller; how often credentials may be requested for one account is
limited; and an account with no address or a deactivated one is refused where the board can see it,
rather than failing where only a log would carry it. Correcting a person's address withdraws whatever was
issued to the address it replaces, because a message already sent cannot be recalled from a mailbox
that was never theirs.

Which of those messages a member receives is theirs to choose. `/my-messages` lists every kind the
instance sends and a member switches off what they do not want; `message_optout` holds one row per
declined kind, and the absence of a row is a yes, so a kind added later reaches everybody who chose
before it existed. The check sits in the one funnel every mailer passes through rather than in each
of them. Three kinds cannot be switched off, because doing so would take away something no other
path replaces: the credentials an account needs to sign in at all, the notice that a closure
displaced a booking, and being told somebody wrote you into one. The instance refuses those by name
instead of ignoring the request, and the constraint that lists them is read back out of the database
and compared against the enum at build time. A message somebody declined is not a message that
failed, so it leaves no row in `message_record` and the log says it was not sent — which also means
the message log cannot tell a board that somebody declined, and is not meant to: what a member
chose is the member's, not the board's.

The web client is built and covered by tests too: the court plan as the public landing page,
personal booking management, managed appointments for officers — including creating a recurring
series, which is previewed before anything is written and reports what it had to skip — and the
browser admin surface for configuration, facilities and the club's people — adding somebody,
correcting their name or address, giving them an account, changing its roles, correcting its
username, sending it new credentials and disabling it. Membership types are administered there as
well, each showing how many people hold it and whether it opens an account on import, and the
configuration names the rule set that measures a person holding none. A rule set can bar its holders
from booking a court at all and can require its holders to cancel before a configured deadline. So is the whole
import: describing a source, linking the people a file cannot match by number, uploading a member
list, reading what it would change, and running it. The column
mapping is offered from the club's own export, read in the browser and never uploaded for that
purpose. Before a court, a booking card or a day goes out of service, the facility view says which
bookings sit on it — information beside the control, never a gate in front of it. No administrative
surface loses work by accident: an edited row, a described import source and a half-filled creation
form each count as something to lose, and leaving asks first — the page, whether inside the
application or by closing the tab, and equally the editor on it when another rule set or another
import source is opened in its place. A change that answers for one attribute leaves the rest of
the row as it was typed, and a refused creation leaves the form as the board left it. What a board
still cannot reach from a browser is listed with the endpoints that have no surface, in
`tools/surfaceless-endpoints.json`; every entry left in it now names a
decision rather than a gap.

A booking now writes to the people it concerns: the member who made it gets a confirmation carrying
the day, the period, every court it holds and the kind of booking, in the account's own language; a
member somebody recorded as a co-player is told without being asked first; whoever booked is told
when that member takes themselves out again; and when a court, a booking card or a weekday goes out
of service, or opening hours no longer cover a booking, everybody in it hears so, with what was
closed; and a booking coming up reminds everybody in it, as many hours ahead as the club sets. All
of them are recorded in the same message log as a credential. A series stays one decision and gets
no message per occurrence. Of section 6's table, the booking confirmation is the row that is built;
the rest are designed.

Designed and not built: observability alerts and the reference collector stack of section 9,
container image scanning, reports and exports, and the self-service password reset of section 4 — a
board member has the instance send new credentials through the roster instead.

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

CSV **import** is in Release 1; export is not. A club adopting Courtside has to bring its members
in before it needs to take anything out, so the import is what Release 1 builds and the export
follows in the release after it. The live, bidirectional sync stays deferred to its own project.

The one export with a date attached to it is the per-member one that answers a subject access
request. It is not a convenience, and it is built ahead of the rest for that reason: a club owes
that answer within a month of being asked, whatever release the list exports are in.

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
stored per user account with a fallback to the instance setting. Switching it re-renders the text
and nothing else: no view reloads, so a selection, a typed value and a page already fetched all
survive the switch, and a failure already on screen is read out again in the language now chosen.

**Which languages an instance has is derived, not declared.** A language exists because the image
carries a `messages_<tag>` bundle for the screen and a `mail_<tag>` bundle for what is sent, and
because the frontend carries a translation of the same name; nothing lists the set anywhere, and an
image that translates one surface but not the other refuses to start rather than writing to a member
in a language they did not choose. `GET /api/public/config` serves the derived set as
`supportedLocales`, and every surface that offers a language reads it from there — no client, no
schema and no database constraint names a language. The contract states the *shape* of a language
tag; a well-formed tag the instance ships no translation for is refused with
`urn:courtside:error:language-unsupported`, at the boundary as a field error and again in the
service that writes it.

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
│ dataexchange  Import, export, subject access     │
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
on where a publish sits in a method — exactly one listener is registered at `BEFORE_COMMIT`, the
audit writer, and a `RuntimeException` rolls the transaction back before it ever runs, so a change
that never commits is a change never recorded. Everything else listens **after** it, through the
event publication registry, which stores the publication in that same transaction and therefore
delivers again after a restart that interrupted it — at least once, never never. A consumer that
waits on something outside the instance, as sending a message does, takes its own executor, so a
mail server nothing can reach does not hold up the audit trail behind it. A producer knows
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

`email` is **optional on a person, mandatory on an account**, never unique, and changeable at any
time. Clubs enrol children and juveniles under a parent's address, and a family with several
children then shares one address across several accounts — so an email address cannot serve as the
identifier.

A person may hold none. A club's own member list carries people it has no address for, and a roster
that refused to record them would be refusing the club's own data. An account may not: everything
that grants or restores access travels by mail — the first password, and both reset paths below —
so an account without an address is one nobody could ever recover. The roster therefore refuses to
create one, and refuses to take the address away from a person who already holds an account.

**Consequence for password reset.** The standard "enter your email" flow does not work. Two
paths, both supported:

1. Reset via **username** — single account, single link.
2. Reset via **email** — the message lists *all* accounts registered to that address, each
   with its own reset link ("Accounts for this address: *doe.jane*, *roe.john*").

This is a case standard frameworks do not provide and must be built explicitly. Until it is, the
roster is the only remedy: a board member has the instance send new credentials (section 10),
which reaches the member without the board seeing anything, but still needs somebody to ask.

A **guardian relation** (a parent seeing their children's bookings) falls out of this model
almost for free. It is noted as a candidate for a later release, not Release 1.

---

## 5. Booking Rules

All rule categories are configurable per club, per membership type or role:

| Category | Examples |
|---|---|
| Time grid and opening hours | Slot granularity (30/60 min), opening hours per weekday, season start/end, holiday handling, per-court deviations |
| Messages | How many hours before a booking its people are reminded, and zero for a club that wants no reminders |
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

**A person without a membership is bound by no membership-scoped rule, unless the club says
otherwise.** *Built.* This covers a membership that has **ended** exactly as it covers one never
given: a person whose membership carries an end date is no longer measured against its type, so
ending a membership loosens what its holder may book rather than tightening it, and anything that
ends memberships in bulk has to take the account's permission away in the same step.

The configuration answers it: `club_config.no_membership_type_rule_set_id` names the rule set
measured against a person who holds no current membership type, and every membership-scoped rule —
the advance window, the open-booking cap, the bound on one booking's length and the bar on booking
at all — resolves through it. The obvious repair, reading "no membership" as "no booking", stays
rejected: it would change what every installation already permits
and decide for the club rather than asking it. So the column is nullable and starts unset, and while
it is unset the state below is what holds.

While no rule set is named, this is the most permissive state the booking rules know, and the roster
reaches it in one step, because a person can be given an account without being given a membership.
Three things bound it: the roster reports the membership on every entry, so a person without one is
visible in the list rather than hidden in it; opening hours, the slot grid and every rule not scoped
to a membership type still bind, because they describe the facility and not the person; and only an
administrator can create an account, so nobody reaches the state without a board putting them there.

A membership type that names *no* rule set is a different answer and keeps it: the club said that
category is measured by nothing, and the club-level set does not stand in for it.

**Evaluation does not stop at the first violation.** All violations are collected —
otherwise a member works through three error messages one at a time.

A `RuleViolation` carries an **i18n key plus parameters**, never rendered text:
`booking.rule.maxOpenBookings.exceeded` with `{limit: 2, current: 2}`. This keeps messages
translatable and lets the frontend attach them to the right form field.

Adding a rule type = one validator class + one configuration row.

**A membership type may be barred from booking a court altogether.** *Built.* Clubs carry
categories that pay dues without playing — passive, supporting, honorary — and every rule type
above answers *how much*, none of them *whether*. Forcing the question through a quantity would
say the wrong thing out loud: a limit of zero reaches the member as "too many open bookings
(limit 0, current 0)". The bar is therefore a rule type of its own, `NO_COURT_BOOKING`,
parameterless like the opening hours and the slot grid, present in a rule set or absent from it,
and its violation carries its own key. A club builds a "passive" rule set, switches it on, and
points the membership type at it — a row, not a release.

It is an overridable rule, because it states who may book rather than what the grid is: an
administrator recording a court for somebody is doing their job. Taking the membership away does not
lift it *where a club has named a rule set for people holding no membership type and put the bar in
it* — that set is measured exactly like a membership type's own, which is why it had to exist first.
Where a club has named none, such a person is bound by no membership-scoped rule at all, the bar
included.

The signed-in court plan reads this standing permission before it offers a booking action and shows
the same coded violation that a refused write returns. Anonymous callers receive neither the check
nor the membership or rule-set configuration behind it.

It also survives a move, which no other overridable rule does. A move neither creates court time nor
adds a booking, so the quantity rules leave it alone and only the grid decides where an occurrence
may land; the bar is a different question, and somebody who may not book must not be able to reshape
what they already hold. `BookingRule.appliesToAMove` is where a rule says so, and it answers
`!isOverridable()` unless a rule states otherwise — a move that stayed silent would only ever miss a
restriction, never accept one the grid cannot hold.

What the bar does **not** govern is being named as a participant: a member barred from booking can
still be recorded as somebody else's co-player, because participants are named inside the booking
and only the booker is measured. A club that wants that closed as well is asking a different
question — who may *play* — and the product does not answer it today.

**A rule set may require cancellation before a deadline.** *Built.* `CANCELLATION_DEADLINE`
stores the minimum whole minutes between cancellation and the first occupied slot. No rule means
no deadline, and cancelling exactly at the boundary succeeds. The booking holder's current
membership and rule-set assignment decide the deadline, including the configured fallback for a
person without a membership type. An administrator overrides it. Series cancellation applies the
same check to every affected occurrence in one transaction, so one refusal leaves the whole
selected scope unchanged.

### Two kinds of rule: who may book, and what the grid is

Rules split along a line that matters more than it first appears:

**Overridable rules restrict who may book.** Advance window, maximum open bookings, the longest a
single booking may run, the bar on booking at all, and the roles a booking card allows are all
statements about a person's entitlement. `ADMIN` sets them aside — no flag, no per-request opt-in,
the role itself is the override. An admin placing a training block six weeks out is doing their job,
not circumventing anything.

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
    default boolean appliesToAMove() { return !isOverridable(); }
}
```

`RuleEngine.evaluate` runs every rule; `evaluateNonOverridable` runs only the second kind;
`evaluateForAMove` runs what a move still has to satisfy. A new rule is overridable unless it says
otherwise, which is the safe default: forgetting the flag costs an admin a restriction they could
have skipped, never a booking the grid cannot hold.

A move is measured against the person holding the booking, with the roles of whoever is moving it
deciding the override. The check the move builds carries both, because a rule that resolves the
membership from an absent person measures the wrong rule set without saying so.

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

**An omitted array is not the empty one.** A container the document requires arrives as `null` when
a body leaves it out, so the generated `@NotNull` refuses the request and names the missing field
rather than letting the omission act as "you chose nothing" — which for a list of opt-outs would
silently erase the choices already stored. One the document leaves optional arrives as an empty
container instead, so the code that reads it needs no null check. One whose type admits `null`
arrives as `null`, because absence there carries a meaning of its own: `MoveRequest.newCourtIds`
left out leaves the courts as they are. The three are held apart at the wire by
`OmittedContainerWireTest`, because which one a field falls under is decided by the document and
delivered by the deserialiser, and nothing in between states it.

A misspelt field name never reaches that rule: `fail-on-unknown-properties` is on, so the request is
refused naming the field nobody declared. The two defences answer `400` for different reasons and
neither substitutes for the other — turning the setting off would leave a typo to be read as an
omission, and only the required container's `@NotNull` would still refuse it.

**Every error carries that shape, including the ones no handler ever sees.** A method the servlet
container refuses, a request the filter chain's firewall turns away before authentication runs, a
filter that throws: none of them reach a `@RestControllerAdvice`, and the framework's own answer for
them is an untyped JSON body. The application therefore answers the container's error dispatch
itself, as `application/problem+json` with a `urn:courtside:error:` type —
`method-not-supported` for a refused method, `request-rejected` for a request the firewall rejected,
`unmapped-path` for an address that does not exist and `internal-error` for a failure that got that
far. That dispatch is permitted in the filter chain, because it is the tail of a request that has
already been decided; re-authorising it would report a 405 as a 401. The same gap opens one
layer further in, and stayed open longer: Spring answers a rejection it raises inside the
dispatcher — a binding failure, a body it cannot write, a method-validation failure — from its own
list, and that answer carries no type either. Those are mapped onto the same status-to-type table
the container dispatch uses, so a request refused before any operation ran reads the same whichever
layer refused it. `FrameworkRejectionCoverageTest` reads Spring's list rather than this
repository's, so a rejection a future Spring version adds arrives as a failing build instead of as
an untyped answer.

One layer sits below even that. A request target carrying a character the HTTP grammar does not
allow — `|`, `^`, `[`, a broken percent escape — is refused by the connector while it is still
parsing the request line, so no dispatch of any kind follows and the server's own answer is an HTML
page. The error report the connector falls back to is replaced with one that writes the same
`request-rejected` problem detail, which is why the shape holds for every answer this application
gives and not only for the ones a servlet saw.

**The client errors a request's own parameters can provoke are in the document.** They are declared
on the operation that answers them, and build-time checks keep that true: an operation with a path
parameter declares `400`, because a path parameter can always arrive malformed; one whose path
parameter is not an enum declares `404`, because such a parameter names something that may not
exist — a uuid names a row, an external identifier names a reference — and what names nothing is
answered `404`; and one carrying a query parameter it can refuse — one whose schema states a type,
a format, an enum or a bound — declares `400`. An enum path parameter is exempt from the `404` rule
on purpose: every value it accepts exists, so there is no unknown one to answer. A declared status
is never a bare key: every error this document declares answers `application/problem+json` with the
`Problem` schema, so what a client is promised is the shape above.

**Rule-set failures name how the rule set participates in the operation.** A rule-set identifier in
a rule-set administration path names the resource itself, so a missing row answers `404` with
`rule-set-not-found`. A membership-type or configuration body refers to a rule set as one of its
fields, so an unresolved reference answers `400` with a violation such as
`membershipType.ruleSet.unresolvable` and a problem type ending in `-unresolvable`. This naming
distinction belongs to those contracts, not to identifier location in general. Other operations may
choose different semantics to describe a compound invariant or avoid an existence oracle; their
OpenAPI response remains authoritative.

### Four failure modes that are easy to get wrong

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

**A paging cursor that outlives the caller's sight.** The booking lists are cursor-paged, and the
cursor names a booking rather than an offset — so resolving it is itself a read, and it carries the
same visibility predicate the list carries. A cursor naming a booking the caller may no longer see
resolves against nothing and the page ends, which is the answer the personal list already promises
in the API document. Resolving it unconditionally would answer two questions nobody asked: whether
that id names a booking at all, and roughly when it starts, because the page boundary is that
booking's first start instant. A cursor orders by start instant and breaks ties by id, so the naive
clause is two comparisons that each repeat the predicate — and the tie-break is the half a repeat
forgets, silently leaving the disclosure open for bookings that start together. The clause is one
row comparison instead, `(start, id) < (cursorStart, cursor)`, which states the predicate once and
has no second branch to forget. It is also faster than the clause it replaces, which
matters most on the managed list, where an administrator's page scans every booking the
club has.

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
| Court, card, weekday or opening hours closed under a booking | Everybody in a booking it displaces |
| A booking coming up | Everybody in it, the lead time set by the club |
| Series created | Creator, with the list of skipped occurrences |

Per-notification opt-out where legally permissible; what a member cannot switch off is what no
other path replaces.

**Built:** four things a booking says for itself. The member who made it gets a confirmation. A
member somebody recorded as a co-player is told, and whoever booked is told when that member takes
themselves out again. And a court, a booking card, a weekday going out of service or opening hours
narrowed under a booking tells everybody in every future booking it displaces — the booker and the
recorded players alike — naming what was closed; taking something out of service cancels nothing,
and the message says so, because the impact list beside the control is information for the board and
the booking stands until the board acts on it. And a booking coming up reminds everybody in it, as
many hours ahead as the club sets — zero switches reminders off, a booking made when it already
stood inside that window keeps its confirmation instead of hearing the same thing twice, one that
moves is reminded again for the appointment it now holds, and a booking is claimed before its
reminder goes out, so a second sweep, or a second instance, finds nothing left to do.

All of them are sent after the transaction that caused them commits, so a message never describes a
court nobody holds, and nothing a member does is refused because a message could not go out — an
account whose address is empty is logged by its id and nothing is sent. The events that carry them
name the booking, the person and the closure by identifier; what a message says about them is read
when the message is written, so neither the audit trail nor the message log learns where anybody
plays. No message names more than its reader already has: the notice about being recorded names the
booking and not the booker, and the notice about a withdrawal carries the name the booker chose from
the directory. A member who holds no account is not written to, because the message log is keyed by
the account that erases it, and neither is an account that has been deactivated — somebody who has
left the club is refused a credential for the same reason.

**Built:** a member chooses per kind what reaches them, on a page of their own. Booking
confirmations, the notice that somebody took themselves out of a booking, and reminders are
switched off and on again; credentials, the notice that a closure displaced a booking, and being
recorded as a player stay on, and asking for one of them to go off is refused naming the kind. A
kind nobody chose about is received, so choosing once does not silence what the club adds later.

---

## 7. Series and Multi-Court Bookings

Recurring bookings are a **must-have** for the recurring training blocks that run through
the season. A single booking can also occupy **several courts at once** — a training block
spanning three adjacent courts is one `booking` with one `court_allocation` row per court,
not three separate bookings that happen to share a time.

The API accepts several courts from anybody the rules allow; the browser offers the choice only to
an account holding a role beyond `MEMBER`, and states the chosen court to everyone else. Which
roles those are is the club's own decision, so the client derives the question from the role model
rather than from a list this product freezes into a release. Spanning three courts is what an
officer does deliberately and what a member does by accident, and the day plan already put them one
click from four checkboxes.

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

### Where a confirmation belongs

**A confirmation appears where the action cannot be undone by repeating it.**

By that rule, executing an import and ending a membership are confirmed, and so is deleting an
import source. The toggles are not — account, court, booking card, membership type — because
clicking again restores exactly what the click removed. Unlinking an external reference is not
confirmed either: linking it again puts back the same row.

The rule exists so the dialog keeps meaning something. Confirming everything that takes something
away trains people to click through, and then the dialog fails at the one place it was needed —
which, for this product, is a board about to end forty memberships because an export was truncated.
That is also why the confirmation there does not merely ask: it states how many memberships would
end, out of how many, and names the ordinary accident it guards against.

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
startup: club name, primary and accent colour, logo URL, imprint link, privacy-policy link,
default locale. Colours are applied as CSS custom properties on `:root` — no rebuild per club.
The two legal links are rendered side by side in the footer, and each is left out where the club
has set none. Both accept a root-relative path or an absolute HTTP or HTTPS URL: they are
navigation targets rather than subresources, and a club serving Courtside without TLS still has
to be able to link the pages it publishes. All three URL settings refuse tab, newline and carriage
return anywhere in the value. A browser strips those three before it parses a URL, so `/<TAB>/host`
would otherwise reach the same off-origin target as `//host` — the one thing the leading-slash rule
exists to refuse.
Logo URLs are either root-relative or HTTPS. A remote logo necessarily tells its operator the
visitor's IP address and the Courtside origin, so clubs should serve the image from their own
instance where possible. The CSP grants remote HTTPS only to images; every executable resource and
network connection stays same-origin. The time-bounded acceptance for that remaining image-source
scope lives in `security/exceptions.json`.

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

### Reporting and data exchange

Reports read from `domain_event` and the booking tables, and every one of them is also
available as CSV. *Designed.*

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
- **The preview refuses whatever the run would refuse.** A file is measured against the source's
  configuration as well as against its own rows, so a category the source maps to nothing, a
  category mapped to a membership type nobody offers any more, and a source whose default type is no
  longer offered while rows would be created with it all stop the upload rather than producing a
  change set that cannot execute. The default is weighed only where a row would reach it: a run of
  updates and endings names its own types, and refusing that file over a fallback nothing falls back
  to would block work the club can do.
- **The file is read as the club's own system wrote it, and the club says how.** The separator and
  the character set are both part of the source, because both are properties of the export tool
  rather than of one file: the club answers once, and every later upload is read by that answer.
  A single file may still deviate, so an upload carries an override that holds for that file alone.

  For a source nobody has described yet, the browser suggests a separator from the chosen file; once
  the club has confirmed one it stands, and a later file does not quietly replace it with a guess.
  Detection alone was tried and is not enough — counting columns in a header row settles nothing for
  a file with one column, and an export need not carry a header at all. A file read with the wrong character produces one enormous column and no way to tell why,
  so the answer belongs to the club rather than to a heuristic. Only what cannot work is refused:
  a line break ends a record and a quotation mark opens a cell, so neither can also divide one.

  The encoding is settled wherever the bytes settle it: a byte order mark and valid UTF-8 are facts
  about the content and are used without asking anybody.

  Beyond that it is the source's stored answer, and the reason it is stored rather than derived is
  that it cannot be derived. The 8-bit character sets share their byte ranges and differ in a
  handful of code points, so no library detects them — it guesses, and a guess that lands wrong
  imports mangled names with nothing said. The source therefore carries the *name* of a character
  set, defaulting to UTF-8, and a file that is neither marked nor valid UTF-8 is refused while the
  name in force says UTF-8 rather than being read as something nobody chose.

  **A name and not an enumeration**, because which character sets exist is a property of the
  platform an instance runs on and not a decision this product may freeze into a release. The
  instance reports what it can read — `Charset.availableCharsets()`, 173 of them on a current JVM —
  and the browser offers that list. A club whose export tool writes a Central European or Cyrillic
  one imports its members on the image it already runs; nobody waits for us. `StandardCharsets`
  would not do: it is itself a fixed set of nine that does not contain Windows-1252.
- **The roster filters by membership type across a module boundary.** `identity` owns the people
  and `member` owns the memberships, and the dependency runs from `member` to `identity` — so the
  filtered listing loads the type's current holders and passes their ids into the person query
  rather than joining, because a join in that direction is the cycle the module rules forbid. The
  cost is a parameter list that grows with the club, which PostgreSQL bounds at 65535 bindings per
  statement; a membership type with more holders than that would fail, and no single club has one.
  The alternative — a second paged query in `member` — would duplicate the cursor ordering, and two
  places that must agree on an ordering exactly is the heavier risk of the two.

- **An email address is optional, for a person and for a snapshot.** A real member list carries
  people a club has no address for, and a required column would have turned each of them into a
  rejected row. A person without one simply holds none; what that costs them is that nothing can be
  sent to them, which is a fact about the club's data and not a state Courtside invents.
- **An export without a header row is not supported.** *Accepted, not closed.* A column mapping
  names headers, so a file that carries none cannot be described at all: the club exports one with
  headers or the import is not for them. Mapping by position instead would be the repair, and it is
  a different feature rather than a correction — the position of a column is exactly the kind of
  thing that changes silently between two versions of an export tool, which is what naming avoids.

- **A record is matched by the source and the member number it carries**, never by a name and never
  by an email address: two members really are called John Roe, and a club enrols children under a
  parent's address. A member number a source does not yet know becomes a new person, and where a
  board recognises the resemblance it links the two by hand instead. One person may hold a
  reference from each of several sources, which is what lets a club migrate between membership
  systems without the second one duplicating everybody.
- **The column mapping is offered from the club's own file, and that file is not uploaded for it.**
  A source has to be described before any snapshot is accepted, and no board knows its export's
  headers by heart. The browser therefore reads the club's file locally — the header row for the
  columns, and the distinct values of the category column once that column is named, because the
  categories a club exports live in its rows and not in its header. Nothing is sent. An endpoint
  that accepted a file of personal data in order to learn a handful of words would be the worst of
  the options, and reading locally costs a club nothing.

  Reading it there is also what keeps the encoding answer honest. A board cannot be expected to know
  what its software wrote, and a blind answer would be worse than none — so the field stands beside
  the separator carrying what the source already says, an explanation appears when the chosen file
  turns out not to be UTF-8, which the browser can tell before anything is sent, and neither answer
  is ever blind: the columns on offer are re-read as each changes, so a wrong one shows itself
  immediately as headers nobody recognises. The club sees the consequence of both answers before it
  saves either. A browser decodes fewer character sets
  than a server does, so where it cannot read one it says so and offers no columns — the import
  itself still runs, because the instance knows the set even where the browser does not.
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
- **A synchronisation creates the accounts a club would otherwise create by hand.** *Built.*
  A club that imports 175 members and then opens 175 account forms has had the import's whole
  purpose handed back to it, so an execution gives an account to every person it creates whose
  membership type calls for one. The membership type carries two separate answers, because they
  are separate questions: whether its holders get an account, and whether they may book. A passive
  member may well want to see their own record without being able to reserve a court. The answer
  defaults to no, including for the membership types an instance already holds: switching it on
  mails a credential to everybody the next run touches, and no club starts doing that because it
  upgraded.

  What such an account may be is bounded. It holds `MEMBER` and nothing else, because no snapshot
  may hand out a role that administers the club. Its username is generated as `lastname.firstname`,
  the same shape registration suggests, numbered on collision and correctable afterwards like every
  other name a club enters. Its first password is generated, never displayed, and mailed to the
  member — a board that could read 131 passwords is the outcome this exists to avoid.

  **The transliteration follows the language the club runs in**, because there is no neutral answer:
  German writes `Jörg` as `joerg` and a Scandinavian club writing `Jørgen` is not served by the same
  substitution. Where the club's language has no rule for a character, the accent is stripped and
  what remains is kept. A name that leaves nothing a login name can hold — a script this rule cannot
  transliterate at all — falls back to `member.<the member number the club's own system uses>`,
  which is never nothing and is a name that club already recognises. None of this has to be right
  the first time: a username is editable afterwards like every other field an administrative
  surface writes.

  **It creates; it never overwrites.** A person who already holds an account is untouched, whatever
  the file says, so a repeated import cannot reissue a password or rename a login somebody is
  using. That also means the accounts a club has been missing appear on the next run rather than
  only for people the import has yet to meet.

  **The preview answers per row, not only in total.** Each row says whether an account would be
  opened and, where none would be, which of four reasons applies: the membership type grants none,
  the row carries no address to send a credential to, the row looks like somebody the roster already
  holds, or that person already signs in. A possible duplicate is deliberately among them — the
  person is still created, but an account for somebody who may already have one waits for a board
  to look. The count sits above the list, so what a board approves is what runs.

  **A shared mailbox is named, not refused.** Where a row would open an account on an address more
  than one person holds, the preview reports it with the number of people who would be on it once
  the run is done — those the roster already has plus those this run puts there. The account is
  still opened, because a shared address is the case the schema exists to serve, and refusing it
  would take the import away from exactly the clubs that enrol children under a parent's address.
  What must not happen is that it goes unsaid: one mailbox receiving twenty one-time passwords is
  the risk section 10 accepts, and it accepts it on the condition that a board sees the count
  first. A row that moves somebody onto the address counts twice at worst — the error runs towards
  reporting more sharing rather than less, which is the direction a warning may err in.

- **A synchronisation can take a membership away; it can never hand one out.** When a membership
  ends, an account that held `MEMBER` and nothing else is disabled and its sessions end; an account
  holding another role keeps it and loses `MEMBER` only, so a card requiring `MEMBER` refuses it.
  No snapshot ever *re*-enables an account, because a board disabled it for a reason no membership
  system knows — creating one that never existed is the separate thing described above, and the two
  must not be confused. None can disable the club's own administration either: an account holding
  `ADMIN` keeps that role and stays enabled. An import cannot lock a club out of its instance.
- **CSV export** for every list view in the admin backend, matching what existing booking
  systems offer today. *Designed.*
- **Per-member JSON export** for subject access requests (section 11). *Built.* This one was
  never deferred by preference: a club is the controller, and a controller that cannot answer what
  it holds about somebody is not compliant because its supplier ran out of release.

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
| `courtside.messages` | Built | Counter (**state**) | What became of what this instance sent, without opening the table |
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
  and not the first. Neither direction is harmless: the advance window, the open-booking cap and the
  bound on one booking's length are looked up through a membership type and, unless the club named a
  rule set for people holding none, are found for nobody without one; and a person without one drops
  out of participant search, so ending a membership takes as much away as assigning one does. The policy
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
  while `Retry-After` tells a client when an address or instance cooldown ends. A refused sign-in is
  logged with what refused it — the credential, a deactivated account, or which of the two limits
  holds — carrying the account id where one exists and never the username, the address or a name, so
  an operator can tell an attack from a member who mistypes without the log itself becoming a list of
  who tried to sign in.
- **Credential issuing:** limited per account over a configurable window, counted in PostgreSQL.
  *Built.* The account is the unit because the account is what the abuse targets: somebody holding a
  board member's session filling one member's mailbox with credentials that each invalidate the
  last. A board sending twice in a row is nowhere near the limit, and the refusal says how many went
  out rather than who sent them.
- **Admin roles:** optional TOTP second factor. **Designed, not built** — there is no second
  factor of any kind today.
- **Booking authorization:** every booking mutation has an authenticated account as its actor.
  Booking and participant cards carry no shared credentials; account roles decide which cards the
  actor may use. Anonymous access is read-only. *Built.*
- **Source offer:** `GET /api/source` reports the running version, the commit it was built from
  and where its source can be obtained, unauthenticated. *Built.* An operator who forked sets
  `COURTSIDE_SOURCE_URL`; unset, it names this repository.
- **Unsupported HTTP methods** are rejected without a server error, and which layer rejects them is
  fixed. The reference proxy answers `TRACE`, `CONNECT` and `TRACK` itself with 405 and forwards
  nothing else it does not relay. Every other method reaches the application, which answers 405 with
  the `Allow` header RFC 9110 requires when the route does not declare it, and 400 when the request
  firewall does not recognise it at all — as it does for a request target the HTTP grammar does not
  allow, which the connector refuses before any dispatch. All of those answers are RFC 9457, so a
  club running without the reference proxy loses nothing: the application is what answers. *Built.*
- **Security headers and TLS:** the application sets `Content-Security-Policy`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
  `Referrer-Policy: strict-origin-when-cross-origin` on its own responses. For a request it
  recognizes as secure, Spring Security also sets `Strict-Transport-Security`. Caddy repeats
  nosniff, frame denial and the referrer policy at the edge, sets HSTS independently and terminates
  TLS; `Permissions-Policy` is the only response policy here that comes only from Caddy. An operator
  without a public address can use Tailscale Funnel instead. When it supplies the trusted HTTPS
  forwarding signal, the response keeps all five application headers and loses only Caddy's
  `Permissions-Policy`. Funnel is documented as an option, not a dependency.
  That sentence binds the client too: a browser withholds `crypto.randomUUID`, service workers and
  the rest of the secure-context APIs from a plain-HTTP origin that is not `localhost`, so no such
  API may sit on the path of a booking. `crypto.getRandomValues` is one that carries no such
  condition and is what the booking form draws its idempotency key from. *Built.*
- **Supply chain:** Dependabot, container image scanning, cosign signatures and SBOM per
  release. *Dependabot is configured, and the build submits the tree Maven resolves so its alerts
  reach the transitive Java dependencies a POM does not name — the graph carried the declared ones
  alone until then, and an advisory against anything the Spring Boot BOM brought in was seen by the
  nightly source scan and by nothing else. The release workflow signs each image keylessly with
  cosign and attaches an SBOM attestation. Trivy scans the application's extracted layers and the
  source tree on every pull request and every release; the container image's own base layers are
  not, so that half is designed and not built.*
- **Security assessment evidence:** hosted assessments upload normalized public records and a CMS
  envelope encrypted to the tracked recipient certificate. The expected certificate fingerprint
  lives in a GitHub repository variable, outside commit history, so changing the certificate and a
  tracked expectation together cannot make the seal pass. A missing or mismatched value blocks
  sealing. The private key remains outside the repository, and the tracked key inventory records
  its custodian and decrypt-canary window rather than another copy of the fingerprint. *Built.*
- **The servlet container runs a version the platform does not manage.** Spring Boot 4.1.1 manages
  Tomcat 11.0.24, and `pom.xml` overrides that to 11.0.25 through the property Spring Boot documents
  for it. The earlier reading of this — that the advisories Apache published on 2026-08-25 reached
  nothing this application configures, and that overriding a managed version is how a dependency
  falls behind the platform instead — held for that batch: no HTTP/2, no container realm, no client
  certificate, no rewrite valve, no `web.xml` and no security constraint, because every
  authorization decision is made by the Spring Security filter chain. It did not survive the next
  batch. CVE-2026-65182, CVE-2026-65905 and CVE-2026-68525 are critical, they are improper access
  control, an authentication bypass by capture-replay in the DIGEST authenticator and incorrect
  authorization in FORM authentication, and 11.0.25 is the first version that fixes them. A
  reachability argument is a reason to wait for a platform release, not a reason to sit on three
  critical authentication defects, and no Spring Boot release manages 11.0.25.

  What the override costs: the version is pinned here rather than by the platform, so it stops
  moving when Spring Boot moves and somebody has to notice. What bounds that: the property names one
  artifact and one version in one place, the nightly source scan reports whichever version is
  resolved against the advisory databases, and a Boot release that manages 11.0.25 or later makes
  the property removable. *Built, as described.*
- **Accepted: the mail server fetches its admin interface unpinned.** The reference deployment
  pins every image it names by digest, and the mail image is no exception — but on first start
  that image downloads its own web interface from the latest GitHub release, outside the digest
  the deployment pinned. An operator watching the container's first start sees the download; an
  observer wanting more needs read access to the volume it lands in. It stays open because the
  download happens inside a third-party image and closing it would mean forking that image or
  vendoring an interface this product does not maintain. What bounds it: the admin port is bound
  to the loopback interface, nothing else in the deployment reads that interface, and it is
  reached only during setup and recovery. *Built, as described.*
- **Accepted: the instance does not validate the bundled mail server's certificate.** Everything
  that grants access travels by mail, so the credential and the password the instance authenticates
  with both cross the hop to the mail server. That hop is required to be encrypted — STARTTLS is
  required and not merely enabled, so a relay that stops offering it fails the handover rather than
  carrying a password in the clear — but the certificate is not authenticated, neither its issuer nor
  the name on it. Caddy issues for `COURTSIDE_DOMAIN` and not for the mail hostname, and the mail
  server generates its own for `localhost` alone, which is no name a compose network resolves;
  checking a name on a certificate whose issuer is unchecked would refuse the relay without proving
  anything, because whoever can redirect the connection writes both. An observer needs to be on the
  private compose network *and* able to redirect the application's connection to a server of their
  own. What bounds it: the exception is off by default in the application and switched on in
  `compose.yaml`, where a reader sees it; it names one host, the configured relay and no other; and
  a club pointing `COURTSIDE_MAIL_RELAY_HOST` at a provider with a real certificate clears
  `COURTSIDE_MAIL_TRUST_RELAY_CERTIFICATE` and is validated in full again. It closes when the mail
  server has a certificate of its own, which
  [#342](https://github.com/jegr78/courtside/issues/342) covers. *Built, as described.*
- **Accepted: whoever holds a mailbox can take over every account registered to it.** One address
  serving several people is deliberate — a parent registering for their children — so the same
  inbox receives each of their credentials, and a first credential is enough to set a password and
  keep the account. That was already true when a board member handed the password over; what
  changed is that no person stands between the address a club typed and the message. What bounds it:
  the club decides which address sits on which person and can correct it, and correcting it
  withdraws whatever was issued to the old one; the roster shows, before anybody sends, how many
  people share the address a message is about to go to, and an import preview says the same per row
  before a run opens any account, because a snapshot sends at a scale no per-person click reaches;
  the subject names the person it is for, so a
  shared inbox can tell two apart; and nothing else about an account can be reached this way — a
  credential grants the roles that account already had and no others. It stays open because closing
  it would mean forbidding a shared address, which is the case the schema exists to serve.
  *Built, as described.*
- **A booking a caller may not reach answers as though it did not exist.** Authorisation on a
  booking runs after it is loaded, so refusing it could have said `403` where an unknown id says
  `404` — and the difference is itself an answer, given to anybody authenticated, about an id they
  hold but should not be able to confirm. Both now answer `404` on the managed-appointment detail,
  on cancellation and on the three series operations, which is what
  `DELETE /api/my/participations/{id}` already did for its three cases. The series operations
  needed their order changed for it: they used to name the series before authorising the booking,
  so an unknown series, a series the booking is not in, and a booking nobody may reach were three
  distinguishable answers. The series is spoken of only after the caller has proved they manage the
  booking they named, and a series that does not exist reads like one the booking is simply not in.
  `403` stays declared on all five for the reasons that are not the domain's: a missing CSRF token,
  and the `anyRequest` rule turning away an authenticated account that still owes its first password
  change. Refusals are logged with the account and booking id, because the answer no longer shows an
  operator the difference between an attempt and a stale bookmark. *Built.*
- **What this does not hide.** `GET /api/bookings` is anonymous by design and carries the booking id
  of every confirmed allocation, so the existence of a booking that occupies a court on a known day
  was never a secret and is not one now. What the change withholds is existence for cancelled
  bookings, for bookings holding no court, and for any id whose day an observer cannot guess — and,
  on every one of them, the start instant. Inside a series a caller who manages the occurrence they
  named is still refused with `404` when a *different* occurrence of that series is beyond them; the
  answer is then imprecise rather than disclosing, and correcting it would either distort the
  single-booking cancellation that shares the code path or hand back the difference this section
  exists to remove.
- **Accepted: a change to the application alone is not measured against the active suites until
  somebody starts them.** The paired comparison is triggered by the digest of what a paired run varies — the
  assessment's code, its contract, the deployment description and the lockfile — so a pull request
  that only changes the application skips it, and the authorization suite's assertions about
  concrete answers are not re-checked against what that pull request built. What an observer needs:
  nothing. This is a gap in when a weakness would be noticed, not one a caller can reach. What
  bounds it: the required build still runs contract, schema, safety and secret checks on every pull
  request, the weekly scheduled assessment runs the **safe** profile against the image `main`
  builds, and any change to the assessment runtime itself triggers the paired comparison
  immediately. What does not bound it: nothing runs the **active** suites on a schedule. That
  profile is reachable only through `workflow_dispatch`, so the authorization matrix and the
  authenticated scanners meet a pull request that changes the application alone whenever somebody
  starts them by hand, and not before. It stays open because closing it means either a full active
  assessment on every pull request that touches the application, which is most of them, or a second
  scheduled run whose cost nobody has weighed yet. *Built, as described.*
- **Accepted: a red scheduled gate names itself in a public issue.** The failure tracker watches
  every workflow that runs on a schedule, so a red `security assessment` opens an issue in this
  repository — which is public — naming the workflow, the job, the step that failed, the commit
  range it covers and, where that workflow carries the required check, that the failure blocks every
  open pull request. The issue is assigned to the repository owner, whose account already owns the
  repository publicly. What an observer needs: nothing, an issue list is readable by anybody. What it
  does not say: the finding, its severity and the code it concerns stay in the run's retained
  evidence. On a public repository that evidence is not privileged — any GitHub account can read the
  run and download its artefacts, not only somebody with access to this repository — and of the four
  files the assessment retains, only `protected-evidence.cms` is encrypted to a recipient
  certificate; the manifest and the summary are uploaded in the clear. The issue says a gate is red, not why. Part of this was
  already true, because the required build's `security` job is visible on every pull request; what
  changed is that a scheduled security run now says so on its own rather than only to whoever opens
  the Actions tab. It stays open because the alternative is the defect the tracker exists to
  remove — a red gate nobody is told about. What bounds it: the window is the time between the
  scheduled run and the fix, and a reader of the issue learns that a gate failed, which the run
  history already showed them. *Built, as described.*
- **Accepted: a reduced pull-request build carries no evidence that it was enough.** A pull request
  runs only the quality jobs its changed paths select. Which paths select which jobs is decided by
  two closed inventories and a classifier that answers `full` for anything it does not recognise, for
  a rename or a deletion, and for its own failure. What used to sit beside that was a measurement:
  every run recorded whether a job outside the reduced selection had failed, and a reduced selection
  was permitted only after twenty first attempts had produced no such miss. That measurement is gone,
  because it was observable only while every run executed everything, so keeping it meant paying for
  the full set in order to prove the reduced one — and requalifying after any policy change, which
  at this repository's rate of change was unreachable rather than strict. What an observer needs:
  nothing; the selection is visible in every run's summary. What it means: if a mapping is wrong, no
  pull-request gate says so. What bounds it: pushes to `main` and every scheduled run execute all
  five jobs unconditionally and are required to pass, so a wrong mapping surfaces on `main` rather
  than never; the inventories are closed, so an unlisted file selects `full`; the manifests and the
  classifier are themselves classified `full` and carry their own tests; and the repository variable
  `COURTSIDE_TEST_PROFILES` forces the complete set for every pull request, with any value other
  than `admitted` or none escalating rather than reducing. It stays open because the alternative is
  a permanent shadow campaign whose cost is the full build it exists to avoid. *Built, as described.*

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
  Being recorded now reaches the member as a message, and it names the booking rather than the
  booker — the same nothing the list resolves. **Built.**
- **The objection has no time limit and no card exception.** It reaches a booking that has already
  happened as readily as one still ahead — a member usually learns of the record after the fact, so
  the past is the case it exists for. It reaches whatever card recorded them, though as shipped only
  the member booking card records anybody: `allowed_player_counts` is empty for training, league
  match and court closure, so those carry no roster to leave. A club that gives a managed card
  player counts gets the objection there too. Whoever made the booking is told that somebody left
  it, by the name they entered themselves; a managing role who did not make it learns of the
  withdrawal by reading the appointment detail, as before. **Built.**
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

A member draws a period by dragging across adjacent free cells of one court, and the dialog opens on
the period drawn rather than on a single slot. The highlight follows the pointer only as far as the
court can give: a run stops at the first occupied or past cell instead of being clamped without
notice when the pointer is released. Only a mouse draws: a finger and a stylus keep scrolling the
plan and select nothing, so there the duration control in the dialog is the route to the same
period.

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
  credential. An id another system assigned is not among the ids it holds: the member number an
  import links by is recorded as the source it was linked against, because erasing the person here
  would not reach the system that number still names. The event publication registry beside it
  holds an event only until its consumers finish: a completed publication is deleted rather than
  retained, so nothing accumulates there for a job to clean up later.
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
  than executed against one that is no longer there. **Built.**
- **An import outlives whoever ran it.** A run and the preview it came from record the account that
  took the action, and neither carries a foreign key to it — the same arrangement `domain_event`
  uses and for the same reason. Removing the account no longer has to take the record with it, which
  is what cascading would have done: what an audit of the roster needs is that an import happened,
  when, and with which counts, and none of that is personal data about the person who pressed the
  button. The id beside it stops naming anybody on the same terms as the log above — when the
  *person* goes, not when the account does, because the log itself still holds the pair. This says
  nothing about the rest of a preview: its change set is a club's membership list and is bounded by
  the retention in the point above, not by this one. **Built.**
- **Describing a source uploads nothing at all.** The column mapping and the category values a
  board picks from are read out of the club's file in the browser; no request carries it, and the
  instance learns the headers only as the mapping the board saved. This is a stronger promise than
  the one above and a separate one: the snapshot a club later uploads *is* sent, and is then bound
  by the retention. Configuring the source that receives it is not. **Built.**
- **A message record goes when the account it explains goes.** `message_record` holds no address,
  no name and no body — an account id, a kind, a state, a `Message-ID`, two instants, the order it
  was written in, and, where a handover failed, the kinds of failure the mail library reported and
  the SMTP status code, neither of which carries the relay's own words about an address — and it is
  removed with the account by `ON DELETE CASCADE`. There is no second retention setting for it: a
  row that outlived the account would explain a message to nobody, and one that vanished earlier
  would leave the club unable to answer why a member never heard from the instance. **Built.**
- **Subject access and portability** (Art. 15/20), answered by the board from the person's
  page. `POST /api/admin/export/person/{personId}` produces, as one JSON file, the person and
  their address, every account they hold with its roles and its state, the membership and the
  period it ran, the bookings they made and the bookings somebody else recorded them in, the
  recurring bookings they set up, what became of every message this instance addressed to them
  and which kinds they asked not to receive, the member numbers an import linked them by, and the
  change log from both sides — what was done to them, and what they did. The club is the
  controller and a request may arrive by letter, so the board is who produces the answer; people
  exist in the roster without an account, and self-service would leave them with no way to ask.

  **The answer is produced whole.** No section of it is paged or capped, because a subject access
  answer that stops at a hundred entries is not one — a board member who has administered the club
  for years is the actor of every configuration change it ever recorded, and all of them are
  theirs. The cost is a single response held in memory, bounded by one club's own history and
  reachable only by an administrator asking about one person.

  **It answers about one person and nobody else, and the shapes carry that rather than a
  condition.** A booking they made lists its courts and its times and has no field for the people
  they played with; a booking they were recorded in has none for who made it or what that person
  wrote on it; a change they made names the operation and the moment and has none for the record
  it touched. There is no list form and no bulk form, so the operation cannot become a way to read
  the roster.

  Answering is itself a processing activity: it writes `dataexchange.subjectAccess.answered` to
  the change log, naming the person and nothing that was in the answer. **Built.**
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
