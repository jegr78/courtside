# Performance testing

Courtside defines its load shapes, thresholds, resource budgets, and safety boundaries in
[`../performance/contract.json`](../performance/contract.json). Test runners consume that file;
scenario scripts must not carry independent copies of the same values. Machine-readable results
conform to [`../performance/result.schema.json`](../performance/result.schema.json).

The pinned k6 images are the official protocol and browser variants for the version named in the
contract. Each readable version tag is bound to an approved multi-architecture OCI index digest;
the runner must reject a registry result with another digest. Docker is the default execution
boundary so macOS, Linux, Windows, and automation use the same k6 runtime. A native k6 installation
is optional and must match the contract version before it can produce a comparable result.

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
| `soak` | Detect leaks and pool exhaustion. | 50 VUs for 2 hours on a fresh environment. |
| `browser` | Measure PWA journeys and Web Vitals. | At most 5 browser VUs for 10 minutes. |
| `funnel-smoke` | Verify the public transport and PWA path without load. | Read-only, at most 2 VUs for 2 minutes. |

Only `smoke` is suitable for routine automation. Baseline, peak, stress, soak, and browser runs are
manual until a dedicated runner provides stable resources. The Funnel profile is always manual and
requires an operator to supervise `uat share` separately.

## Result semantics

Technical request failures and unexpected server errors determine test health. An expected booking
conflict is a domain outcome with status `409` and increments `booking_conflicts`; it is not a
transport failure. Reports include p50, p90, p95, p99, throughput, iteration and request counts,
technical error rate, server-error count, threshold results, and optional conflict and Web Vitals
metrics.

Initial budgets are p95 500 ms and p99 1,000 ms for read-only APIs, p95 750 ms for login, and p95
1,000 ms plus p99 2,000 ms for booking. Technical errors remain below one percent and unexpected
server errors remain zero. Browser results use p75 budgets of 2,500 ms LCP, 200 ms INP, and 0.1 CLS.
These are explicit starting budgets; changing them requires a reviewed contract change rather than
an automatic adjustment to a slow run.

## Comparable resources

Reference runs constrain the application to 2 CPUs and 1,024 MiB, PostgreSQL to 2 CPUs and 2,048
MiB, and Caddy to 0.5 CPU and 256 MiB. Observability services run outside those application budgets.
A result also records the contract version and digest, application version, commit, k6 version,
operating system, architecture, profile, verified environment marker, target, start time, duration,
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

`perf` verifies the source, builds the local image, and starts PostgreSQL 17, the application, and
a dedicated Caddy boundary. The application is available at `https://localhost:9443`; its local CA
is intentionally disposable. The CLI generates one shared password, stores it only in the ignored
`build/perf-environment.json` with owner-only permissions where supported, and creates the accounts
`member0001` through `member1000`. Account `member1000` is reserved for contention workloads.

`--telemetry` adds Prometheus and a PostgreSQL exporter to the isolated project. Prometheus is
available only on `http://127.0.0.1:9090`; the exporter and the application's management port have
no host binding. Prometheus scrapes JVM, GC, threads, HTTP server requests, Hikari pool state,
PostgreSQL activity, connections, and locks every five seconds and retains data for seven days.
Use the run start time from the result to select the corresponding time range. The telemetry volume
is disposable and is removed by `perf-reset courtside-perf`.

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
node tools/courtside.mjs perf-run baseline --confirm courtside-perf
node tools/courtside.mjs perf-run peak --confirm courtside-perf
node tools/courtside.mjs perf-run stress --confirm courtside-perf
node tools/courtside.mjs perf-run soak --confirm courtside-perf --fresh
```

The CLI verifies `/api/source` before starting k6 and refuses any target that does not identify as
`PERFORMANCE`. Profiles, durations, VUs, stages, traffic mix, image digest, and thresholds come from
the contract and cannot be overridden on the command line. Baseline, peak, stress, and soak require
the disposable project confirmation; soak additionally requires an explicit assertion that the
environment was freshly reset. Browser and Funnel profiles have separate runners in later work.

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
verification.

Remote targets require a separate opt-in and cannot use ordinary load profiles. Production targets,
persistent UAT writes, tracked credentials, tracked remote targets, and ordinary overrides of VU or
duration caps are forbidden. Runtime credentials identify individual synthetic accounts but may
share one generated environment password.

Every result reports the two mandatory technical threshold outcomes. Protocol profiles additionally
report read-only, login, and booking budgets; browser results report Web Vitals; Funnel smoke reports
the read-only budget. The closed result schema rejects unknown threshold names, missing evidence,
unrecorded load parameters, and profile/target/environment combinations outside the contract.

The Funnel smoke accepts an explicitly supplied UAT URL, performs read-only checks, and neither
opens nor closes Funnel. It does not log or retain the target. Login, booking, cancellation, and all
other mutations are outside that profile. Funnel lifecycle and cleanup remain owned by the attached
`uat share` command.
