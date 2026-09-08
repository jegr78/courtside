# Contributing to Courtside

Courtside is a court booking system that each club runs as its own single-tenant instance. It is
AGPL-3.0, so every club that uses it may read, change and redistribute it, and pull requests from
outside are welcome on that basis.

Courtside is developed with AI assistance. [`CLAUDE.md`](CLAUDE.md) is the ruleset that work
happens under, and it is written for a contributor of either kind: architecture principles, the
migration policy, test discipline, naming, and the rules a review will hold a change to. Read it
before the first edit. This file is the doorway, not a second copy of it.

Everything inside the repository is English: code, identifiers, comments, commit messages, and the
documentation under `docs/`. The two exceptions are the product's own texts, which live in i18n
message bundles with German as the default locale, and the documentation site in `site/`, which
serves German and English side by side. Issues and pull requests are English as well, so that the
next club to fork this can follow them.

## Before you write anything

- The [wiki](https://github.com/jegr78/courtside/wiki) is the introduction: how the
  application is put together, what the modules are, and the handful of decisions that
  explain most of the code. It orients you before the specification becomes readable.
- [`README.md`](README.md) gets the application running and creates the first administrator.
- [`docs/design.md`](docs/design.md) is the design specification: what the product is, why the
  architecture is shaped the way it is, and what section 10 promises a club board about the
  credentials it hands over.
- [`docs/data-model.md`](docs/data-model.md) says what the schema holds, table by table.
- [`docs/local-environments.md`](docs/local-environments.md) covers the CLI commands, database
  access, certificates and the persistent acceptance environment.

## Finding something to work on

The [project board](https://github.com/users/jegr78/projects/2) is the overview: every open issue
that is work sits in `Todo`, `In Progress` or `Done`. Nothing in `Todo` is assigned in advance,
so say on the issue that you are taking it before the branch exists.

Not every tracker entry is work. [`.github/ISSUE_TEMPLATE`](.github/ISSUE_TEMPLATE) carries the
kinds: a `bug` behaves differently from what the documentation or the UI promises, `debt` is a
shortcoming with no decision behind it, an `operations` entry binds whoever deploys an instance,
and `decision` and `known-limit` are closed records of choices already made. Read the closed
`decision` and `known-limit` issues before proposing a change of direction; the reasoning is
usually already written down.

For anything larger than a small fix, open an issue first and let the shape be agreed there. A
pull request is an expensive place to discover that the disagreement was about the design.

## Setting up

JDK 25 (Eclipse Temurin), Node.js 24 or later, and Docker, which Testcontainers needs for
PostgreSQL 17. Point Maven at the right JDK and start the development stack:

```bash
export JAVA_HOME=/path/to/temurin-25
node tools/courtside.mjs dev
```

The application reads `build-info.properties` and `git.properties`, both written by Maven, so it
starts only after a Maven build has run.

## Making the change

- Branch off `main`, named after the change: `feat/booking-series`, not the batch of work it came
  from. `main` is protected and takes pull requests only.
- Write the test first, watch it fail, then implement. `CLAUDE.md` carries the Given-When-Then
  naming and the `// given` / `// when` / `// then` markers every test body uses; for JavaScript
  and TypeScript, `tools/test-naming-policy.test.mjs` checks the sentence form for you.
- Never mock the database in booking tests. Non-overlapping occupancy is a GiST exclusion
  constraint, and that is where it is tested.
- Never assert only a status code where a database constraint could produce the same one. Assert
  the `detail`, the `type` or the `violations` entry too.
- Write no comments. The rule is strict, `CommentBudgetTest` enforces it, and the reasoning a
  change needs belongs in the commit message and the pull request body.
- A Flyway migration is editable in place until the first published release and append-only after
  it. A new feature still gets its own new migration.
- The OpenAPI document at `src/main/resources/api/openapi.yaml` is the source of truth for the
  API. Change the document, never a generated model.
- If a sentence in `docs/design.md` becomes false, the same pull request fixes it.
- Test data uses English placeholder identities only: Jane Doe, John Roe, Example Tennis Club,
  `@example.org`. No real person, club or address goes into a tracked file, this one included.

## Verifying

During red and green, run the targeted tests: `./mvnw test -Dtest=ClassName`. Before pushing,
commit the reviewed branch and run the full gate:

```bash
JAVA_HOME=/path/to/temurin-25 node tools/courtside.mjs check
```

It classifies the change the way pull-request CI does, checks the committed head out in a separate
worktree and runs the verification that classification selects. `check --plan` shows the decision,
`check --full` escalates it. Unknown or untrusted change evidence fails closed to the full build.

CI is what decides. A local run counts insofar as it reproduces the gate, and a difference between
the two is itself a defect worth reporting.

## Commits and pull requests

- English Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Squash is the only merge method, so a branch lands as exactly one commit and the pull request
  title becomes its subject on `main`. The `PR Title Lint` workflow blocks a title that is not a
  Conventional Commit. Choose the type from what the change does to a consumer of the API rather
  than from how the diff looks, and add `!` when a published surface changes shape.
- Keep a branch small enough that one squashed commit is an honest unit of history.
- Fill in [the pull request template](.github/pull_request_template.md). Its requirements matrix
  maps each acceptance criterion to its production path, its positive test, its adversarial test
  and the runtime evidence. An unresolved row blocks review, and the quality-evidence block under
  it wants the risk identifiers from `quality/risk-register.json`, whose tables
  `docs/quality-strategy.md` renders.
- Two checks are required before a merge: `build`, and `Validate PR title`, which is the job
  that workflow runs.

## Security and conduct

A vulnerability never goes into a normal issue. [`SECURITY.md`](SECURITY.md) has the private
reporting channel, the scope, and the gaps that are already known and need no report.

[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) applies to this repository and describes how to report
behaviour that breaks it.

## The licence of what you contribute

By opening a pull request you offer your contribution under the GNU Affero General Public License
version 3, the licence the rest of the repository carries, and you confirm you have the right to
do so. There is no separate agreement to sign and no copyright assignment: the copyright in your
work stays yours. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
