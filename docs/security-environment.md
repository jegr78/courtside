# Security assessment environment

`deploy/compose.security.yaml` creates one disposable target for active security assessments. It is not a general development or UAT environment. The assessed application is the candidate image itself, started with no non-production profile and no fixture configuration; the `security` Spring profile belongs to the `seeder` service, which fills the disposable database and exits before the target starts. The seeder refuses to run unless all of these identities agree:

- `COURTSIDE_ENVIRONMENT=SECURITY`;
- a confirmed disposable profile;
- a valid per-run identifier, seed fingerprint and instance fingerprint; and
- the Compose-local `courtside_security` database on host `db`.

Startup builds the seeder's image from the candidate that was handed to it, so the assessment data is written through the candidate's own domain services while the candidate image carries no seeder of its own. That image is removed with the rest of the run. The fixture classes it adds come from `target/fixtures-classes`, so package the checkout before starting a run against a published candidate.

The fixture overlay is owned by the application's UID and GID. Host-side staging files and
directories can retain private permissions without blocking the non-root application loader.

The candidate image carries one piece of assessment instrumentation of its own: a filter that answers every request with the host and scheme the application observed, which is how the passive suite proves the proxy canonicalises them. It is bound to `COURTSIDE_ENVIRONMENT=SECURITY`, which is an operator's variable rather than a mechanism a club cannot reach, so `security-risks.md` records what that residue costs. `NonProductionProfileTest` bounds it: a shipped source that selects a Spring profile or a condition on `courtside.environment` has to be this one, and the packaging's own exclusion list is what the test reads to decide which packages are not shipped.

## Prepare the images

The application networks have no Internet route and every service uses `pull_policy: never`. Pull the images the profile pins before starting it. Build or pull the Courtside candidate separately and refer to it by immutable image ID or registry digest.

```bash
node tools/security-image-inventory.mjs active | xargs -n1 docker pull
node tools/courtside.mjs security run-0001 ghcr.io/jegr78/courtside@sha256:<digest>
```

The inventory reads each digest out of the deployment and the scanner policies, which is where they
are pinned. A digest written here as well would be a second copy that nothing bumps.

The command creates a random shared password, a seed fingerprint, a random instance fingerprint and a private state file below `build/security/run-0001`. It prints the synthetic credential once for the operator. The password never appears in a tracked file or command argument.

Startup atomically reserves the run ID in Docker before Compose can create resources. The instance fingerprint binds that reservation, private state, manifests, containers and networks; another workspace cannot reuse or clean up the same run ID.

Before cleanup after a startup failure, the runner attempts to retain the exact owned seeder's bounded stdout, stderr and exit/OOM state in private `startup-diagnostics-attempt<N>` directories below the run directory. A refused or incomplete capture never replaces the startup error or prevents owned cleanup; these logs may contain private data and must not be published.

Each run gets its own Compose project, networks, containers and dynamically allocated loopback TLS port. Both application networks are Docker-internal. The application and scanners attached only to these networks have no routed Internet or private-network access.

Docker's host and container runtime remain part of the host trust boundary. Run active and destructive assessments inside a dedicated VM with no sensitive host services or private-network access. The Compose isolation alone is sufficient only for safe checks.

## Dataset

The profile creates two enabled accounts for each product role and two accounts carrying the relevant member and manager role combination. Every identity uses an English placeholder name and an `@example.org` address. The dataset also contains current and ended memberships, two courts, foreign-owned bookings and a series with two usable occurrences. The shared password is unique to the run.

The bootstrap administrator is separate and retains its mandatory initial-password state. Assessment code should use the role-specific accounts unless it is explicitly testing bootstrap behavior.

## Verify and remove

Before an active request, verify the live source marker and the container labels against the private run state:

```bash
node tools/courtside.mjs security-verify run-0001
```

A different environment, run ID or seed fingerprint stops verification. Cleanup removes only that run's Compose project and credentials while retaining assessment manifests:

```bash
node tools/courtside.mjs security-cleanup run-0001
```

The database and Caddy state use size-limited tmpfs mounts, so no data volume survives `down`. Recover an interrupted attempt by its exact run and attempt identity:

```bash
node tools/courtside.mjs security-recover run-0001 --attempt 1
```

The validated project name keeps cleanup away from other workspaces. Removing the environment and retained evidence requires the exact project confirmation:

```bash
node tools/courtside.mjs security-reset run-0001 --confirm courtside-security-run-0001
```

## Plan and execute an assessment

Planning reads the identity recorded during environment startup. It sends no request and prints the selected target, profile, tools, tests, authorization string, budgets and maximum duration:

```bash
node tools/courtside.mjs security-plan run-0001 active
```

The safe profile runs the bounded deployment suite without a separate authorization string. It requires the digest-bound deployment qualification created by the release UAT smoke:

```bash
node tools/courtside.mjs security-run run-0001 safe --qualification build/uat-smoke/qualification.json
```

It checks the TLS policy and certificate, security and cache headers, secure cookie delivery, private-route exposure, unusual methods, request and header limits, forwarded-header handling, direct application behavior and live container restrictions. Separate scanner-client and scanner-upstream networks force every scanner request through the synchronous request and concurrency gate before it can reach the proxy. The public target still uses its run-specific trusted CA; the suite never disables TLS verification.

Active and destructive runs require their separate exact authorization strings. They work only against the loopback-bound `SECURITY` environment:

```bash
node tools/courtside.mjs security-run run-0001 active --qualification build/uat-smoke/qualification.json --authorize authorize-active-run-0001
node tools/courtside.mjs security-run run-0001 destructive --qualification build/uat-smoke/qualification.json --authorize authorize-destructive-run-0001
```

The current CLI executes all three profiles only against the loopback-bound environment it created and verified. The orchestration API also supports an explicitly authorized exact origin for future `safe` adapters. Redirects never extend that allowlist. `active` and `destructive` reject every non-loopback origin and every environment other than `SECURITY`.

[`security/run-contract.json`](../security/run-contract.json) fixes duration, request, concurrency, generated-data, CPU, memory and evidence limits for each profile. The runner owns every scanner container, kills it on deadline, request limit or emergency stop, and restricts it to the dedicated scanner network. Attempts for one run reserve scanner access atomically and cannot reset each other's request counter. Only the exact safe `CSA-DEPLOY-001` plan and the complete active plan for authentication, authorization, DAST, API boundaries and imports can open that path. Every other adapter remains blocked until it has equivalent process, network, resource and evidence controls.

Each attempt writes a private manifest below `build/security/<run-id>/assessment/attempt-<number>`. A rerun always gets a new attempt number. It cannot replace or upgrade the first result. The manifest follows [`security/run-manifest.schema.json`](../security/run-manifest.schema.json) and contains no credential, cookie or authorization value.

The safe suite writes `passive-deployment.json` and `passive-deployment.md` beside the manifest. Its closed native observations cover representative sensitive and backup paths, unsafe and overridden methods, accepted and rejected TLS negotiation, and the running application's user and writable paths. ZAP creates its raw report in a size-limited container tmpfs. The runner reads it while the container is alive, converts it to the closed evidence schema and removes the container without retaining the raw report. Scanner alerts contain only plugin, risk, confidence, HTTP method, a catalogued route template, stable finding fingerprint, occurrence count and rule-specific structural evidence. Cookie, header, policy, application and session rules retain enumerated classifications rather than values. Suspicious comments retain identifiers from ZAP's fixed default pattern catalog, digests of their concrete resources and occurrence counts. A location digest binds those facts to the qualified image and finding. Matched comments, resource paths and arbitrary scanner text are discarded.

A missing or malformed report, foreign scanner origin, URL credential, query string, concrete identifier, unclassified route, binary textual match, unknown rule or unsupported rule evidence makes the run incomplete instead of creating a candidate that cannot be reproduced. The validator recomputes finding and rule-evidence relationships when retained evidence is read. Response data is never retained. An alert leaves the run incomplete until a record resolves it: a disposition in [`passive-alert-dispositions.json`](../security/passive-alert-dispositions.json) that names the same rule, method, route template, risk, confidence, scanner version and rule-specific observation, or, through such a record, an acceptance in [`exceptions.json`](../security/exceptions.json) that has not expired. A louder risk or a different observation on the same route is a new alert and stays a candidate.

The active suite writes `authorization-matrix.json`, `authenticated-zap.json` and `openapi-fuzz.json`. It creates all role sessions outside the scanners and passes credentials only through stdin to mode-`0600` files in container tmpfs. The gateway applies a suite-specific method allowlist and stops forwarding when its request or generated-body budget is exhausted. Schemathesis writable files live on three tmpfs mounts whose combined capacity stays below the generated-data contract. The gateway also counts every relayed `429` whose problem type is an admission refusal, which is how a refused ZAP attack leaves its attempt incomplete. The ZAP policy disables every passive rule except the isolated canary and every active rule except the two IDs in [`security/zap-authenticated-policy.json`](../security/zap-authenticated-policy.json) and paces the active scan with one thread and a fixed request delay. The Schemathesis policy in [`security/openapi-fuzz-policy.json`](../security/openapi-fuzz-policy.json) fixes its image, seed, phases, examples, workers, required input classes and explicit operation exclusions. The runtime route inventory comes from the assessment-only Actuator mappings endpoint and never enters scanner traffic. Run the safe profile separately for the full passive baseline.

The SECURITY Compose file sets no login or admission override, so every profile assesses the
limits a club installs. The destructive suite writes version-2 `resource-abuse.json`. Its complete primary-key snapshots
protect all existing rows and columns, including authentication, audit and import data. A changed
whole-database fingerprint is not by itself a corruption finding: a real booking legitimately adds
allocations, participants, an audit event and mail bookkeeping. Only effects correlated with the
private request journal and the actual application response may qualify. Unknown schema, missing
attribution or unsupported authentication data remains incomplete; a proven protected mutation
fails even when a circuit breaker stopped the workload early. Previous version-1 attempts remain
historical evidence and are not relabelled as version-2 qualification.

An internal, resource-limited mail sink accepts STARTTLS deliveries only to `@example.org`. Each
instance receives a private relay certificate and Java truststore, without a heap override or a
trust-all setting. No relay port is published. Message-ID, calendar booking UID, recipient and
slot times correlate each confirmation with its booking; the sink's receipt timestamp supplies the
handover observation instead of the sender-controlled Date header. Malformed MIME, duplicate or
missing receipts and exhausted mailbox capacity cannot establish a passing effect.
The sink's actual image ID, run identity and backend endpoint must match the recorded instance;
a matching image reference string alone does not establish a trusted receipt producer.

Authentication projections decode the actual stored JDBC session bytes in a bounded, offline
fixture container derived from the candidate. Native roles, the password factor and its timestamp,
erased credentials and observed request times constrain the allowed session changes. A missing
decoder or unsupported serialized attribute cannot qualify. The gateway's own bounded receipt
attributes its oversized-body rejection separately from application login-rate bookkeeping.

Before pressure, the native booking listener, effective DELETE completion policy and Spring Modulith
2.1.1 JDBC V2 repository bind asynchronous publication settlement. The candidate and decoder must
carry identical JDBC library bytes; legacy or overridden repository configuration is unsupported.
A causally matched PUBLISHED or PROCESSING publication with its original timestamp and one attempt
remains incomplete until later actual snapshots prove its deletion and mail handover. Wrong,
duplicate, foreign or protected publication changes fail immediately.

Cleanup follows effect validation and selects only newly created, validated booking IDs, never
notes. It checks target rows and cascades inside a locked transaction and verifies a separate
post-cleanup snapshot. Recovery restarts the same application container without reseeding and polls
its native health with bounded commands inside the existing run deadline. Only a running, healthy
container with unchanged identity permits the recovery snapshot; identity drift, OOM and terminal
states fail, while absent state or deadline exhaustion remains incomplete. Effects, cleanup and
recovery have separate outcomes and fingerprints. Missing race
coverage, zero requests or an early clean interruption remains incomplete rather than a pass.

Raw snapshots, session projections, relay keys and the operation journal contain private data.
Keep them in mode-`0700` instance directories with mode-`0600` files under ignored `build/security`;
never upload them with normalized assessment reports. Retained relay assets belong to their
original instance and are not reused by a fresh instance with the same run ID. Native inputs persist
before pressure under the same bounded evidence budget as later observations, including on early
failure. A step that ends incomplete keeps its error name and a message cut to 200 characters in the
private evidence: `failure-reason-native.json` for the run, `step-failures-native.json` for telemetry
and the scanner summary, `failures` in `decoder-binding-native.json`, and `failure-reason.json` beside
the startup diagnostics. Assessment results that leave the private directory carry only a stable
code or the error's type. Use the exact
`security-reset` confirmation above to remove retained private evidence after its review.

To replay an OpenAPI candidate, keep its protected `openapi-fuzz.json`, start a fresh environment with the recorded application image, and run the recorded active profile against the unchanged image, policy, OpenAPI digest and seed. Locate the new counterexample by operation, mode, check, case ID and request locations, then compare its structural `reason`. The reproduction digest matches only when those structural inputs match. Concrete query, path and body values are deliberately not retained; replay regenerates them from the pinned scanner and seed. The same exact status disagreement, public instance pointer and missing public properties, or media-type classification validates the structural defect. Never copy a discarded raw Schemathesis report into retained evidence.

Two kinds of candidate are not replayed that way. A `scenario-completion` counterexample records that a scenario ended without succeeding and without failing a check; its `reason` carries the scenario status, and a run that ended in a timeout, an error or an interruption is not reproducible from the seed. An `input-case-incomplete`, `import-case-incomplete` or `mutation-case-incomplete` candidate has no counterexample at all: it names a probe of the pinned policy whose response was not the documented one, and the retained input, import or mutation case beside it carries the status and problem type that were observed. Both kinds are read from the retained evidence rather than regenerated, and both keep a run incomplete until somebody triages them.

Inspect the latest or a specific attempt with:

```bash
node tools/courtside.mjs security-report run-0001
node tools/courtside.mjs security-report run-0001 --attempt 1
```

The emergency stop is local and immediate. The current prerequisite checks it before target verification and preserves the current manifest:

```bash
node tools/courtside.mjs security-stop run-0001
```

Before an authorization probe that requires a CSRF token, an empty cookie jar acquires a fresh
host-bound token through `GET /api/session`. This bootstrap uses the same controlled sender, so
its request counts against the budget and respects the deadline and stop signal. A bootstrap
without a host-bound token fails closed. Deliberate missing-CSRF probes do not acquire or inject
a token, and a refresh never signs an actor in or restores a revoked session.

Scheduled safe assessments are defined in
[`security-assessment.yml`](../.github/workflows/security-assessment.yml). The active assessment a
release requires is defined in [`release-gates.yml`](../.github/workflows/release-gates.yml), which
both the release and the nightly `build` call. Destructive execution is never scheduled and has
no remote workflow. Run it through the local CLI with the exact digest, source commit and
confirmation shown by `security-plan`.
