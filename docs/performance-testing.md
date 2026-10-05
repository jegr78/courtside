# Performance testing

Courtside defines its load shapes, thresholds, resource budgets, and safety boundaries in
[`../performance/contract.json`](../performance/contract.json). Test runners consume that file;
scenario scripts must not carry independent copies of the same values. Machine-readable results
conform to [`../performance/result.schema.json`](../performance/result.schema.json).

The pinned k6 images are the official protocol and browser variants, declared as services in
`../deploy/compose.perf-k6.yaml` so that their digests are watched for updates like every other
image this project runs. Each readable version tag is bound to an approved multi-architecture OCI
index digest; the runner must reject a registry result with another digest. Docker is the default
execution boundary so macOS, Linux, Windows, and automation use the same k6 runtime. A native k6
installation is optional and must match the declared image version before it can produce a
comparable result.

## Reference workload

The initial reference represents a demanding single club instance with 1,000 members and 8 courts.
Normal traffic uses 50 concurrent virtual users, peak traffic reaches 100, and the protocol mix is
90 percent reads and 10 percent writes. Twenty virtual users provide the separate contention shape
for attempts against the same court and time slot.

Dataset shape and workload shape have separate identifiers. A 500-member and 4-court dataset can
therefore be added without changing scenario behavior or threshold definitions.

## Profiles

| Profile | Purpose | Boundary |
|---|---|---|
| `smoke` | Validate installation, scripts, and coarse safety thresholds. | 2 VUs for 1 minute. |
| `baseline` | Detect normal-load regressions on defined resources. | 50 VUs for 10 minutes. |
| `peak` | Exercise the expected booking-window peak. | 100 VUs for 15 minutes. |
| `stress` | Find the capacity boundary and observe degradation. | Staged to 200 VUs over 22 minutes. |
| `contention` | Qualify one shared-slot booking winner and typed conflicts. | 20 preauthenticated VUs, one attempt each, at most 2 minutes including setup. |
| `soak` | Detect leaks and pool exhaustion. | 50 VUs for 2 hours on a fresh environment. |
| `browser` | Measure PWA journeys and Web Vitals. | At most 5 browser VUs for 10 minutes. |
| `funnel-smoke` | Verify the public transport and PWA path without load. | Read-only, at most 2 VUs for 2 minutes. |

Only `smoke` is suitable for routine automation. Baseline, peak, stress, contention, soak, and browser runs are
manual until a dedicated runner provides stable resources. The Funnel profile is always manual and
requires an operator to supervise `uat share` separately.

Browser containers retain the UID and GID of the private credential owner and use `/tmp` as their
home directory, since the image's default home belongs to another UID. The trusted loopback identity
probe uses the browser target's hostname for SNI and HTTP Host, so Chromium receives that target's
verified public-key pin rather than a distinct `localhost` certificate. TLS verification stays enabled.
The target is a canonical HTTPS origin without an explicit default port, matching Chromium's
request and response URLs.

### Login verification capacity

The reference application has two password-verification slots. The value is measured against the
then-current 2 CPU and 1 GiB application limits, rather than inferred from a developer
machine. On 2026-09-05 the ordinary two-VU smoke admitted both simultaneous Argon2id logins with no
technical error; each completed in about 253 ms. The control run with one slot produced an immediate
typed `429`
for one of those two logins. Two is therefore the smallest measured value that carries the reference
smoke without shedding a normal attempt.

Repeat the comparison whenever the Argon2 parameters, application CPU or memory limit, or login path
changes. Start the ordinary environment with
`node tools/courtside.mjs perf --skip-verify --no-credential-output`, then run
`node tools/courtside.mjs perf-run smoke`. Start it again with
`COURTSIDE_LOGIN_VERIFICATION_CONCURRENCY=1` prefixed to the first command and repeat the smoke as
the falsification control. The control is expected to record a `429`; it is evidence for the
boundary, not a passing candidate run.

## Result semantics

Technical request failures and unexpected server errors determine automated smoke health. An
expected booking conflict is a domain outcome with status `409` and increments `booking_conflicts`;
it is not a transport failure. Reports include p50, p90, p95, p99, throughput, iteration and request
counts, technical error rate, server-error count, threshold results, and optional conflict and Web
Vitals metrics.

Protocol raw summaries and remote-write series also expose `login_attempt_failures`,
`login_success_duration`, `login_time_to_authenticated`, and `login_authenticated_users`.
The attempt-failure rate uses login POSTs as its denominator, not all requests. Success duration
covers only accepted login POSTs. Time to authentication includes session setup, retries, retry
pauses, and the successful session refresh. It is emitted once per authenticated VU; users who
never finish authentication have no completion-time sample. The existing `login_duration` metric
and its threshold still include every login POST attempt.

`contention` authenticates members sequentially in setup, then starts one booking attempt per VU
against the same court and slot. The winner holds the booking for five seconds before cancellation.
Qualification requires exactly 20 attempts, one creation, 19 typed court-unavailable conflicts, one
successful cancellation, and the configured technical-error and booking-latency thresholds.
An unrelated `409`, multiple winners, no winner, or failed cleanup fails the run. Setup refuses
non-PERFORMANCE markers before authentication. Interrupted runs can leave a synthetic booking;
inspect and clear that slot in the disposable environment before retrying.
Record whether contention ran directly after startup or after other traffic. Cold and warm runs
can differ materially. Preserve a cold-run latency failure rather than treating a later warm pass
as proof that the same budget was met after startup.

### Cold booking follow-up

On 2026-10-02, the isolated CachyOS runner compared the rc.8 image with small class overlays.
Each restart used the same application and database limits and ten-connection pool. The first
booking workload followed sequential authentication of twenty members. Read-only PostgreSQL
activity samples ran every 50 ms; these comparisons did not enable JFR.

| Candidate | Booking contention p95 | Maximum observed DB lock waiters |
| --- | --- | --- |
| Unmodified rc.8 | 1,364 ms | 9 |
| Prepared request mapping and validation | 1,128 ms; repeat 1,038 ms | 9 |
| Preparation plus a local creation queue | 1,257 ms; repeat 1,280 ms | 0 |
| Preparation plus new-aggregate persistence | 1,096 ms; repeat 975 ms | 9 |
| Persistence plus prepared request fingerprints | 944 ms | 9 |
| Fingerprints and an occupied-court JPQL check | 1,038 ms | 9 |
| Native occupied-court `EXISTS` check | 870 ms | 9 |

Every run produced twenty attempts, one creation, nineteen typed conflicts and one successful
cancellation, with no technical or server errors. The first three candidates missed the cold
booking budget. Persistence and fingerprint preparation alone were inconsistent: two additional
restarts without PostgreSQL sampling measured 995 ms and 1,229 ms.
The queue removed the observed DB lock wait chain but increased latency relative to preparation
alone, so it was not retained. Request mapping and validation preparation uses transient DTOs
before readiness; it does not create a booking or change the database coordination lock.

The retained combination prepares request and fingerprint mapping, persists new aggregates
without merge-before-insert reads, and checks known occupancy after complete rule validation.
The native `EXISTS` query uses the same half-open range expression as the GiST constraint.
Concurrent idempotency replays retain their original result. A write racing after that read is
still rejected by the unchanged database constraint, with the losing transaction rolled back.
The aggregate insert test reduced eight SQL statements to four inserts for one allocation and
two participants; existing and reloaded bookings still update their original identity.

Five consecutive independent restarts of the retained overlay, without JFR or PostgreSQL
sampling, measured booking p95 of 863, 906, 897, 894 and 859 ms. Their p99 values were 871, 919,
907, 953 and 900 ms. Every restart passed the unchanged latency, outcome and cleanup thresholds.
These results cover the first twenty booking attempts after startup and authentication, not
capacity under a sustained workload. Contention summaries report booking latency directly;
authentication and setup requests do not dilute that percentile.

A subsequent cold run measured 960 ms p95; its warm repeat measured 329 ms. A one-minute,
two-user protocol smoke then measured read p95 of 24 ms and booking p95 of 75 ms, with both
users authenticated, no refused login attempt and no technical or server error. Its 339 request
samples contained no raw URL tags; eleven cancellations shared one request name and check label.

These twenty-request experiments are diagnostic evidence, not an approved baseline or
qualification of the complete branch image. Raw summaries, HTML reports, PostgreSQL samples and
container-identity checks remain in the ignored `build/validation-evidence` directory of the
performance worktree and `build/performance/follow-up` on the runner. UAT identities, start times
and health stayed unchanged; the disposable stack was stopped after each run.

The complete packaged image subsequently measured 936 ms p95, then failed at 1,012 ms on its
second cold restart. A JFR diagnostic found approximately 78 ms query-plan and class-loading
monitor waits in the account-scoped idempotency lookup. Startup now executes that unchanged
repository lookup once in a read-only transaction with a sentinel account and key, discarding
the result. It writes no booking and caches no mutable rule or booking value. Database failure
prevents readiness. Real PostgreSQL tests verify the read-only transaction and failure path.

The first diagnostic run with lookup preparation still failed at 1,054 ms. Five subsequent
independent restarts measured p95 of 811, 705, 955, 812 and 845 ms, with p99 of 826, 753, 1,033,
827 and 919 ms. All five passed the unchanged outcome, latency and cleanup gates. These runs
used a one-class overlay on the complete image; qualification of a newly packaged image remains
separate. Failures remain part of the evidence rather than being replaced by warm repeats.

A fresh complete image with lookup preparation passed five cold restarts at 867, 890, 813,
980 and 949 ms p95, but the next run failed at 1,007 ms before load and stress could start.
The preparation now also executes the unchanged open-booking count query once, discarding its
result. Profiling additionally showed repeated query-plan construction while loading opening
hours. Both unpaged opening-hours repository reads now use fixed JPQL rather than newly built
criteria queries. This reuses query plans, not schedule values. A real PostgreSQL test requires
at least twenty plan-cache hits and twenty SQL reads across ten schedule loads; another verifies
that edited hours and newly scheduled weeks appear on the next read.

The sixth overlay run with reusable opening-hours plans still failed at 1,035 ms p95.
A subsequent JFR recording measured 932 ms cold and 258 ms warm. The remaining first-burst
monitor waits included about 80 ms in JPA validation provider discovery and about 69 ms in the
configuration coordination query plan. Validation preparation now also runs on the servlet
web-server initialization event under the servlet class loader, restoring the original thread
loader even on failure. It validates request and executable parameters without calling the
controller. The actual MVC binding validator is prepared as well. A native configuration-query
experiment retained the previous `FOR NO KEY UPDATE` mode and entity snapshot, but profiling
showed about 71 ms in native result-mapping class loading instead. It was not retained.

The original JPQL coordination query is prepared once after application runners and before
readiness accepts traffic. It runs in an independent transaction with a ten-second timeout,
always marked rollback-only. The existing singleton is locked and read, then the lock is
released without a data change. Real PostgreSQL tests require rollback completion, immediate
lock reacquisition, rollback of an unexpected test write and isolation from an ambient read-only
transaction. Missing configuration propagates as a startup failure. Normal booking/configuration
transactions still use the original coordination query and lock mode.

These preparations alone did not qualify the two-CPU cold-start profile. Its fifth subsequent
restart failed at 1,071 ms p95. JFR recordings showed background C2 compilation competing with
the first booking burst. A diagnostic that disabled C2 passed three cold restarts at 462, 459
and 464 ms p95, but did not establish its steady-state throughput. It is not a deployment setting.
Keeping the normal compiler and raising only the application ceiling to three CPUs passed ten
independent cold restarts at p95 between 544 and 774 ms, with p99 between 563 and 784 ms.
Every restart retained one creation, nineteen typed conflicts, cleanup and zero technical errors.
These were class-overlay diagnostics, not qualification of a freshly packaged branch image.
The new reference profile therefore declares three application CPUs in both Compose and the
measurement contract. Historical two-CPU measurements remain a separate comparison profile.
The CPU ceiling does not reserve cores exclusively. The memory, database, connection-pool and
authentication limits are unchanged; full-image load and stress qualification remains required.

Initial budgets are p95 500 ms and p99 1,000 ms for read-only APIs, p95 750 ms for login, and p95
1,000 ms plus p99 2,000 ms for booking. Technical errors remain below one percent and unexpected
server errors remain zero. Browser results use p75 budgets of 2,500 ms LCP, 200 ms INP, and 0.1 CLS.
These are explicit starting budgets; changing them requires a reviewed contract change rather than
an automatic adjustment to a slow run. Shared-runner smoke reports retain latency measurements but
do not fail on absolute latency budgets because runner variation is not a product regression.

## Comparable resources

Reference runs constrain the application to 3 CPUs and 1,024 MiB, PostgreSQL to 2 CPUs and 2,048
MiB, and Caddy to 0.5 CPU and 256 MiB. Observability services run outside those application budgets.
Prometheus is limited to 1 CPU and 2,048 MiB, with memory plus swap capped at the same size.
Grafana is limited to 0.5 CPU and 512 MiB; the PostgreSQL exporter to 0.25 CPU and 128 MiB.
These collectors and the load generator still compete for host resources. Changing their budgets
during a run prevents treating the profiles as directly comparable regression references.
A result also records the contract version and digest, application version, commit, k6 version,
operating system, architecture, runner processor count and memory, profile, verified environment
marker, target, start time, duration,
actual dataset, read/write shares, virtual users or stages, and resource limits. A profile name alone
does not establish comparability because its configuration may change in a later contract.

A run does not become a baseline automatically. Raw HTML, JSON, and time-series output belongs
below the git-ignored `build/performance` directory or in workflow artifacts. Only a deliberately
reviewed, compact result without machine identity or network details may become a tracked baseline.

## Safety contract

Protocol, browser, and write scenarios run only against the isolated environment marker
`PERFORMANCE`. The default system target is its Caddy boundary; direct application access exists
only for diagnosis. Creating or deleting performance data requires the exact disposable
confirmation `courtside-perf`.

## Isolated environment

The CLI creates the reference dataset in the independent `courtside-perf` Compose project:

```text
node tools/courtside.mjs perf
node tools/courtside.mjs perf --telemetry
node tools/courtside.mjs status perf
node tools/courtside.mjs perf-logs
node tools/courtside.mjs perf-stop
node tools/courtside.mjs perf-reset courtside-perf
```

`perf` verifies the source, builds the local image, and starts PostgreSQL 18, the application, a
Mailpit relay, and a dedicated Caddy boundary. The application is available at
`https://localhost:9443`; its local CA is intentionally disposable. The CLI generates one shared
password, stores it only in the ignored `build/perf-environment.json` with owner-only permissions
where supported, and creates the accounts `member0001` through `member1000`. Account `member1000`
is reserved for contention workloads.

### What a run pays for mail

A confirmed booking hands a message to a relay, and the executor that carries it has four threads,
a queue of a hundred, and a rejection policy that makes the caller do the work itself. Once that
queue is full the handover time is inside the request, so where mail goes is part of what the
`booking` threshold measures rather than a detail beside it.

The environment therefore runs a Mailpit relay on the `backend` network and points the application
at it over STARTTLS, with a certificate the CLI issues per start into the ignored `build/perf-mail`
for 30 days rather than the one day the restore smoke uses, because this stack is left standing
between runs; the application is told to trust the relay and so checks neither the issuer nor the
dates, which makes the longer life hygiene rather than what keeps the stack working. Handover
succeeds in milliseconds and the message is kept in the relay's memory and never delivered
anywhere. **A load run measures an instance whose relay accepts**, which is what a club with a
working mail server sees; it does not measure an instance that skips mail, and it does not measure
one whose relay is refusing.

That last case is not hypothetical. The environment previously pointed at `mail.invalid`, a name
RFC 2606 reserves so that it never resolves. Every message then walked the whole retry ladder --
four attempts with five, fifteen and forty-five second pauses -- and because the seed creates far
more messages than the queue holds, the seeding thread itself waited sixty-five seconds per
message. The dataset never finished and the environment never became healthy.

`--telemetry` adds Prometheus and a PostgreSQL exporter to the isolated project. Prometheus is
available only on `http://127.0.0.1:9090`; the exporter and the application's management port have
no host binding. Prometheus scrapes JVM, GC, threads, HTTP server requests, Hikari pool state,
PostgreSQL activity, connections, and locks every five seconds and retains data for seven days.
Use the run start time from the result to select the corresponding time range. The telemetry volume
is disposable and is removed by `perf-reset courtside-perf`.

Grafana is provisioned with the read-only Courtside performance dashboard at
`http://127.0.0.1:3000`. It correlates application latency and throughput, JVM and GC state, Hikari,
PostgreSQL, and optional k6 time series. Both local observability UIs are loopback-only and Grafana
allows anonymous viewing solely within that boundary; it has no editable dashboards or login form.
Its root filesystem stays read-only, with a writable 256 MiB `/tmp` tmpfs for plugin installation.
The Prometheus datasource plugin is installed synchronously at startup, with automatic plugin
updates disabled. Startup therefore requires access to the plugin distribution service when the
plugin is not already installed in the Grafana volume.

When interpreting a successful run, inspect login failures separately from the overall request
error rate. Read-heavy traffic can hide substantial authentication retries, and login request
latency does not measure the elapsed time until authentication succeeds. A shared source address
also exercises per-address protection rather than independent client arrivals. Do not relax login
protection or enlarge the database pool based on the aggregate pass alone.

Protocol request labels and check names group booking IDs under `/api/bookings/:id`; dated booking
reads share `GET /api/bookings`. Raw URL, per-VU and per-iteration system tags are disabled, while
method, status, name, group and check tags remain available. This bounds series growth from booking
IDs and dates, without changing the actual request URLs or accepting failed requests. Existing
series remain until retention or an explicit disposable telemetry reset removes them.
Inspect retained series and collector memory when using remote write. A larger Prometheus budget
is not proof that a long soak will fit. Likewise, a ramp reaching 200 VUs is not a sustained 200-VU
test, and a report with no booking conflicts does not qualify concurrent booking contention.

The ordinary HTTPS endpoint does not expose Actuator. UAT, its Funnel ingress, and the production
reference deployment do not enable Prometheus or the exporter. Database and exporter credentials
come from the generated runtime state and are never stored in Compose files.

PostgreSQL has no host port by default. Use `perf --db-port` to expose it temporarily at
`127.0.0.1:5434`, or use `perf-db-shell` without exposing it. The reset command requires the exact
project name and removes only the performance containers, volumes, local CA, and credential state.
Dev, UAT, and their Funnel configuration are not addressed by any performance command. The same
Node command plans and Docker Compose files are used on macOS, Linux, and Windows.

Protocol runs use the pinned official k6 image and write a self-contained `report.html`, the raw
`raw-summary.json`, and a schema-validated `summary.json` below
`build/performance/<profile>/<timestamp>`:

```text
node tools/courtside.mjs perf-run smoke
node tools/courtside.mjs perf-run contention --confirm courtside-perf --remote-write
node tools/courtside.mjs perf-run baseline --confirm courtside-perf
node tools/courtside.mjs perf-run peak --confirm courtside-perf
node tools/courtside.mjs perf-run stress --confirm courtside-perf
node tools/courtside.mjs perf-run soak --confirm courtside-perf --fresh
node tools/courtside.mjs perf-run browser --confirm courtside-perf
```

Append `--remote-write` to a protocol run to send an additional time series to the local
Prometheus instance. The option is accepted only after `perf --telemetry`; HTML and JSON remain the
authoritative outputs because the k6 Prometheus remote-write output is experimental. Every series
is tagged with the run id and profile for dashboard correlation.

The CLI verifies `/api/source` before starting k6 and refuses any target that does not identify as
`PERFORMANCE`. Profiles, durations, VUs, stages, traffic mix, image digest, and thresholds come from
the contract and cannot be overridden on the command line. Baseline, peak, stress, and soak require
the disposable project confirmation; soak also requires an explicit assertion that the
environment was freshly reset. Funnel uses a separate runner.

The browser profile uses the pinned official Chromium image and is capped at five VUs for ten
minutes. Each VU signs in through the rendered PWA with its own synthetic account, navigates the
week through language-neutral test hooks, creates a booking through the real browser session and
CSRF token, verifies the allocation, reloads the PWA, and proves that the session remains active.
The booking is cancelled during cleanup. This complements rather than replaces Playwright's
functional E2E suite.

Browser reports retain p75 LCP, INP, and CLS against the contract budgets, failed browser requests
and console errors, the complete-journey success rate, and average journey duration. Their profile
and metrics remain distinct from protocol results. Since a full browser run is resource-intensive
and intentionally manual, it requires the disposable environment confirmation.

Each VU logs in with its corresponding `memberNNNN` account and the generated password mounted
read-only from local state. Login latency is measured separately. Normal iterations use the agreed
90/10 read/write mix; writes create and cancel bookings in VU-specific slots. On the first
iteration, at most the workload's configured contention VUs claim one known-free slot. Only a `409`
with the stable `court-unavailable` problem type increments `booking_conflicts` and the conflict
ratio without becoming a technical failure. Other `409` responses, unexpected 5xx responses, and
all other unexpected statuses remain technical failures and participate in thresholds that make k6
exit non-zero. Every run uses unique idempotency keys.

The CLI exports Caddy's disposable root CA for the duration of a run. Both the environment preflight
and k6 validate the certificate chain and hostname against that CA; the test does not disable TLS
verification. Chromium receives only the SPKI pin from that verified target certificate, rather
than a general instruction to accept invalid certificates.

The browser journey uses the earliest enabled slot on its VU's dedicated court, checking the
selected day and the remaining current-week days before a single next-week fallback. It fails
explicitly if neither week offers an enabled slot. It expands the additional booking
fields and waits for the guest input to be visible before filling it. This keeps the UI request
within the fixture card's advance window and includes the required second participant without
bypassing the UI or weakening booking rules. The journey awaits the eligibility response and its
interactive rendering before searching; a week switch awaits a date selector from the newly
loaded week. The two-week search itself does not override or independently validate booking rules.

## Reference baselines

Only a successful authoritative `baseline`, `browser`, or `soak` result using the current
performance contract can be promoted. The explicit command validates the result schema and every
threshold before creating a new, non-overwriting versioned file below the profile's directory in
`performance/baselines`:

```text
node tools/courtside.mjs perf-promote build/performance/<profile>/<run>/summary.json --confirm courtside-perf
```

The stored summary contains only contract-approved build, runtime, load, resource, threshold, and
metric fields. Credentials, hostnames, remote URLs, identities, and addresses cannot pass the
closed result schema. Failed and stale-contract results are rejected and never replace a baseline.

Compare a new result with an approved baseline only on the same controlled runner:

```text
node tools/courtside.mjs perf-compare build/performance/baseline/<run>/summary.json \
  --baseline performance/baselines/baseline/<approved>.json \
  --output build/performance/baseline/<run>/comparison.json
```

The comparison fails closed when either result does not use the current contract, or when profile,
observed duration, target, environment, k6 runtime, operating system, architecture, runner capacity,
dataset, load shape, or container resource budgets differ. A reference with failed thresholds or a
non-reference profile is also rejected. The reviewed policy in
[`../performance/regression-policy.json`](../performance/regression-policy.json) classifies a p95
or p99 latency increase above 15 percent, a throughput decrease above 10 percent, a technical error
rate increase above 0.5 percentage points, or any additional unexpected server error as a
high-severity regression owned by the performance maintainer. The JSON comparison contains only
build identities, aggregate metric values, limits, classification, and ownership; raw targets,
credentials, identities, and machine names are excluded.

Run baseline and browser profiles monthly and before a release on the same controlled host. Run a
fresh-environment soak quarterly and before a release that changes booking persistence, sessions,
database access, or resource configuration. Retain their summary, comparison, HTML report, and the
matching telemetry interval. Review JVM and container memory, garbage collection, Hikari usage,
PostgreSQL connections and locks, database growth, and changed query plans alongside the automated
latency, throughput, error, journey, and Web Vitals decision. Shared hosted runners remain suitable
only for bounded smoke diagnostics and cannot approve or reject a performance baseline.

## Automation and approved baselines

The `performance smoke` workflow runs weekly and on explicit dispatch. It creates only the local
disposable performance environment, executes the bounded two-VU smoke profile, and uploads HTML and
JSON reports for fourteen days even when the run fails. It has no pull-request trigger, accepts no
target input, and never promotes a baseline. Pull requests continue to use the deterministic build
workflow as their required gate.

An approved reference comes from the `baseline`, `browser`, or `soak` profile on a documented local
or dedicated runner whose processor count, memory, operating system, and architecture remain
comparable. Review the successful report and its resource metadata before using `perf-promote`;
shared hosted runners are diagnostic smoke environments and do not produce references.

Remote targets require a separate opt-in and cannot use ordinary load profiles. Production targets,
persistent UAT writes, tracked credentials, tracked remote targets, and ordinary overrides of VU or
duration caps are forbidden. Runtime credentials identify individual synthetic accounts but may
share one generated environment password.

Every result reports the two mandatory technical threshold outcomes. Reference load profiles
also report read-only, login, and booking budgets; browser results report Web Vitals; Funnel
smoke reports the read-only budget. The closed result schema rejects unknown threshold names,
missing evidence, unrecorded load parameters, and profile/target/environment combinations outside
the contract.

The Funnel smoke accepts an explicitly supplied UAT URL, performs read-only checks, and neither
opens nor closes Funnel. It does not log or retain the target. Login, booking, cancellation, and all
other mutations are outside that profile. Funnel lifecycle and cleanup remain owned by the attached
`uat share` command.

Start UAT and keep its share command attached in one terminal:

```text
node tools/courtside.mjs uat share
```

Copy the displayed public HTTPS origin into a second terminal and confirm the dedicated remote
profile explicitly:

```text
node tools/courtside.mjs perf-run funnel-smoke --target https://public-name.example.ts.net --confirm courtside-uat-funnel
```

The command accepts only a bare public HTTPS origin on port 443. Before creating result files it
requires `/api/source` to identify a versioned UAT build. The fixed two-VU, two-minute journey checks
the HTML shell and one generated asset, PWA manifest, public configuration, booking grid and CSRF
cookie creation. It also proves that Swagger UI, OpenAPI and Actuator return `404` through the public
ingress. Its sanitized HTML and JSON reports contain aggregate measurements and build identity, but
not the supplied hostname. Stop sharing with `Ctrl+C` in the attached `uat share` terminal; the
performance command never changes Funnel or UAT lifecycle state.
