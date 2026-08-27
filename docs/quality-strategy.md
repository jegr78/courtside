# Quality strategy

Courtside qualifies changes by the product risk they control, not by test count or a global coverage percentage. This document is the maintained quality contract. Feature changes update the affected risks, evidence and residual-risk decision here; implementation details remain in tests, workflows and operational runbooks.

## Priorities and decisions

| Severity | Meaning | Release decision |
|---|---|---|
| P0 | Security breach, privilege escalation, double court occupancy, data loss, unrecoverable release or an unavailable critical journey | Stop merge and release. No exception. |
| P1 | A principal journey is wrong or unavailable, or a durable invariant can be violated without a practical recovery | Stop release. A merge exception requires a documented, time-bounded containment plan. |
| P2 | Material degradation with a safe workaround and no durable integrity or confidentiality loss | May ship only with an owner, rationale, workaround and review date. |
| P3 | Limited defect with low user impact and no effect on a protected invariant | May ship as tracked follow-up work. |

Likelihood never lowers security breaches, privilege escalation, double occupancy, data loss or unrecoverable releases below P0. An exception records the affected risk IDs, owner, expiry, compensating controls and evidence. Expired exceptions fail release qualification. In the current single-maintainer project, one maintainer may approve an exception; the absence of independent review is recorded.

## Test levels

| Level | Proves | Does not prove |
|---|---|---|
| Unit | A pure decision, value invariant or error mapping behaves across focused boundaries. | Spring wiring, PostgreSQL behaviour, HTTP serialization or a user journey. |
| PostgreSQL integration | Services, repositories, migrations, constraints, locks and transactions behave on PostgreSQL 17. | Browser behaviour, proxy boundaries or the published container. |
| Module and service integration | Spring wiring and declared Modulith boundaries preserve allowed collaboration. | The public wire contract or complete deployment topology. |
| OpenAPI contract | Implemented routes, generated models, enums and RFC 9457 shapes agree with the authored API document. | Authorization correctness for every identity or client usability. |
| React component | Rendering, state transitions, accessibility semantics and API error handling work with controlled inputs. | Real browser engines, service workers, PostgreSQL or network races. |
| End to end | A packaged application, browser and PostgreSQL complete a representative journey across real HTTP boundaries. | Every browser, production proxy configuration, upgrade or recovery path. |
| Deployment smoke | A built image starts in the reference topology and its TLS, session, persistence and isolation boundaries work. | Historical-schema upgrades, restored backups or sustained capacity. |
| Release qualification | The exact candidate artifact satisfies required functional, upgrade, restore, security and operational evidence. | The absence of unknown defects or vulnerabilities in a club-specific installation. |

Tests are placed at the lowest level that can prove the risk. Database guarantees are never replaced by mocks, and a higher-level journey complements rather than duplicates focused lower-level evidence.

## Gates and budgets

| Gate | Budget | Required evidence |
|---|---:|---|
| Local unit and contract feedback | under 2 minutes | Focused tests for the changed decision and its negative boundary. |
| Required pull-request checks | under 15 minutes | Green required checks plus the pull-request risk and evidence declaration. |
| Full merge verification | under 25 minutes | Clean `./mvnw clean verify` for task completion and diagnosable artifacts on failure. |
| Nightly qualification | under 90 minutes | Periodic browser, order, concurrency, security and bounded performance evidence assigned by risk. |
| Release qualification | under 45 minutes | Candidate-image, upgrade, restore and release-risk evidence; long soak runs are recorded separately. |

A timeout or unavailable required tool makes a gate incomplete, not successful. Budgets are reviewed when their representative workload changes; tests are not silently removed to meet a budget.

## Evidence rules

- Evidence names the commit or immutable image digest, environment, dataset and tool version needed to interpret it.
- A failure retains privacy-safe diagnostics. Credentials, names, email addresses and request secrets are never evidence.
- A database-reachable error assertion identifies the intended problem type, detail or violation, not only its status.
- A changed feature updates every affected risk ID or states why no maintained risk changes.
- A risk accepted without automation appears in the gap register with an owner and review date.

### Test-effectiveness evidence

Every Maven verification produces JaCoCo line and branch reports for hand-written backend code and V8 coverage reports for frontend source. Generated OpenAPI models, generated TypeScript declarations, test support and framework output are excluded because their execution does not demonstrate a Courtside decision. Coverage remains diagnostic evidence: there is no global percentage gate, and additional assertions are justified by a risk boundary rather than by a number.

Pull requests receive a changed-line summary from `tools/coverage-diff.mjs`. `quality/critical-coverage.json` identifies decisions for rules, booking authorization and idempotency, series and time semantics, identity security, browser session state and booking interactions. An uncovered changed line in those paths requires review of the missing positive or negative boundary; it does not fail solely because it is uncovered. The full reports remain build artifacts for inspecting branch detail.

The monthly and manually runnable mutation workflow targets only rule evaluation, time and opening-window value types, and series scheduling. Its first runs establish a reviewed baseline without a mutation-score threshold. A surviving mutant is classified as an equivalent implementation, an unprotected material decision or an accepted low-value branch before package-specific targets are introduced. Spring wiring, controllers and generated transport code are outside this mutation scope.

Property tests use fixed, printed QuickTheories seeds and automatic shrinking so a failure includes a repeatable minimized counterexample. Current properties explore interval adjacency and overlap, opening-window boundaries, calendar boundaries, leap years, both DST directions and non-hour zone changes while preserving club wall time. Cursor and database idempotency retain deterministic PostgreSQL integration evidence because their invariant lives in ordering and transactions rather than a pure function. Roster parsing and full-sync properties are required now that the importer is browser-driven: generated rosters are rendered as CSV and read back across every supported separator and both a Unicode and an 8-bit encoding, and a generated file resolved against a generated roster must place each member number in exactly one change.

### Pull-request checklist

The repository pull-request template requires affected risk IDs, positive and negative evidence, residual risk and any contract change. The required build result is linked from the pull request rather than copied into this document.

### Release checklist

- [ ] Identify the candidate commit and immutable image digest.
- [ ] Confirm every required risk has current evidence at its assigned frequency.
- [ ] Confirm the exact candidate image passed deployment qualification.
- [ ] Confirm every supported database upgrade path and backup restore passed.
- [ ] Confirm security scans completed and no unaccepted P0 or P1 finding remains.
- [ ] Review open P2/P3 exceptions and automation gaps for ownership and expiry.
- [ ] Record browser, accessibility, PWA and performance evidence required for this release.
- [ ] Link the resulting workflow runs and protected artifacts from the release record.

## Risk matrices

Each row is deliberately about a material invariant rather than an individual test. Frequency values are `PR`, `nightly`, `release` or `periodic`. Ownership names a maintained area, not a person.

### Identity and security

| ID | Impact | Likelihood | Invariant | Positive boundaries | Negative boundaries | Level | Frequency | Environment | Synthetic data | Evidence | Owner | Residual risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ID-1 | P0 | Medium | Anonymous and lower-privileged callers cannot reach another role's operation or data. | Each role performs its permitted operations on owned data. | Anonymous, lower-privileged, non-owner and stale-session access is rejected. | PostgreSQL integration, OpenAPI contract, E2E | PR, release | Testcontainers, packaged app | Two accounts per relevant role and ownership class | Required build and role-journey reports | Identity | Full browser role matrix is tracked by #218. |
| ID-2 | P0 | High | Login, initial-password, CSRF, session and rate-limit controls fail closed without exposing credentials or account existence. | Valid login, password transition, CSRF token and session lifecycle succeed. | Incorrect credentials, encoded paths, missing CSRF, concurrency, restart and logout cannot bypass controls. | Unit, PostgreSQL integration, E2E, deployment smoke | PR, nightly, release | Testcontainers, reference proxy | Bootstrap admin and synthetic accounts | Required build, session journey and deployment report | Identity | Adversarial timing analysis remains assigned to #218. |
| ID-3 | P0 | Low | Secrets and personal data do not enter public responses, logs, caches or retained artifacts. | Approved public and role-scoped data remains available to its intended caller. | Success, error and diagnostic paths expose no credentials, unrelated personal data or retained secrets. | Unit, contract, static analysis, E2E, deployment and image smoke | PR, release | Packaged app and proxy | Approved placeholder identities only | Wire assertions, CodeQL, Trivy and redacted artifacts | Security and operations | Automated scanning cannot prove the absence of unknown vulnerabilities. |

### Booking

| ID | Impact | Likelihood | Invariant | Positive boundaries | Negative boundaries | Level | Frequency | Environment | Synthetic data | Evidence | Owner | Residual risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BK-1 | P0 | Medium | No two active allocations occupy the same court and time range. | Single and series allocations accept free and exactly adjacent ranges. | Overlapping ranges, retries and concurrent commits cannot create double occupancy. | PostgreSQL integration, E2E | PR, nightly | PostgreSQL 17, packaged app | Fixed courts, slots and competing accounts | Constraint and coordinated-race results | Booking | Browser-visible concurrent races remain assigned to #218. |
| BK-2 | P1 | Medium | Creation, move, cancellation and series previews apply the intended rules, authorization and calendar semantics. | Authorized changes succeed across DST directions and month or year boundaries. | Partial conflicts, inactive cards or courts, rule violations and non-owner actions are rejected completely. | Unit, PostgreSQL integration, contract, E2E | PR, release | Club time zone with PostgreSQL | Deterministic bookings and rule sets | Required build and journey traces | Booking and rules | Series preview limitations remain explicitly tracked in existing issues. |
| BK-3 | P0 | Low | Retry and failure paths create one logical operation or no partial state. | An identical idempotent retry returns the one completed operation. | Mismatched keys, timeouts, constraint failures and concurrent delivery leave no duplicate or partial state. | PostgreSQL integration, E2E | PR, nightly | PostgreSQL 17 | Stable request and operation IDs | Row-state and typed-error assertions | Booking | Cross-browser ambiguous-timeout evidence remains assigned to #218. |
| BK-4 | P1 | Medium | A member finds every booking that records them as a co-player without having made it, and can take themselves out of it, and neither operation resolves another person's name. | Listing and withdrawing work across pages, for a booking that has already happened as much as for one ahead. | Own bookings, a booking they are not recorded in and a repeated withdrawal are refused identically, and no response carries a name. | Unit, PostgreSQL integration, contract, React, E2E | PR | PostgreSQL 17, packaged app | Two members and a booking naming one of them | Row state, typed-error and wire assertions | Booking and identity | Removing oneself from a managed card's roster reaches the managing role through the appointment detail, not through a notification. |

### Membership and synchronization

| ID | Impact | Likelihood | Invariant | Positive boundaries | Negative boundaries | Level | Frequency | Environment | Synthetic data | Evidence | Owner | Residual risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MB-1 | P0 | Medium | Person, account, role and membership changes cannot cross authorization or leak another person's data. | Authorized create, update, deactivate and membership transitions persist for the intended person. | Duplicate identities and every unauthorized role or cross-person operation are rejected without disclosure. | PostgreSQL integration, contract, React, E2E | PR, release | PostgreSQL 17, packaged app | Approved placeholder roster | Required build and administration journey | Membership and identity | A membership type does not yet gate account creation or booking; that is tracked by #354. |
| MB-2 | P0 | Medium | A full synchronization creates new records, updates matched records and handles absent records without partial state or account takeover. | First and repeated imports create, match, update and deactivate by stable external reference. | Duplicate or missing references, malformed rows and conflicting usernames cannot cause partial state or account takeover. | Unit, property, PostgreSQL integration, React, E2E | PR, release | PostgreSQL 17, packaged app | NetXP-like and eBusy-like CSV fixtures with no real data | Preview, transaction and post-sync invariants, and seeded parsing and partition properties | Membership and integration | An import does not create accounts for the people it creates; that is tracked by #354. |

### Administration

| ID | Impact | Likelihood | Invariant | Positive boundaries | Negative boundaries | Level | Frequency | Environment | Synthetic data | Evidence | Owner | Residual risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AD-1 | P1 | Medium | Configuration changes validate at both HTTP and service boundaries and take effect consistently. | Valid time zones, opening windows, numbering, URLs, active states and rule references take effect. | Invalid values are rejected at the request edge and guarded again where used. | Unit, PostgreSQL integration, contract, React, E2E | PR | Testcontainers, packaged app | Example Tennis Club configuration | Typed-error and member-impact assertions | Configuration and facility | Deactivating every court remains a known limit tracked by #41. |
| AD-2 | P1 | Medium | Concurrent or failed administration writes neither lose confirmed state nor display stale success. | A confirmed write remains the final persisted and displayed state. | Double submits, out-of-order responses, constraint conflicts and refresh failures cannot claim stale success. | PostgreSQL integration, React, E2E | PR, nightly | PostgreSQL 17, browser | Deterministic conflicting updates | Final row state and UI trace | Administration | None open: optimistic locking refuses a stale write, and a browser journey proves that a court and a role changed behind an open dialog fail closed. |

### PWA and UI

| ID | Impact | Likelihood | Invariant | Positive boundaries | Negative boundaries | Level | Frequency | Environment | Synthetic data | Evidence | Owner | Residual risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UI-1 | P1 | Medium | Core public, member and administration journeys are keyboard-operable and meet automatable WCAG 2.2 AA requirements. | German and English journeys remain operable by keyboard with correct dialog and focus behaviour. | Error states, zoom and user preferences introduce no automatable WCAG 2.2 AA violation or focus loss. | React, E2E, manual | PR, release | Browser matrix | Stable accessible fixtures | Axe, journey trace and release checklist | Frontend | Full automation and manual evidence are tracked by #216. |
| UI-2 | P0 | Low | PWA caching and browser history never serve personal API data after logout, expiry or offline transition. | Install, update, offline shell and reconnect preserve public application availability. | Logout, expiry, Back or Forward, old assets and multiple tabs cannot reveal cached personal API data. | React, E2E, deployment smoke | PR, nightly, release | Chromium, WebKit and periodic Firefox/mobile matrix | Synthetic member sessions | Browser traces, cache inspection and linked device record | Frontend and identity | Physical-device evidence remains manual because emulation cannot prove operating-system integration. |
| UI-3 | P2 | Medium | Layout, localization and interaction remain usable at supported viewports and content extremes. | Supported mobile, tablet and desktop layouts work in both themes and locales. | Long content and empty, single or many-court states do not hide or block interaction. | React, E2E | PR, periodic | Chromium plus supported matrix | Deterministic visual dataset | Semantic assertions and reviewed pixel baselines | Frontend | Broad locale, theme and viewport captures remain diagnostic; seven principal surfaces have blocking stable baselines, rendered in a pinned browser image. |

The blocking Chromium pixel suite fixes locale, theme, viewport, timezone, journey data, fonts,
animations, caret rendering, and dynamic-field masks. Each assertion captures the surface under test
rather than the whole page, so a change to one surface cannot move a neighbour's baseline: the
series-preview and booking dialogs are captured as dialogs, not as dialogs over the page behind
them. Build identity needs no mask — the footer carrying it sits outside every captured surface. It
covers the court plan, booking and validation dialogs, personal bookings, series preview, and both
administration surfaces.

**The renderer is pinned, not the host.** Every project draws its browser from the Playwright image
matching the installed Playwright version, addressed by digest, started as a browser server by the
journey service and reached over `connect`. Nothing installs a browser on the runner, so no gate
waits on distribution packages. One reviewed baseline per surface therefore holds on every machine
with Docker, `mvn verify` compares pixels wherever it runs, and a red run means a regression rather
than a different operating system. There is exactly one PNG per surface and no platform suffix.

**Browsers reach the application the way a member does.** The journey service puts the same
digest-pinned Caddy the reference deployment uses in front of the application, issuing a certificate
from its own local authority, and the browsers reach it by the name that certificate is issued for.
A secure origin is what the PWA journeys need: `navigator.serviceWorker`, `crypto.subtle` and
`crypto.randomUUID` exist only there. The proxy also serves a plain-HTTP site, and one project uses
it, so the club that serves Courtside without TLS keeps its cover, down to a booking whose
idempotency key comes from the fallback generator.

Trust is distributed where a browser will take it. The local authority goes into each browser
container's system store, which WebKit reads; Firefox keeps its own store and therefore runs on the
origin that needs no certificate. Chromium reads NSS and the image carries no `certutil`, so it is
started with the public keys this proxy serves on its exemption list. That list is a narrower test
bypass than disabling certificate validation, not a pinning primitive: Chromium matches it against
the chain a server presents, before verifying it. The distinction matters only inside this network,
where the sole reachable server is the proxy the test started.

Launch arguments are baked into the browser server, which therefore never runs in the mode that
lets a connecting client choose its own launch options, an executable path among them. That mode is
what the alternative server command would have required. Its client limit is the price: the launch
server accepts any number of connections and offers no way to cap them, so the endpoint path, an
unguessable per-run value, is the only thing standing in front of it.

A deliberate UI change updates the baselines the same way anywhere:
`npx playwright test visual-regression.spec.ts --project=visual --update-snapshots`, then
commit what changed. The suite pins `updateSnapshots: "missing"`; the values nobody may reach are
`changed` and `all`, under which a missing baseline is created and the run **passes**, so a deleted
baseline would go unnoticed. The pull request must expose the changed PNG baselines for review.
Unreviewed dimension-only screenshots remain diagnostic artifacts and never replace these
assertions.

The pull-request browser gate makes two separate product claims. Chromium runs the blocking
automated WCAG 2.2 AA rule scan, while WebKit runs blocking core compatibility journeys. WebKit
plus axe remains a qualification signal until retained first-attempt evidence supports admitting
that combination. Browser process loss, an internal engine error, a lost target or a test-level
timeout makes the harness outcome incomplete. A failed product assertion remains a product
failure. The retained browser outcome records those claims separately, and neither class can turn
the other green.

A failed test retains what an analysis needs after the run is over: which test failed, its errors as
text rather than as the colour codes Playwright writes them in, the last lines the application
logged, and the state of the browser, proxy and database containers — one JSON file per failure
under `frontend/test-results/browser-diagnostics`, uploaded with the run. The application log is
kept in memory while the run proceeds and passes the same redaction a container log does before it
is written: URLs lose their path and query, a value behind a password, token, cookie or
authorization key is replaced, and any opaque run of 24 characters or more goes. That covers what
the application itself prints, not every shape a browser harness can quote — the suite signs in with
fixtures this repository publishes, so what it types is not a secret to begin with. A run that goes
red for reasons nobody can reproduce is answered from that file, not from a rerun.

#### WebKit reliability evidence

Run `npm run reliability:webkit -- --order configured` from `frontend` for the same bounded
first-attempt sequence used by the scheduled workflow. Use `reversed` for the alternate project
order. The command runs WebKit core, installed-PWA and axe projects without a retry and writes one
immutable record below `test-results/webkit-reliability`. A diagnostic repetition gets a new
attempt identity and cannot replace the original result.

Use `npm run reliability:webkit-experiment -- --pairs 20 --order configured` for the browser
isolation comparison. Each pair runs the project-scoped and test-scoped browser lifecycle against
the same commit, image digest, project order, resource profile and planned test population. The
starting variant alternates between pairs. Every first attempt remains an immutable record. The
comparison rejects fewer than twenty pairs, unequal sample sizes or mixed conditions. Existing
records remain below `target/webkit-isolation-experiment` even when a later attempt fails. Check
them with `npm run reliability:compare -- <directory>`.

The runner verifies Docker before Playwright starts. It owns the test process tree, first requests
an orderly stop at its execution deadline and then ends the tree after a short cleanup grace period.
The hosted job reserves separate budgets for packaging, execution, validation and artifact upload,
so its outer limit cannot normally erase the bounded runner's result.

The closed record retains the commit and whether its working tree was clean, the pinned toolchain,
non-identifying host capacity, project order, browser-isolation variant, resource-profile name,
planned test-population fingerprint, browser-process identity, lifetime, test position, bounded
CPU and memory samples, exit state, duration and outcome classes. It retains
no test title, URL, log, request, cookie or credential. Raw traces and diagnostics expire after 14
days; the safe records remain available for 90 days. Validate one record with
`npm run reliability:validate -- <record>` and summarize downloaded records with
`npm run reliability:summarize -- <directory>`.

Thirty consecutive hosted successes satisfy the streak input for the later admission decision.
They do not demonstrate a failure rate below 0.5 percent: zero failures in thirty trials still
leave substantial statistical uncertainty. Admission remains governed by its separate criteria
and decision rather than being inferred by this command.

### Operations and release

| ID | Impact | Likelihood | Invariant | Positive boundaries | Negative boundaries | Level | Frequency | Environment | Synthetic data | Evidence | Owner | Residual risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OP-1 | P0 | Medium | The exact released image starts securely behind the reference proxy and preserves data across restart. | The exact image starts on an empty database and preserves data across a controlled restart. | Read-only filesystem, non-root execution, TLS, cookie and management-isolation checks cannot be bypassed. | Deployment smoke, release qualification | Release | Reference Compose topology | Production-shaped synthetic club | Image-digest qualification report | Operations and release | Exact-image qualification is tracked by #219. |
| OP-2 | P0 | Medium | Every supported upgrade preserves data and either completes atomically or fails without serving inconsistent state. | Previous patch, minor and supported skipped-version upgrades preserve data and invariants. | Interrupted or invalid migrations fail without serving an inconsistent schema. | Release qualification | Release | PostgreSQL 17 and candidate image | Version-owned synthetic dataset | Migration logs and invariant checksums | Database and release | Upgrade harness is tracked by #220. |
| OP-3 | P0 | Low | A documented backup restores into an empty compatible environment and passes functional and integrity checks. | A complete compatible backup restores into an empty PostgreSQL 17 environment. | Corrupt, incompatible and interrupted restores fail clearly and never qualify as usable. | Release qualification | Periodic, release | Fresh PostgreSQL 17 | Production-shaped synthetic dataset | Backup metadata and restore report | Operations | Automated restore proof is tracked by #221. |
| OP-4 | P1 | Medium | Required gates are reproducible, isolated, diagnosable and cannot turn a missing tool or retry into success. | Independent fixtures pass under normal and varied order with retained first-attempt evidence. | Concurrency timeout, tool outage, cleanup failure and rerun cannot be reported as a clean first attempt. | All levels | PR, nightly | CI and reference runners | Independent deterministic fixtures | First-attempt result and privacy-safe diagnostics | Build and quality | Periodic backend order and configured/reversed browser-project runs measure isolation without retries. |

## Automation gap register

| Risk | Gap | Owner | Review date | Decision |
|---|---|---|---|---|
| Module API | [#45](https://github.com/jegr78/courtside/issues/45) records test-fixture coupling that inflates a module surface. | Architecture | 2026-11-13 | Existing issue remains authoritative; do not duplicate it. |

New material gaps are added here or linked to an existing authoritative issue before the change is considered qualified. Review dates are advanced only after the risk and available evidence are reconsidered.

## Flake policy

A flaky test is a product-quality defect. The first attempt remains visible and a retry is recorded separately; retries never convert a failed required check into clean evidence. Quarantine requires a linked issue, owner, affected risk IDs, containment, expiry and a replacement signal. P0 tests are not quarantined. Periodic order variation and repeated concurrency runs measure flake rate; the target is below 0.5% first-attempt failures per gate and zero unexplained failures in release qualification.

## Maintenance

Pull requests update this contract when they add a product surface, alter an invariant, change supported environments, introduce an accepted risk or move evidence between gates. A release review checks every row whose frequency includes `release`. The document stays at risk level: individual classes, methods and scanner rules remain discoverable from executable configuration and must not be copied here.
