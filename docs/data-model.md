# The data model

This document lists the data Courtside stores and the relationships between its tables. See
`docs/design.md` for the decisions behind the schema.

Courtside uses PostgreSQL 18. Flyway applies the migrations in
`src/main/resources/db/migration`. The diagrams below show the schema after all migrations have
run, not the state created by an individual migration.

## Core model

**Everything that occupies a court is a booking.** A member's game, a training block, a league match
and a court closure are the same row in the same table, differing by one foreign key.

```
booking_card ──< booking ──< court_allocation >── court
                    └──< booking_participant ──> person | participant_card | a guest name
```

| Table | Holds |
|---|---|
| `booking` | One occupancy: the card that classifies it, its status, who booked it, when it was created, cancelled, moved or reminded about |
| `booking_card` | What kind of occupancy this is, its label, its colour, how many players it tracks, whether it counts against a member's limits, whether guests are allowed |
| `court_allocation` | One row per court the booking occupies, with its own start, end and status |
| `booking_participant` | One row per player slot |

A booking holds exactly one card and one `court_allocation` row per court it takes. Nothing in the
schema insists it takes any: a booking series gets a trigger for that, a booking does not, and the
API's own contract is what refuses an empty list of courts. A club that wants a new kind of
occupancy, a tournament, a school session, inserts a `booking_card` row; it does not deploy
anything.

A cancelled booking may carry a `cancellation_reason`, one of five codes chosen by whoever cancelled
somebody else's booking. It is never free text, so it names nobody. CHECK constraints accept only
the known codes and only on a cancelled booking.

**`court_allocation` is where the product's central guarantee lives.** Two confirmed allocations
can never overlap on the same court, and that is not application logic:

```sql
CONSTRAINT court_allocation_no_overlap EXCLUDE USING gist (
    court_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status <> 'CANCELLED')
```

`court_allocation_no_overlap` is a GiST exclusion constraint over a `tstzrange` expression,
half-open so that a booking ending at 19:00 and one starting at 19:00 do not collide, and filtered
so a cancelled allocation frees its slot. Concurrency is the database's problem, and every attempt
to book a taken court arrives at the application as a constraint violation to translate, never as
a check the application ran first.

## The facility

| Table | Holds | References |
|---|---|---|
| `court` | A court: its number, an optional name, whether it is active | None |
| `opening_hours_version` | One version of the weekly opening hours and the day it takes effect | None |
| `opening_hours` | When the facility opens and closes on one weekday of one version | `opening_hours_version` |
| `opening_period` | A season or holiday, its name and its first and last day | None |
| `opening_period_hours` | When the facility opens and closes on one weekday of a season or holiday | `opening_period` |
| `court_closure` | Whole days on which one court is closed, with a reason | `court` |

`court.number` is unique and positive, and `active` is what takes a court out of service without
losing it. A version's `effective_from` is a date in the club's time zone and unique; the one
version without it has governed since the beginning, and a partial unique index keeps it the only
one. A day is governed by the latest version that has started on it. `opening_hours` carries at most
one row per version and `day_of_week`, numbered the way `java.time.DayOfWeek` numbers them, 1 is
Monday, with `closes_at` after `opens_at`; a weekday without a row is closed in that version.
Deleting a version deletes its rows.

`opening_period.kind` is `SEASON` or `HOLIDAY`, and `ends_on` is not before `starts_on`, both
inclusive dates in the club's time zone. A GiST exclusion constraint keeps two periods of the same
kind from sharing a day. `opening_period_hours` has the same shape as `opening_hours`; a weekday
without a row is closed on the days the period covers, and deleting a period deletes its rows.
`court_closure` follows the same date rules, and its exclusion constraint keeps the closures of one
court apart.

## Cards

| Table | Holds | References |
|---|---|---|
| `booking_card` | A kind of occupancy | None |
| `booking_card_allowed_role` | Which roles may create a booking on this card | `booking_card` |
| `booking_card_managing_role` | Which roles may manage somebody else's booking on this card | `booking_card` |
| `participant_card` | Something that fills a player slot without being a person | None |

The two card tables answer different questions, `booking_card` asks what kind of occupancy this
is, `participant_card` asks what fills a slot, and conflating them is what makes the participant
rules unexpressible. `docs/design.md` argues that at length.

`booking_card.allowed_player_counts` is a `smallint[]`: `{2,4}` for a member card, empty for a card
that tracks no players at all, which is right for training and closures. `show_generic_occupancy`
decides whether the plan renders a neutral occupancy label or the card's own.

The role tables replaced a single `required_role` column, because a card that only one role may use
cannot express "trainers and youth directors". Both accept the roles `user_account_role` accepts.

## Player slots

`booking_participant` carries a `kind` of `MEMBER`, `GUEST` or `CARD`, and
`booking_participant_kind_matches_filler` enforces that exactly the matching column is set: a
`person_id`, a `guest_name` or a `card_id`. `position` is unique per booking, and a person may fill
at most one slot in a booking.

## Recurring appointments

| Table | Holds | References |
|---|---|---|
| `booking_series` | The recipe: start date, start time, duration, weekdays, interval in weeks, and one kind of end | `booking_card` |
| `booking_series_court` | Which courts every occurrence takes, in order | `booking_series`, `court` |

`booking_series_one_kind_of_end` allows either an end date or an occurrence count, never both and
never neither. A series with no court is refused by a deferred constraint trigger raising
`booking_series_has_a_court`, so a transaction may build the two tables in either order and still
cannot commit half a series.

The occurrences a series produces are ordinary `booking` rows. Nothing reads the recipe to decide
whether a court is free.

## Waiting for a taken court

| Table | Holds | References |
|---|---|---|
| `waitlist_entry` | One account waiting for one court and period somebody else holds: the card, note and state, when it joined, and the offer's start and deadline | `user_account`, `court`, `booking_card` |
| `waitlist_participant` | The players named on joining, one row per slot, in the shape of `booking_participant` | `waitlist_entry`, `person`, `participant_card` |

The entries for one court, start and end form that slot's queue, in the order of `joined_seq`. An
entry is `WAITING` or `OFFERED` while it is open and `BOOKED`, `LEFT`, `EXPIRED`, `SKIPPED`,
`WITHDRAWN` or `ENDED` once closed, and `waitlist_entry_open_until_closed` ties `closed_at` to that split.
`waitlist_entry_one_open_per_account` is a GiST exclusion over open rows: an account holds at most
one open entry for a court at any moment, so it cannot stack offer windows with overlapping times. An offer has a deadline no later than the slot's start, and
`waitlist_entry_one_offer` is a GiST exclusion over `OFFERED` rows of the same form as
`court_allocation_no_overlap`, so no two offers ever hold the same court at the same time.

An offered entry reserves its court without a `court_allocation` row. The booking write refuses the
court to every other account while the offer stands, under the same lock that serialises booking
writes, cancellations and the waitlist sweep. `booking_id` names the booking an accepted offer or the
member's own booking of the slot became; it carries no foreign key, because `court_allocation` and
`booking_participant` stay the only rows a removed booking takes with it. The sweep deletes every entry whose slot has ended, and an
account's entries go with the account.

## Offering an open place

| Table | Holds | References |
|---|---|---|
| `partner_invitation` | A booking holder's offer of the place its "looking for a partner" card holds, and when it was offered | `booking`, `booking_participant` |

`partner_invitation_one_per_booking` keeps a booking to one offer. The row names no person: the holder
is the booking's `booked_by`, and the place is the participant row it points at. Taking the place
rewrites that `booking_participant` row from the card into the member and deletes the offer;
withdrawing it deletes the offer too. Like `waitlist_entry.booking_id`, neither reference carries a
foreign key, so `court_allocation` and `booking_participant` stay the only rows a removed booking
takes with it. Every read joins the booking, and a sweep deletes offers whose booking is gone,
cancelled or started, or whose place no longer holds the card.

## Who turned up

| Table | Holds | References |
|---|---|---|
| `attendance_policy` | The one row saying whether the club records attendance and after how many minutes an unattended member booking is released | None |
| `booking_attendance` | What was recorded for one started booking, `ATTENDED` or `NO_SHOW`, who recorded it and when, and when a no-show was lifted | `user_account` |
| `booking_release` | When the release sweep cancelled a booking because nobody had checked in | None |
| `booking_rule_rejection` | One row per rule a refused booking, series or cancellation attempt broke: the rule code, the club-local hour it happened in and the card asked for | None |

A booking without a `booking_attendance` row has nothing recorded and is never a no-show. A member's
check-in and a board's record write the same row, and a board's later record replaces it. Lifting a
no-show sets `lifted_at` and keeps the row, so the no-show stays visible but stops counting towards
`NO_SHOW_LIMIT`, which counts the unlifted no-shows of the bookings an account holds. Like
`waitlist_entry.booking_id`, neither `booking_id` carries a foreign key, so `court_allocation` and
`booking_participant` stay the only rows a removed booking takes with it.
`attendance_policy_release_needs_attendance` refuses a release time while attendance is off.

`booking_rule_rejection` feeds the usage report and names nobody: no person, no account and no
booking. `attempt_id` groups the rules one attempt broke, so the report counts attempts as well as
rules. A refused attempt writes it in a transaction of its own, because the attempt itself rolls back.
`rejected_at` holds only the start of the club-local hour, so a row cannot be matched to a request
in a log by its time, and a day the report counts still starts at club-local midnight.
A refused single booking, booking series and cancellation each write it. Nothing deletes its rows
yet; how long a club keeps them belongs to the retention controls by record category.

## People, memberships and accounts

| Table | Holds | References |
|---|---|---|
| `person` | A human being: name and email | None |
| `member` | A membership: its type and the dates it ran | `person`, `membership_type` |
| `membership_type` | A kind of membership, the rule set it is measured against, and whether it opens an account on import | `rule_set` |
| `user_account` | Credentials and sign-in state for a person | `person` |
| `user_account_role` | One row per role the account holds | `user_account` |
| `password_reset_token` | The one outstanding reset code an account has: its hash, the address it was mailed to, the epoch it was issued under and when it expires | `user_account` |

**`person` and `user_account` are separate** because not every person has an account, a child, a
name that arrived through a roster import. `user_account.username` is unique; `person.email` is not.

**`user_account.password_hash` is nullable.** It is null until the instance has issued a credential,
and the sign-in path answers such a row exactly as it answers a wrong password.

**`member` is one dated row per person.** `started_on` is required, `ended_on` marks a membership
that ended, and the row survives so a club can still see who held what and until when. Neither date
may lie in the future: nothing compares them with today, so a future date would be a fact no reader
honours.

`security_epoch` invalidates every session an account holds; `version` is the optimistic lock;
`credentials_expire_at` bounds an issued one-time credential. `last_login_at` is the instant of the
account's latest successful sign-in and stays null until the first one. A sign-in overwrites it
without touching `version`, and a failed or refused attempt leaves it as it was. A sign-in while
another change holds the account row does not wait for it and leaves the time unrecorded.

**`password_reset_token` holds at most one row per account**, because `account_id` is its primary
key. Asking again replaces the code that was outstanding, the delete and the insert are what do
that, under an advisory lock on the account so two requests arriving together cannot mail a code
that was never stored. Neither the code nor the address is
stored, only their SHA-256. The row also carries the account's `security_epoch` and the fingerprint
of the address the code went to, and redemption compares both against the account as it is then, so
a board-issued credential, a self-service password change, a deactivation or an address correction
withdraws an outstanding code without anything having to listen for those events.

## Rules

| Table | Holds | References |
|---|---|---|
| `rule_set` | A named set of booking rules | None |
| `rule_definition` | One rule: its type and its parameters as `jsonb` | `rule_set` |

Rules are data. A rule type is a validator class plus a row rather than a column, and the parameters
live in `params` so a new rule kind needs no new column. The `rule_definition_rule_type_known` CHECK
names every type, so a new type extends it in a migration of its own. A time-of-day parameter such
as the `BOOKING_HOURS` window holds minutes after midnight. A rule set holds each type at most once.

Which rule set applies to a booking comes from the booker's `membership_type`, or, for a person
holding none, from `club_config.no_membership_type_rule_set_id`.

## The club's own configuration

`club_config` is a single row, pinned by `club_config_single_row` to one fixed id. It carries what a
board can change without a deployment: the club name and the short name shown under an installed
app's icon, the two brand colours, an uploaded logo, the imprint, privacy and documentation links,
the default locale, the time zone, the booking slot length,
how long issued credentials stay valid, how many minutes a mailed reset code stays redeemable,
how many hours before a booking the reminder goes out, and how many minutes a freed court stays
reserved for the member whose turn it is on its waitlist, 1 to 1440 and 15 by default.

The time zone is checked against `pg_timezone_names` by a trigger, so a typo is refused where it is
written rather than at the next reminder. The logo is stored in the row itself, content, media type
and digest together or not at all, at most one megabyte, PNG or JPEG. The short name is optional;
`club_config_short_name_fits_an_icon_label` keeps a stored one between one and twelve characters and
not blank.

`message_template_override` holds a club's own wording of a message: one row per message kind and
language, with a subject and a body. No row means the shipped wording applies, and a reset deletes
the row. CHECK constraints accept only `de` and `en`, keep the subject on one line between 1 and 200
characters and the body between 1 and 10,000. The row stores placeholders such as `{username}`, never
filled text. Which placeholders a wording may use is checked by the application when it is saved and
again when a message is composed, so a row that no longer passes falls back to the shipped wording.

## Importing a roster

| Table | Holds | References |
|---|---|---|
| `import_source` | A described file format: separator, encoding, whether columns are found by header or by position and, by position, how many a file has, default membership type, the removal threshold that triggers a warning | `membership_type` |
| `import_column_mapping` | Which column header carries which canonical field, for a source read by header | `import_source` |
| `import_column_position` | Which numbered column carries which canonical field, for a source read by position | `import_source` |
| `import_type_mapping` | Which value in the file means which membership type | `import_source`, `membership_type` |
| `import_owned_field` | Which fields the file owns, and may therefore overwrite | `import_source` |
| `import_external_reference` | The link between a number in the file and a person here | `import_source`, `person` |
| `import_preview` | What a file would change, with the hash of the file it was taken from | `import_source` |
| `import_run` | What a preview actually did, counted by kind of change | `import_source`, `import_preview` |

A run points at the preview it executed and `import_run_one_per_preview` allows only one, so a
preview a board has read cannot be applied twice. Both carry the file hash, so a run that executed
a different file than the one previewed is visible after the fact.

## What the instance records

| Table | Holds | References |
|---|---|---|
| `domain_event` | The change log: event type, the entity it concerns, the account that caused it, when, and the payload | None |
| `message_record` | The mail outbox: one row per message the instance is to deliver, and what became of it | `user_account` |
| `message_optout` | A message kind an account has declined, on every channel | `user_account` |
| `message_channel_optout` | A channel an account receives no messages on besides the notification centre | `user_account` |
| `notification` | The notification centre: one row per message addressed to an account, and when the account read it | `user_account` |
| `event_publication` | Spring Modulith's transactional outbox for events between modules | None |

`domain_event.subject_id` names the entity an entry concerns. It is empty only for an activity about
the whole instance, `dataexchange.log.exported`, which records an export of the audit log or the
message log; `domain_event_subject_required` refuses an empty subject for every other event type.

`domain_event.event_type` is a dotted name whose first segment says which module published it, and
the table holds two kinds of entry. Seven segments are the administrative surfaces, one per thing a
board configures: `facility.court.added`, `card.bookingCard.changed`, `config.club.changed`,
`rules.ruleSet.changed`, `roster.person.corrected`, `dataexchange.source.described` and
`notification.template.changed`, each with siblings. A message wording has no row id of its own, so
its entries name a subject derived from the message kind and language. The other two arrive in the course of ordinary use, because the writer records every
event a module publishes rather than a list it keeps: `booking.booking.confirmed` and the nine
other booking entries, and `identity.account.credentialsRequested`, which names the account a
credential was issued for and says in `accountCreated` whether the account was opened by the same
request. A board's request is written beside
`roster.account.credentialsRequested`, which names the person, because the roster reaches
`AccountCredentials` and publishes its own event as well. A member who asked for the credential
themselves produces the `identity.` entry alone, so the pair says which of the two happened. Read the first segment as the publisher and not as a table, the `roster.`
entries come from `member`.

`message_record.kind` and `message_optout.kind` are governed by CHECK constraints that have grown
with the product; read the constraint rather than a list here. A message somebody declined leaves no
row at all: it did not fail, it was not sent.

A `QUEUED` row is a message waiting in the outbox. An account's first password is not claimed while
an earlier welcome for that account is still `QUEUED`. Its `parameters` hold what the message is written
from: a booking id, a waitlist entry id, a series id, the comma-separated ids of the series occurrences a change touched,
a closure kind, a cancellation reason code, the previous start and end of moved occurrences or the
person who withdrew. They never hold rendered text, an address or a credential: a message is
composed from the current rows when it is handed over, and a generated credential or reset code
exists only in that transaction. `next_attempt_at` says when the row is next due, `attempts` counts
the claims made for it and `retries` the failed handovers that were scheduled again. On a `QUEUED`
row, `reason` names the last failed attempt; on a settled row it names why the message failed or was
refused. Settling a row clears both `parameters` and `next_attempt_at`, and CHECK constraints refuse
a settled row that keeps either, and `parameters` that are anything but an object of strings.

A `notification` row is written with the outbox row in the same transaction, and also when no mail
is queued because the account has no address or switched email off. Its `parameters` keep only the
booking id, the waitlist entry id, the closure kind and the cancellation reason code; the person who withdrew, the series
id, the occurrence ids and the previous times stay in the outbox. `read_at` is empty until
the account marks the entry read, and a partial index over each account's unread entries serves the
unread count. `notification.kind` follows the same CHECK as `message_record.kind`, and
`message_channel_optout.channel` accepts `EMAIL`. No row in `message_channel_optout` means the
channel is on, which is how every account received mail before the choice existed.
A subject-access answer lists each entry with its kind, both times and the booking id, waitlist entry
id, closure kind and cancellation reason it stored, whether or not that booking or entry still exists.

`event_publication` is not domain data. Spring Modulith writes it so an event survives a listener
that was not running, and Courtside neither reads nor migrates it by hand.

## State that is not domain data

| Table | Holds |
|---|---|
| `login_attempt_limit` | Sign-in failures and accepted recovery requests counted per scope and hashed subject, and how long that subject stays blocked |
| `credential_issue_limit` | How often a credential was issued for an account inside the current window |
| `password_reset_mail_limit` | How many reset codes were mailed to an account inside the current window |
| `spring_session` | Server-side sign-in sessions, including creation, last access, expiry and the associated principal |
| `spring_session_attributes` | The serialized attributes belonging to a server-side session |

The first three are rate-limit bookkeeping and all three are expired by their `window_started_at`.
They are keyed differently on purpose: a sign-in attempt is counted against a *hash* of its subject,
because the subject is an address somebody typed, while a credential or a reset code is for an
`account_id` that is already in the database. The two account-keyed budgets are separate so that
anonymous asking cannot spend what a board needs to answer with. Nothing outside the mechanism they
protect reads any of these tables.

Spring Session manages `spring_session` and `spring_session_attributes`; Courtside migrates their
schema so the bounded runtime identity never needs DDL authority. Removing a session cascades to its
attributes, and the configured cleanup schedule removes expired rows.

## What a fresh instance holds

A database that has just been migrated is not empty. Flyway seeds a facility a club can start from:

- one `court`, number 1, and one opening-hours version since the beginning with 08:00 to 22:00 on
  all seven days
- four booking cards: **Member booking** (two or four players, guests allowed, counts against
  limits), **Training**, **League match** and **Court closed**
- two participant cards: **Ball machine**, which fills one slot, and **Looking for a partner**,
  which fills one without capacity
- two rule sets, **Standard** and **Youth**, each with an advance window and a limit on open
  bookings, and two membership types, **Active** and a youth one, pointing at them
- one `club_config` row named Courtside, in German, in `Europe/Berlin`

Those names are not what a club reads. The migrations seed them in English, and at startup each
module names its own seeded rows in the language `club_config.default_locale` holds. A fresh
instance uses German, so the four cards read *Mitgliederbuchung*, *Training*, *Punktspiel* and *Platz
gesperrt*. A row is recognised by the id it was seeded with, and renamed only while it still carries
one of the names this image ships for it and the new name is free. A board that gives a row a name
of its own keeps it, and so does whatever already holds the name the row would take. Changing the
language changes the rows that are still shipped-named, without a restart.

What it does not seed is an account. The first one is created at startup from the
`courtside.bootstrap-admin` configuration, which is why an instance has an administrator before
anybody has signed in, see `deploy/README.md` for the variables that carry it.

Everything else in that list is a row a board changes in the admin surface: courts, opening hours,
booking cards, participant cards, rule sets, membership types and the club configuration all have
one.

## What each column is, in protection terms

This document says what a table holds and why. What each *column* counts as under data protection,
one of `personal`, `pseudonymous`, `secret` or `operational`, and which mechanism ends its life is
in [`security/data-protection-inventory.json`](../security/data-protection-inventory.json), one
entry per column, beside the same classification for every URL parameter the API declares.

It is there and not here because a prose table would be a second copy of the schema, maintained by
hand, and this repository has watched that kind of copy rot. `DataProtectionInventoryTest` reads
`information_schema.columns` after Flyway has run and requires an entry for every column it finds,
so a migration that adds a column fails the build until somebody says what the column is. The
lifecycle each entry names is the mechanism the data-protection section of `docs/design.md`
describes, not a separate promise.

## Reading this against the code

`ModularityTests` keeps the module boundaries the tables are grouped by, and
`tools/data-model-documentation.test.mjs` keeps this document and the migrations from drifting: a
table nobody documented, a table this document invented, a constraint it cites that no longer
exists, or a seed it promises that no migration writes all fail the build.
