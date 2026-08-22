# Security assessment contract

Courtside maintains a repeatable internal security assessment based on OWASP guidance. It gives a maintainer a bounded, auditable way to exercise known attack classes and prepares evidence for an external tester. It does not replace an independent penetration test and a successful run does not prove that the application has no vulnerabilities.

The risk-level source remains [`docs/quality-strategy.md`](quality-strategy.md). The machine-readable [`security/assessment-catalog.json`](../security/assessment-catalog.json) maps concrete assessment work to those risk IDs; it does not copy or redefine their impact, ownership or product invariants. Its shape is closed and versioned by [`security/assessment-catalog.schema.json`](../security/assessment-catalog.schema.json).

## Standards and versioning

Catalog version 1 uses:

- OWASP Web Security Testing Guide 4.2 as the test method;
- OWASP Application Security Verification Standard 5.0.0 Level 2 as the verification baseline;
- OWASP API Security Top 10 2023 as the API-management view;
- OWASP Top 10 2025 as the management summary; and
- CVSS 4.0 as one input to severity.

ASVS references include the version, for example `v5.0.0-8.2.2`. WSTG references include `v4.2`. A standards upgrade changes the catalog version and must compare renamed, added and removed controls before it replaces an active baseline.

Each catalog entry is an executable coverage unit, not a claim that the listed references exhaust every requirement in a chapter. The control inventory pins all 253 ASVS requirements at Levels 1 and 2 and all 97 WSTG test identifiers from the cited source commits. A control without a more specific automated assessment remains `planned` under #251; this conservative classification prevents an unreviewed control from disappearing as implicitly not applicable. Before the baseline in #253 can pass, every applicable control must be linked to an implemented entry, or explicitly recorded as blocked or not applicable with a rationale. An unclassified or merely planned applicable control makes that baseline incomplete.

## Authorization and targets

The repository owner authorizes work in this framework. Authorization to change the framework does not authorize traffic against an arbitrary Courtside instance.

`safe` contains bounded passive and non-destructive checks. It may run against the disposable `SECURITY` environment, UAT, or an explicitly authorized production instance. Production authorization is target-specific and permits only the selected safe checks. It does not extend to authentication guessing, domain mutation, discovery outside the origin or resource exhaustion.

`active` permits curated mutations, authentication attempts and injection payloads only against the disposable `SECURITY` environment. It requires explicit authorization for the run after the orchestrator has verified the environment marker, run identity, seed fingerprint, target allowlist and immutable application identity.

`destructive` permits bounded resource-exhaustion and protocol-abuse checks only against `SECURITY`. It requires a separate explicit authorization, telemetry, circuit breakers and recovery checks. The name describes the possible effect on that disposable environment; it never permits volumetric denial of service or traffic against public targets.

Redirects, callbacks and discoveries never widen the authorized origin. A profile mismatch, changed target identity, missing marker or failed safety proof stops attack traffic and makes the run incomplete.

## Threat perspectives

The model covers an anonymous caller, every product role, relevant combinations of a member role with a managing role, and a compromised authenticated account. At least two identities per authorization class are required where ownership or horizontal access is relevant.

The catalog inventories the public PWA, authentication and server-side sessions, member booking and participation, facility and membership administration, data exchange, the REST boundary, the reference deployment, release artifacts and operational data. Trust boundaries include browser-to-proxy traffic, trusted proxy metadata, application-to-PostgreSQL access, source-to-image production and operator-held evidence.

A single-tenant deployment reduces cross-club authorization paths but does not remove horizontal access between people in the same club or the need to test configuration and deployment isolation.

## Catalog lifecycle

Every entry has a stable `CSA-<AREA>-<NUMBER>` identifier. Renaming a test does not change that identifier. An incompatible schema change increments `schemaVersion`; coverage changes increment `catalogVersion`.

The four catalog states mean:

- `planned`: there is an owned implementation issue, but no assessment evidence may be claimed yet;
- `implemented`: the listed execution and evidence are available and maintained;
- `blocked`: execution needs a missing capability or external state, with rationale and tracking issue; and
- `not-applicable`: the control does not apply to the shipped architecture, with a concrete rationale.

An implemented entry can still be incomplete in a particular run. Catalog state describes capability; run outcome describes execution. Controls that require human judgment link to the concrete procedures in the [manual assessment runbook](security-manual-assessment.md). Their retained record is constrained by the closed [`manual-assessment-evidence.schema.json`](../security/manual-assessment-evidence.schema.json) rather than an unaudited checklist.

## Evidence and outcomes

Evidence identifies the catalog and tool versions, application commit and immutable image digest where applicable, target fingerprint, selected entries, profile, timestamps and first-attempt result. The safe deployment suite retains a closed JSON record and a Markdown summary. Both contain normalized observations and scanner identifiers, never URLs, response bodies, cookies, CSRF tokens or sensitive header values.

The [security finding lifecycle](security-findings.md) defines candidate validation, stable
fingerprints, protected evidence references, risk acceptance, remediation and retests. Scanner
adapters must produce that closed record before their results can affect an assessment outcome.

`passed` means every selected entry executed, all required evidence exists and no validated finding remains outside an unexpired acceptance. An untriaged scanner candidate prevents a final pass until it is validated or rejected reproducibly.

`incomplete` means execution cannot support a security conclusion. Tool failure, missing evidence, stale or mismatched target identity, lost authentication, an unexecuted selected control and an expired exception all produce this outcome. A retry is a separate run and cannot rewrite the first attempt.

`failed` means an expected secure outcome was violated or a validated finding remains unresolved and unaccepted. HTTP status alone is insufficient evidence where a proxy, database constraint or another layer could produce the same status.

## Severity and triage

CVSS 4.0 measures technical severity; Courtside context determines the final P0-P3 priority. Context includes required privileges, reachable club data, cross-person impact, booking integrity, recoverability, default deployment exposure and whether a candidate image has been published.

P0 findings are triaged within 24 hours and block release until fixed and retested. P1 findings are triaged within 72 hours and block release unless a precise, expiring acceptance records compensating controls. P2 findings are triaged within 14 days and need owned remediation or acceptance. P3 findings are triaged within 30 days and remain recorded with product context. These are triage deadlines, not promises of unattended incident response by a volunteer project.

Open exploit details use GitHub private vulnerability reporting. Public issues and regression tests are created only when they do not disclose a usable exploit or sensitive evidence.

## Single-maintainer governance

One maintainer may authorize a run, validate a candidate, accept risk and close a retest. Independent review is recorded whenever it occurs, but its absence does not block action. Every approval still records the actor, timestamp, target, rationale and whether independent review occurred. This exception preserves the ability to operate the project; it does not represent separation of duties that did not happen.

Automated scanner output begins as a candidate. It affects a release only after reproducible validation establishes the affected surface and secure outcome, except that a missing required scanner or report makes the assessment incomplete. Risk acceptance is precise, owned, justified, time-bounded and removed when it no longer matches current evidence.

## Scope boundary

The safe deployment suite runs native TLS, HTTP, proxy and container checks plus the pinned ZAP passive baseline against `SECURITY`. ZAP can reach only the internal proxy network. Any scanner alert remains an untriaged candidate and makes the run incomplete. The active suite adds the OpenAPI authorization matrix, authenticated ZAP scans and the pinned Schemathesis boundary suite. The destructive suite adds only the bounded resource-abuse adapter described below. Product vulnerabilities found by a suite are fixed separately so framework changes do not conceal product changes.

## Workflow gates

The required pull-request build runs contract, schema, safety and secret checks without active
assessment traffic. It retains a comparison of security contracts, policies, report schemas and
pinned tool versions against the pull-request base. The comparison includes the images and adapters
that actually execute. When those bytes change, the required build runs the protected-base and
candidate assessment runtimes, each against the image its own revision builds and qualifies, and
against the same synthetic fixture. Each side reads its own deployment description, so a pull
request cannot reach the run that exists to be independent of it, and a setting the candidate makes
mandatory cannot stop the protected base from starting. The comparator refuses a run whose image
does not carry the revision that side stands for, and records both application identities so a
finding difference is read beside whatever else moved. The workflow
uses the comparator from the protected base revision after its initial bootstrap. It computes both
runtime digests itself rather than trusting run input. The introductory comparator change requires
the normal whole-branch review because no earlier trusted comparator exists. The workflow, not a
committed self-attestation, creates the closed comparison record. It binds both commits,
runtime digests, original manifest digests, image identity, catalog and tool versions, elapsed time
and normalized finding fingerprints. Missing tools, tests or evidence files, mismatched fixtures and
a failed candidate assessment fail the pull-request build. So does a finding the comparison gained
or lost that `security/tool-update-acknowledgement.json` does not name: the difference is what the
run exists to produce, so it is written to the job summary and has to be recorded in the pull
request before the branch passes. The run itself is triggered by the digest of what a paired run
varies — the assessment's code and contract, the deployment description each side reads, and the
lockfile the tools resolve against. A dependency bump of the application is not a tool update. An incomplete result remains comparable
only when every planned tool produced its result and the incompleteness comes from retained finding
candidates awaiting triage.

[`security-assessment.yml`](../.github/workflows/security-assessment.yml) runs the bounded `safe`
profile weekly and on manual dispatch. It builds and qualifies one local candidate, resolves its
immutable Docker image ID, runs the assessment once and retains only the redacted gate record and
run manifest for 14 days. Missing scanners, missing evidence and incomplete outcomes fail the job;
they are never normalized as a clean run.

The release workflow runs the complete `active` profile after both architectures qualify the
candidate and before the security record can be assembled. The active manifest, normalized gate,
image-security summaries and final release record all name the same candidate digest. Publication
depends on that record, so another image or a second successful attempt cannot replace the required
first attempt.

Destructive assessments use the local CLI only. They have no GitHub Actions workflow because a
self-hosted runner label cannot prove that the host is ephemeral or guarantee cleanup after runner
loss. The CLI still requires the exact image digest, target identity and run-specific
`authorize-destructive-<run-id>` confirmation. A future remote path needs infrastructure that
creates and destroys a one-job runner outside the assessment job.

## Resource abuse and recovery

The destructive suite requires the exact `authorize-destructive-<run-id>` confirmation. Its pinned
k6 container ramps gradually through the request gateway and exercises login hashing and rate
limits, request-body rejection, competing court occupancy, duplicate delivery, participant-card
capacity, maximum series previews and stale-preview mutations. It has no host network, Docker
socket or direct application network.

The orchestrator samples application and PostgreSQL CPU and memory, active and pooled connections,
waiting locks, session rows, database size, request p95 and upstream error rate. Two consecutive
samples beyond a trip threshold stop attack traffic before a separate hard safety limit. Crossing
a hard limit fails the run; reaching only the lower trip threshold makes it incomplete. Passing
requires exactly one surviving competing booking, one stored result for duplicate delivery, a
fail-closed stale preview, no partial operation, restoration of the domain-state fingerprint, a
healthy database and a successful application restart. Evidence binds the mounted policy, k6 script,
request gateway and scanner image by digest. Capacity latency and throughput remain performance
evidence under `performance/`; safety-limit breaches belong to the security run.

## Authentication and authorization method

The active suite generates its operation inventory from OpenAPI. Every operation records an explicit result for anonymous access, all seven product roles and an initial-password session. A second independently authenticated identity for every role verifies that the result is not tied to one seeded account. Separate object checks substitute booking and series identifiers between two members, try administrative field injection and compare domain state before and after the rejected requests.

Every mutation receives a missing-CSRF request, a hostile-origin preflight, a hostile Host request and an untrusted forwarded-host request. The Host probe must observe the proxy's canonical upstream host. The retained record contains only operation identifiers, actors, normalized outcomes, status codes and Courtside problem URNs. [`security/authorization-evidence.schema.json`](../security/authorization-evidence.schema.json) rejects additional fields, and semantic validation rejects a missing operation, actor, object check or request boundary.

Login enumeration uses twelve paired samples for an existing synthetic account and a missing account. The request order alternates between pairs, and a successful synthetic login clears the address counter before the next pair. The suite compares the two medians and fails when their relative difference exceeds 0.5. It retains the sample count and aggregate medians, not usernames, passwords or individual timings. A separate sequence sends twenty failed requests through the encoded login path and requires the next canonical request to return the typed `login-rate-limited` problem.

Session invalidation remains part of the packaged-browser regression suite. Login rotates the session identifier; logout invalidates it; password, username, role, account-status and membership changes advance the account security epoch. The server compares that durable epoch on every authenticated request, so an already loaded session cannot restore stale authority after a concurrent response saves it.

Browser security reuses that packaged PWA suite rather than starting a second browser environment. Chromium projects inert stored markup through the maintained rendering-context inventory, records normalized CSP violations, and inventories console event types, Web Storage keys and cache request paths without retaining their values. It repeats the storage, cache and cookie inventory after logout and browser-history navigation. Security journeys retain no raw trace or screenshot. WebKit and periodic Firefox runs verify the CSP and clickjacking headers. The service-worker update journey rechecks both CSP and the absence of API responses from Cache Storage after activation.

Authenticated ZAP uses a separate synthetic session for each role. The scanner receives the cookie only through a mode-`0600` file in its container tmpfs. It spiders read-only routes for all roles and runs the two curated query-only active rules for `MEMBER` and `ADMIN`. The gateway rejects non-canonical paths, other methods and foreign origins before the request reaches Caddy. Every role proves its session again after its scan jobs. A scanner-only response exposes a harmless header that the pinned passive rule must detect; absence of that canary, a lost session, missing role coverage or an unexpected rule makes the attempt incomplete. Raw ZAP reports and cookies are discarded with the container. Retained evidence binds both the policy and the executed role plans by digest and contains normalized candidate fingerprints but no URLs, payloads, response bodies or authentication material.

Schemathesis inventories every OpenAPI operation under a fixed seed. Its examples, coverage and fuzzing phases exercise read-only operations with valid and invalid requests. Every included mutation receives a deterministic malformed body or path value while authenticated, so invalid authentication cannot turn into a valid write when the scanner supplies credentials. Valid mutations remain in the packaged journeys and authorization suite so the state comparison has one meaning. Authentication transitions and import execution have explicit exclusions. Deterministic HTTP cases cover missing, duplicate and unknown fields, Unicode normalization, control characters, nested JSON, body size, numeric, cursor, date-time and idempotency-key boundaries. Four multipart cases cover invalid UTF-8, duplicate columns, an oversized cell and a conflicting external reference. The runner fingerprints roster, booking and configuration state immediately before and after the rejected-input phase. It excludes session counters and immutable preview records from that comparison.

Each active adapter receives an isolated authentication budget. Before the authorization matrix starts, the environment owner clears only the synthetic login-attempt counters after revalidating the exact run identity; domain fixtures and sessions remain unchanged.

The scanner runs with one worker and an in-memory generation database. Its image, policy and OpenAPI bytes are digest-bound. Raw responses and authentication data stay in container tmpfs and are deleted with the container. Retained evidence contains operation IDs, path templates, modes, the seed and redacted minimized requests. Reproduction digests bind those fields together. The runner compares Spring Boot's live handler mappings with OpenAPI, so a registered API operation absent from the document becomes a finding candidate. Repeated failures for one rule and operation become evidence entries on one candidate instead of duplicate lifecycle records. A missing operation, changed state or incomplete boundary case prevents a pass. Domain property tests remain separate because they exercise Java value spaces without HTTP, proxy, authentication or serialization behavior.

The disposable target is described in [`security-environment.md`](security-environment.md). Its run-specific marker, synthetic role matrix, network isolation and cleanup are prerequisites for every `active` or `destructive` assessment.

The same document describes the bounded CLI workflow. The machine-readable run contract and manifest schema fix its budgets, first-attempt evidence and interruption semantics before assessment tools are added.
