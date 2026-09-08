# The data model

What Courtside stores, table by table, and how the tables relate. This is the map; `docs/design.md`
is the argument. Where a shape has a reason that took a paragraph to decide, this document names the
reason in a clause and the design specification carries the rest.

The schema is PostgreSQL 17 and is applied by Flyway from `src/main/resources/db/migration`. Those
files are a history — the shape below is what you get after all of them have run, which is not the
shape any single one of them declares.

## The one idea the schema is built around

**Everything that occupies a court is a booking.** A member's game, a training block, a league match
and a court closure are the same row in the same table, differing by one foreign key.

```
booking_card ──< booking ──< court_allocation >── court
                    └──< booking_participant ──> person | participant_card | a guest name
```

| Table | Holds |
|---|---|
| `booking` | One occupancy: the card that classifies it, its status, who booked it, when it was created, cancelled, moved or reminded about |
| `booking_card` | What kind of occupancy this is — its label, its colour, how many players it tracks, whether it counts against a member's limits, whether guests are allowed |
| `court_allocation` | One row per court the booking occupies, with its own start, end and status |
| `booking_participant` | One row per player slot |

A booking holds exactly one card and one `court_allocation` row per court it takes. Nothing in the
schema insists it takes any: a booking series gets a trigger for that, a booking does not, and the
API's own contract is what refuses an empty list of courts. A club that wants a new kind of
occupancy — a tournament, a school session — inserts a `booking_card` row; it does not deploy
anything.

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
to book a taken court arrives at the application as a constraint violation to translate — never as
a check the application ran first.

## The facility

| Table | Holds | References |
|---|---|---|
| `court` | A court: its number, an optional name, whether it is active | — |
| `opening_hours` | When the facility opens and closes, one row per weekday | — |

`court.number` is unique and positive, and `active` is what takes a court out of service without
losing it. `opening_hours` carries one row per `day_of_week`, numbered the way `java.time.DayOfWeek`
numbers them — 1 is Monday — with `closes_at` after `opens_at`.

## Cards

| Table | Holds | References |
|---|---|---|
| `booking_card` | A kind of occupancy | — |
| `booking_card_allowed_role` | Which roles may create a booking on this card | `booking_card` |
| `booking_card_managing_role` | Which roles may manage somebody else's booking on this card | `booking_card` |
| `participant_card` | Something that fills a player slot without being a person | — |

The two card tables answer different questions — `booking_card` asks what kind of occupancy this
is, `participant_card` asks what fills a slot — and conflating them is what makes the participant
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

## People, memberships and accounts

| Table | Holds | References |
|---|---|---|
| `person` | A human being: name and email | — |
| `member` | A membership: its type and the dates it ran | `person`, `membership_type` |
| `membership_type` | A kind of membership, the rule set it is measured against, and whether it opens an account on import | `rule_set` |
| `user_account` | Credentials and sign-in state for a person | `person` |
| `user_account_role` | One row per role the account holds | `user_account` |

**`person` and `user_account` are separate** because not every person has an account — a child, a
name that arrived through a roster import. `user_account.username` is unique; `person.email` is not.

**`user_account.password_hash` is nullable.** It is null until the instance has issued a credential,
and the sign-in path answers such a row exactly as it answers a wrong password.

**`member` is one dated row per person.** `started_on` is required, `ended_on` marks a membership
that ended, and the row survives so a club can still see who held what and until when. Neither date
may lie in the future: nothing compares them with today, so a future date would be a fact no reader
honours.

`security_epoch` invalidates every session an account holds; `version` is the optimistic lock;
`credentials_expire_at` bounds an issued one-time credential.

## Rules

| Table | Holds | References |
|---|---|---|
| `rule_set` | A named set of booking rules | — |
| `rule_definition` | One rule: its type and its parameters as `jsonb` | `rule_set` |

Rules are data. A rule type is a validator class plus a row rather than a column, and the parameters
live in `params` so a new rule kind needs no migration. A rule set holds each type at most once.

Which rule set applies to a booking comes from the booker's `membership_type`, or — for a person
holding none — from `club_config.no_membership_type_rule_set_id`.

## The club's own configuration

`club_config` is a single row, pinned by `club_config_single_row` to one fixed id. It carries what a
board can change without a deployment: the club name, the two brand colours, an uploaded logo, the
imprint and privacy links, the default locale, the time zone, the booking slot length, how long
issued credentials stay valid, and how many hours before a booking the reminder goes out.

The time zone is checked against `pg_timezone_names` by a trigger, so a typo is refused where it is
written rather than at the next reminder. The logo is stored in the row itself — content, media type
and digest together or not at all, at most one megabyte, PNG or JPEG.

## Importing a roster

| Table | Holds | References |
|---|---|---|
| `import_source` | A described file format: separator, encoding, default membership type, the removal threshold that triggers a warning | `membership_type` |
| `import_column_mapping` | Which column header carries which canonical field | `import_source` |
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
| `domain_event` | The change log: event type, the entity it concerns, the account that caused it, when, and the payload | — |
| `message_record` | One row per message the instance tried to deliver, and what became of it | `user_account` |
| `message_optout` | A message kind an account has declined | `user_account` |
| `event_publication` | Spring Modulith's transactional outbox for events between modules | — |

`domain_event.subject_id` is `NOT NULL`, so every entry names something. An operation that concerns
no single entity — a bulk export, for instance — therefore records nothing, which
`docs/design.md` section 11 carries as an accepted risk rather than a gap.

`message_record.kind` and `message_optout.kind` are governed by CHECK constraints that have grown
with the product; read the constraint rather than a list here. A message somebody declined leaves no
row at all: it did not fail, it was not sent.

`event_publication` is not domain data. Spring Modulith writes it so an event survives a listener
that was not running, and Courtside neither reads nor migrates it by hand.

## State that is not domain data

| Table | Holds |
|---|---|
| `login_attempt_limit` | Failed sign-in counts per scope and hashed subject, and how long that subject stays blocked |
| `credential_issue_limit` | How often a credential was issued for an account inside the current window |
| `spring_session` | Server-side sign-in sessions, including creation, last access, expiry and the associated principal |
| `spring_session_attributes` | The serialized attributes belonging to a server-side session |

Both are rate-limit bookkeeping and both are expired by their `window_started_at`. They are keyed
differently on purpose: a sign-in attempt is counted against a *hash* of its subject, because the
subject is an address somebody typed, while a credential is issued for an `account_id` that is
already in the database. Nothing outside the mechanism they protect reads either table.

Spring Session manages `spring_session` and `spring_session_attributes`; Courtside migrates their
schema so the bounded runtime identity never needs DDL authority. Removing a session cascades to its
attributes, and the configured cleanup schedule removes expired rows.

## What a fresh instance holds

A database that has just been migrated is not empty. Flyway seeds a facility a club can start from:

- one `court`, number 1, and opening hours of 08:00–22:00 on all seven days
- four booking cards: **Member booking** (two or four players, guests allowed, counts against
  limits), **Training**, **League match** and **Court closed**
- two participant cards: **Ball machine**, which fills one slot, and **Looking for a partner**,
  which fills one without capacity
- two rule sets, **Standard** and **Youth**, each with an advance window and a limit on open
  bookings, and two membership types — **Active** and a youth one — pointing at them
- one `club_config` row named Courtside, in German, in `Europe/Berlin`

What it does not seed is an account. The first one is created at startup from the
`courtside.bootstrap-admin` configuration, which is why an instance has an administrator before
anybody has signed in — see `deploy/README.md` for the variables that carry it.

Everything else in that list is a row a board changes in the admin surface: courts, opening hours,
booking cards, participant cards, rule sets, membership types and the club configuration all have
one.

## Reading this against the code

`ModularityTests` keeps the module boundaries the tables are grouped by, and
`tools/data-model-documentation.test.mjs` keeps this document and the migrations from drifting: a
table nobody documented, a table this document invented, a constraint it cites that no longer
exists, or a seed it promises that no migration writes all fail the build.
