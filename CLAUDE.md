# Courtside

Court booking system for sports clubs. Each club runs its own single-tenant instance.
AGPL-3.0, distributed as a container image plus a reference deployment.

---

## Language

* **Communication:** German
* **Documentation, Code, Comments, Commit Messages, Identifiers:** English
* **UI texts and email templates:** i18n message bundles, German is the default locale

## Technology Stack

* **Runtime:** Java 25 (Eclipse Temurin), Maven via `./mvnw`, Spring Boot 4.1
* **Modularity:** Spring Modulith 2.1 — module boundaries verified at build time
* **DB:** PostgreSQL 17 only. Flyway migrations. Testcontainers in tests.
* **API:** REST/JSON, **contract-first** — the OpenAPI document is the source of truth and the
  Java interfaces and models are generated from it, not the other way round. RFC 9457 Problem
  Details for errors. See issue #31.
* **Frontend:** React + Vite PWA (later milestone), consuming the same public API
* **Testing:** JUnit 5, AssertJ, Mockito, Testcontainers

## Environment

This project targets Java 25. If it is not the default JDK on the machine, point every Maven
command at it:

```bash
export JAVA_HOME=/path/to/temurin-25
```

Docker must be running for Testcontainers.

## Architectural Principles

* **PostgreSQL is not interchangeable.** Non-overlapping court occupancy is enforced by a GiST
  exclusion constraint over a `tstzrange` expression. Never move that guarantee into application
  code, and never mock the database in booking tests.
* **Everything that occupies a court is one entity.** Member booking, training, league match and
  closure differ only by their `booking_card`. A new card type is a row, not a deployment.
* **Configuration over code.** Anything a club board would plausibly want to change belongs in the
  database and the admin UI. Only infrastructure belongs in `.env`.
* **Module boundaries are declared, not implied.** Each module's `package-info.java` lists its
  `allowedDependencies`. `booking` is the core; `notification`, `reporting` and `integration` react
  to domain events instead of being called by it. Never introduce a cycle — invert with a port
  interface owned by the depended-upon module.

  A module has two zones. Its **base package** (`org.courtside.<module>`) is the API: anything
  public there may be used by any module that declares the dependency. Every **sub-package**,
  including `<module>.internal`, is implementation detail — `ModularityTests` (backed by Spring
  Modulith's `ApplicationModules.verify()`) rejects a reference to it from another module's code at
  build time. `shared` is the one exception: it is declared a shared module in
  `CourtsideApplication`'s `@Modulithic`, so every module may use its base package by design — but a
  sub-package such as `shared.web` is still internal even though `shared` itself is shared. Add a
  class to a module's base package only when another module genuinely needs it; everything else
  belongs in `<module>.internal`.
* **Keep controllers thin.** HTTP handling only. Business logic lives in services, never in
  controllers or repositories.
* **Rules are data.** Booking rules are declarative rows evaluated by `RuleEngine`, not nested
  conditionals. Evaluation collects *all* violations rather than stopping at the first.
* **Violations carry i18n keys, never rendered text.** `RuleViolation(code, params)` — the frontend
  and email templates resolve the message.
* **Flyway migrations are editable until the first release, append-only after it.** The rule exists
  to protect databases that have already applied a migration: Flyway verifies checksums and refuses
  to start when one changes underneath it. No such database exists yet — nothing is tagged, no image
  is published, and the only databases that ever see these files are Testcontainers, recreated on
  every run.

  **Before the first published release:** *corrections* are edited in place. Getting
  `V2__booking_card.sql` right beats carrying a `V8` that repairs it, and a club installing 1.0
  should find a schema that reads as one design rather than a fossil record of ours. Drop and
  recreate any long-lived local database after such an edit.

  A **new feature still gets a new migration.** The in-place rule exists so that mistakes do not
  calcify into repair migrations — not to force every future table backwards into the file that
  happens to precede it. A new table plus the column that references it belongs in its own
  `V{N}`, in the order it was designed. The distinction is: rewriting what this schema *should
  have said* is an edit; adding what it *did not yet know about* is a new file.

  **From the first published release onwards:** append only, always a new
  `V{N}__{snake_case_description}.sql`, and never touch a shipped file again. The line is the first
  image pushed to GHCR — after that, someone out there may have applied it.

  Consider squashing the history into a single `V1__baseline.sql` at the 1.0 tag.

## Development Approach

* **TDD:** Write the test first, watch it fail, then implement. Red → Green → Refactor.
* **BDD test naming (Given-When-Then):**
  * Method name: `givenContext_whenAction_thenExpectedResult()`
  * Body structured with `// given` / `// when` / `// then` comments
  * Without preconditions: `whenAction_thenResult()` is allowed
  * For exception tests: combine as `// when / then` around `assertThatThrownBy`
* **Sequence:** unit tests → implementation → integration tests → E2E.
* **Targeted runs during red/green:** `./mvnw test -Dtest=ClassName`. One full `./mvnw clean verify`
  before any commit that closes a task.
* **Never assert only a status code where the database could produce the same one.** A CHECK, a
  unique index or a foreign key answers 400 or 409 just as the application's own validation does,
  so a status-only assertion cannot tell the intended path from the constraint that happens to
  agree with it — and stays green when the intended path is deleted. Assert the `detail`, the
  `type` or the `violations` entry as well. This has been discovered three separate times in
  this codebase: inverted opening hours, a rejected URL pattern, and an unknown rule set id.

## No Comment Pollution

* **Default: no comments.** Code is self-explanatory through naming and structure.
* **Hard-banned** in all source files (Java, SQL migrations, YAML, tests):
  * Task / plan / milestone references (`// Task 4 fix:`, `// added in milestone 1`). They rot —
    git history carries this.
  * File-header blocks restating what the file does or repeating conventions.
  * `Added for X`, `used by Y`, `called from Z` cross-references — they are greppable.
  * Multi-line Javadoc on obvious getters, setters, one-line methods or self-evident classes.
  * `// for JPA`-style markers on protected no-arg constructors.
* **Allowed, and rare:** a single-line comment explaining a non-obvious **why** — a hidden
  constraint, a subtle invariant, a workaround for a specific external bug.
* **The `// given` / `// when` / `// then` markers in tests are required** and are not pollution.
* **When touching a file, remove pollution you find.** Do not preserve it for consistency.
* **Applies equally to subagents.** Every prompt that writes code must carry this rule.

## Conventions

### Naming

* **Entities:** singular PascalCase (`Court`, `Booking`, `CourtAllocation`)
* **Tables and columns:** singular snake_case (`court`, `booking_card`, `created_at`)
* **Repositories:** `{Entity}Repository` — **Services:** `{Domain}Service`
* **Controllers:** `{Entity}Controller` — **Request/response records:** `{X}Request` / `{X}Response`
* **Methods:** camelCase, verb-first. **Booleans:** `isActive()`, `isGuestAllowed()`
* **Ports:** interface named for what it does (`AccessControlPort`, `BookingCounter`)

### Lombok

* **Entities:** `@Getter` plus `@NoArgsConstructor(access = AccessLevel.PROTECTED)` for JPA.
  **No `@Setter`** — state changes go through named domain methods (`cancel()`, `deactivate()`),
  so invariants stay in the entity.
* **Services, controllers, components:** `@RequiredArgsConstructor` with `final` fields.
* **Logging:** `@Slf4j`, parameterised `{}` format. Never log names, email addresses or IBANs —
  log the `userAccountId`.
* Do not use `@Data` or `@Builder` on entities.

### Records

Use records for commands, specs, value types and web models (`CreateBookingCommand`,
`RuleViolation`, `TimeSlot`). Validate invariants in the compact constructor.

### Error Handling

* Domain failures are typed exceptions (`CourtUnavailableException`,
  `BookingRulesViolatedException`), translated to RFC 9457 `ProblemDetail` in a
  `@RestControllerAdvice`.
* **A problem `type` is a URN: `urn:courtside:error:<kebab-slug>`.** RFC 9457 wants a stable
  identifier, not a fetchable page, and an `https://` type would name a host this product does
  not own — every club runs its instance under its own domain, and a made-up domain can be
  registered by someone else. `ProblemTypeUriTest` enforces the scheme for every advice.
* Constraint violations from the database are caught and translated — never pre-checked in a way
  that pretends to prevent them.
* **Guard where the value is used, not only where it enters.** A service must not assume that
  the layer above it already validated — a caller changes, a second caller appears, and the
  assumption becomes an unhandled exception. Extra lines are the cheaper side of that trade.
  Where two fields share an invariant, prefer making the illegal state unrepresentable over
  repeating the check: a value type validating in its compact constructor (`TimeSlot`,
  `OpeningWindow`) puts the rule in one place, and the parameter's type then carries it to
  every caller.
* **Never throw a `NullPointerException`, and never let one escape.** A null that reaches a
  dereference is a missing guard, not an error report: it carries no meaning, no i18n key and no
  status, and it surfaces as a 500. Guard the value and throw something that says what is wrong.
  For the same reason `Objects.requireNonNull` is not an input check — it is a JDK assertion that
  produces exactly the exception this rule forbids.
* **`IllegalArgumentException` is not a domain exception**, and a failure a *user* can cause must
  never be reported with one. It is the JDK's catch-all: the shared advice can only turn it into
  a 400 carrying `getMessage()` verbatim, so its raw English text reaches a club board with no
  code, no parameters and nothing a frontend can translate. A user-reachable failure gets its own
  exception type with an i18n code and its own mapping — or, for a request field, Bean Validation,
  which already produces the `fieldErrors` shape.

  It stays legal in exactly one place: guarding an invariant of a value type against a
  *programming* error — `TimeSlot` refusing an end before its start. Such a throw means a caller
  has a bug, and it must not be reachable from a request. If it is, it is the wrong tool.

## Git Workflow

* **Default branch:** `main`. Feature work on `feat/<short-description>`.
* **Commits:** English Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`,
  `refactor:`). Commit frequently; push only after manual verification.
* **Test data carries English placeholder identities only** — Jane Doe, John Roe, Mary Major,
  Richard Miles, Example Tennis Club, `@example.org`. Never a real person, club or address, and
  nothing German: not in tests, seeds, plans, specs or commit messages. This is an AGPL
  repository other clubs will read and fork.
* **No real name, address or contact detail is ever written into a tracked file** — this one
  included. Author identity belongs in commit metadata, where git puts it, and nowhere else.

### Everything reaches `main` through a pull request

`main` is protected: a pull request and a green `build` check, with a bypass for the
repository-admin role. The bypass exists for a bootstrap that has already happened — do not
reach for it. A branch pushed straight to `main` skips the review the repository is now public
enough to need.

* **The pull request title is a Conventional Commit**, and it is not a formality: the repository
  sets `merge_commit_title = PR_TITLE`, so the title *becomes* the merge commit's subject in
  `main`'s history and is what release tooling reads to decide a version bump. `PR Title Lint`
  enforces the form on every pull request and blocks the merge.

  Choose the type from what the change does to a **consumer of the API**, not from how the diff
  looks. A branch that is mostly refactoring but ends up correcting a response a member sees is a
  `fix:`. Add `!` or a `BREAKING CHANGE:` footer when a published surface changes shape — the
  REST API or an environment variable, per the compatibility contract in `docs/design.md`.

* **Merge a milestone with a merge commit, never a squash.** The commit history on a milestone
  branch is the record of what went wrong and how it was found — in milestone 4, 55 of 92 commits
  were remediation. Squashing throws that away and leaves a single commit nobody can bisect.
  Small, single-purpose branches may squash.

* **A milestone branch gets a whole-branch review before its pull request is merged.** Every
  milestone so far has had its most serious findings surface there rather than in the per-task
  reviews.

## References

* Design spec: `docs/design.md`
