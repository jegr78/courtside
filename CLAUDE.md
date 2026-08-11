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

The application reads `build-info.properties` and `git.properties`, both written by Maven, so it
starts only after a Maven build has run — an IDE that compiles on its own produces a context that
fails on the missing `BuildProperties` bean.

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
* **UI test selectors are semantic and language-neutral.** Locate elements by accessible role or a
  stable ID/test ID. Never use rendered labels, translated text, placeholders, displayed values,
  titles or alt text as selectors. Text assertions remain valid only after the element has already
  been selected by role or ID. `ui-selector-policy.test.mjs` enforces this for component and E2E tests.
* **Never assert only a status code where the database could produce the same one.** A CHECK, a
  unique index or a foreign key answers 400 or 409 just as the application's own validation does,
  so a status-only assertion cannot tell the intended path from the constraint that happens to
  agree with it — and stays green when the intended path is deleted. Assert the `detail`, the
  `type` or the `violations` entry as well. This has been discovered three separate times in
  this codebase: inverted opening hours, a rejected URL pattern, and an unknown rule set id.

## No Comment Pollution

* **Default: no comments.** Code is self-explanatory through naming and structure.
* **Hard-banned** in every file this project writes — Java, tests, SQL migrations, YAML,
  GitHub workflows and `pom.xml`:
  * Task / plan / milestone references (`// Task 4 fix:`, `// added in milestone 1`). They rot —
    git history carries this.
  * File-header blocks restating what the file does or repeating conventions.
  * `Added for X`, `used by Y`, `called from Z` cross-references — they are greppable.
  * Multi-line Javadoc on obvious getters, setters, one-line methods or self-evident classes.
  * `// for JPA`-style markers on protected no-arg constructors.
  * Prose explaining a decision, a trade-off, or what the alternative would have cost. That is
    commit-message material. It reads like care while it is being written, which is exactly why
    it is the form of pollution that keeps getting through.
* **Allowed, and rare:** **one line** explaining a non-obvious **why** — a hidden constraint, a
  subtle invariant, a workaround for a specific external bug. One line, not one sentence spread
  over five. If the reason does not fit, it belongs in the commit message and the pull request
  body, which are where a reader goes to ask why and which do not rot in the file.
* **Two consecutive comment lines is the ceiling**, and the second exists only so a sentence may
  wrap. `CommentBudgetTest` enforces it across all of those file types — a rule this repository
  does not test is a rule it has already lost. A `//` or `#` separator line inside a block counts
  like any other line, so two paragraphs are two comments too many.
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

Use records for commands, specs and value types (`CreateBookingCommand`, `RuleViolation`,
`TimeSlot`). Validate invariants in the compact constructor.

Web models are the exception, and not by choice: they are generated from `src/main/resources/api/
openapi.yaml` into `org.courtside.api` as mutable POJOs with setters and a fluent builder. The
reason behind "no `@Setter`" — state changes go through named domain methods so invariants stay in
the entity — has nothing to hold onto in a transport shape that has no invariants of its own. Do
not hand-write a request or response type, and do not edit a generated one; change the document.

### The API document

`src/main/resources/api/openapi.yaml` is written by hand and is the source of truth for every
endpoint. It is language-independent: nothing is left out of it, weakened in it, or shaped by it to
suit a Java generator. Where the generator cannot produce usable Java from a keyword the document
is right to state, the answer is plugin configuration, a Jackson module, or code at the controller
edge — never a thinner document.

Controllers implement the generated interfaces and carry no mapping annotations of their own; a
route, its media types and its parameter names all come from the document.
`GeneratedApiImplementationTest` and `ApiContractCoverageTest` are what keep that true.

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

  `IllegalArgumentSurfaceTest` enforces this: it lists every file in `src/main` allowed to throw
  one, and that list holds value types only. A service, controller or entity that throws one fails
  the build by name. When a request can reach a guard, one of three answers applies — a Bean
  Validation constraint if a field can express the rule (a cross-field one reports through
  `addPropertyNode` so it arrives as a `fieldErrors` entry), a `DomainFailure` with an i18n code if
  it cannot, and `IllegalStateException` where a service guards against its own caller having
  skipped the validation that precedes it. The third says "we have a bug", not "your input is
  wrong", and a 500 is the honest answer to it.

  Removing a service's guard because the web layer now covers it is the one move to avoid: the
  guard belongs where the value is used, and the constraint belongs where it enters. Both.

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

* **Squash is the only merge method.** Merge commits and rebase merges are disabled on the
  repository, so every pull request lands as exactly one commit on `main` and the history stays
  linear. GitHub has no "default method" setting — the button follows whatever is allowed, so
  leaving merge commits enabled would have kept them the default.

  The individual commits of a branch therefore do not survive the merge. Their **text** does:
  `squash_merge_commit_message = COMMIT_MESSAGES` concatenates every commit message into the
  squashed commit's body, so the reasoning a branch accumulated — what went wrong, how it was
  found — is still readable in `git show`. Write commit messages as if that is where they end up,
  because it is.

* **The pull request title is a Conventional Commit**, and it is not a formality: with
  `squash_merge_commit_title = PR_TITLE` the title *becomes* the squashed commit's subject in
  `main`'s history and is what release tooling reads to decide a version bump. `PR Title Lint`
  enforces the form on every pull request and blocks the merge.

  The title source is deliberately `PR_TITLE` and not GitHub's default `COMMIT_OR_PR_TITLE`: that
  default takes the *commit's* subject whenever a pull request holds exactly one commit, which
  would let a single-commit branch land a subject the lint never saw.

  Choose the type from what the change does to a **consumer of the API**, not from how the diff
  looks. A branch that is mostly refactoring but ends up correcting a response a member sees is a
  `fix:`. Add `!` or a `BREAKING CHANGE:` footer when a published surface changes shape — the
  REST API or an environment variable, per the compatibility contract in `docs/design.md`.

* **A branch is small enough that one squashed commit is an honest unit.** Since a branch now
  collapses into a single commit, one that grew to ninety commits would leave `main` with a node
  nobody can bisect. Cut the work so that each pull request stands on its own and its title
  describes something a reader can act on.

  A change that cannot be cut without leaving `main` broken in between is the exception — moving
  every controller onto a generated contract is one of them, because the first half of that move
  compiles against nothing. Say so in the pull request body rather than splitting it into pieces
  that do not stand up.

* **Nothing outside this repository's own planning names a work package.** Branch names, pull
  request titles, issue titles and issue bodies describe *the change*, never the batch it belonged
  to. `feat/booking-series` and not `feat/milestone-5`; "the admin surface added an audit gap" and
  not "milestone 4 added an audit gap".

  This is the rule the no-comment-pollution section already applies to code, for the same reason:
  a number is resolvable only while someone remembers the plan it came from, and this is a public
  repository other clubs read. Naming a body of work by what it *is* — "the account-management
  work", "the deployment reference" — stays readable and is fine.

  Plans and their numbering live in `docs/superpowers/`, which is git-ignored and stays local.

* **A branch gets a whole-branch review before its pull request is merged.** Every batch of work
  so far has had its most serious findings surface there rather than in the per-task reviews.

## References

* Design spec: `docs/design.md`
