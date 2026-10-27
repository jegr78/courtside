# Local environments

The separate load-model, threshold, and safety contract is documented in
[`performance-testing.md`](performance-testing.md).

The repository CLI provides a disposable development environment and an isolated, persistent UAT
environment on macOS, Linux, and Windows. Run all commands from the repository root with Node.js
24, Eclipse Temurin 25, and a running Docker engine with the Compose plugin.

On macOS or Linux, point Maven at Java 25 when it is not the default:

```bash
export JAVA_HOME=/path/to/temurin-25
```

On Windows PowerShell, set it for the current session instead:

```powershell
$env:JAVA_HOME = "C:\path\to\temurin-25"
```

## Commands

| Command | Result |
|---|---|
| `node tools/courtside.mjs build` | Builds the application and frontend without running tests. |
| `node tools/courtside.mjs verify` | Runs the complete Maven, frontend, integration, and E2E quality gate. |
| `node tools/courtside.mjs check` | Classifies all local changes against `origin/main` and runs the required local quality profile. |
| `node tools/courtside.mjs check --plan` | Prints and records the selected profile without running its tasks. |
| `node tools/courtside.mjs check --full` | Escalates any local classification to the complete quality gate. |
| `node tools/courtside.mjs dev` | Starts the Dev database, API UI, Spring Boot, and Vite. |
| `node tools/courtside.mjs dev-debug` | Starts Dev and listens for a backend debugger on `127.0.0.1:5005`. |
| `node tools/courtside.mjs dev-debug --suspend` | Waits for the backend debugger before application startup. |
| `node tools/courtside.mjs dev-stop` | Stops the Dev containers without deleting their database. |
| `node tools/courtside.mjs dev-reset` | Stops Dev and deletes its database volume. |
| `node tools/courtside.mjs uat` | Verifies source, builds a local image, and starts UAT. |
| `node tools/courtside.mjs uat --skip-verify` | Builds and starts local source without the quality gate. |
| `node tools/courtside.mjs uat --version <tag>` | Runs an exact published GHCR version instead of local source. |
| `node tools/courtside.mjs uat --db-port` | Starts UAT and exposes PostgreSQL on loopback port 5433. |
| `node tools/courtside.mjs uat share` | Starts UAT when needed and shares it temporarily through Tailscale Funnel. |
| `node tools/courtside.mjs uat-stop` | Stops UAT without deleting its database or local CA. |
| `node tools/courtside.mjs uat-logs` | Follows all UAT container logs, including the proxy's access and error entries without query strings, headers or full client addresses. |
| `node tools/courtside.mjs uat-db-shell` | Opens `psql` inside the private UAT database container. |
| `node tools/courtside.mjs uat-cert [file]` | Exports the UAT root certificate and prints trust instructions. |
| `node tools/courtside.mjs uat-backup [file]` | Creates a private complete backup directory with a PostgreSQL dump and matching MFA key archive. |
| `node tools/courtside.mjs uat-restore <file> --confirm courtside-uat` | Validates a complete backup or legacy dump in an isolated environment before replacing the UAT database. |
| `node tools/courtside.mjs uat-seed-bookings` | Previews additive sample bookings against the existing UAT database. |
| `node tools/courtside.mjs uat-seed-bookings --confirm courtside-uat` | Backs up UAT and adds the previewed sample bookings. |
| `node tools/courtside.mjs uat-reset courtside-uat` | Deletes the UAT database but retains its MFA keys, key configuration and local CA. |
| `node tools/courtside.mjs uat-reset courtside-uat --all` | Deletes the UAT database, MFA keys and local CA. |
| `node tools/courtside.mjs status dev` | Reports Dev health, processes, ports, containers, and volumes. |
| `node tools/courtside.mjs status uat` | Reports UAT health, ports, containers, and volumes. |
| `node tools/courtside.mjs status <dev\|uat> --json` | Emits the same status as JSON. |

`node tools/courtside.mjs help` prints the command synopsis. The destructive automated UAT
lifecycle check is `npm --prefix frontend run test:uat -- --confirm courtside-uat`; it removes the
entire UAT environment when it finishes.

The CLI controls Spring profiles deliberately: `dev` and `dev-debug` activate `demo`, UAT runs the
default application profile, and Maven activates test configuration only inside the automated test
suite. Do not enable `demo` in UAT or production.

## Pull-request verification

Run `node tools/courtside.mjs check` before the final push. It refreshes `origin/main`, finds the
merge base, requires a clean committed HEAD, and classifies its changes with
`ci/test-profiles.json`, the same contract protected pull-request CI uses. Documentation changes
need only clean change evidence. Backend changes run the Java profile; frontend changes run lint,
unit tests, build, audit, application packaging and browser journeys. A mixed change runs both
profiles. Added tool tests use the tooling profile when the same change only appends their complete
manifest entries; runners and helpers remain full, except the security environment's own tools,
whose profile runs the tool suite, the qualification and the active security gate on an image
packaged from the change. The reference deployment guide uses the documentation profile. Build, workflow, security, executable deployment, database, OpenAPI, shared
test-infrastructure, unknown and structural changes run the complete Maven verification, the
browser and WebKit reliability gates, and then the Docker release gates: qualification, Stalwart,
restore, upgrade and the active security assessment.

The command writes `build/local-check/result.json` with the base and head commits, a content
fingerprint, selected profiles, reasons, tasks and outcome. It checks out the recorded head in a
temporary detached worktree and runs every selected task there. Edits in the live workspace cannot
change that source or invalidate the result. The temporary worktree is removed after success or
failure. If `origin/main` cannot be refreshed, classification falls back to `full`. `--full` only
escalates. It cannot suppress a required task.

## Development

Start Dev with `node tools/courtside.mjs dev`. It runs PostgreSQL and the API UI proxy in Docker,
then Spring Boot and Vite on the host. Stop the host processes with `Ctrl+C`. The containers and
database remain available until `dev-stop` or `dev-reset` is run.

| Service | Address |
|---|---|
| Web application with Vite HMR | `http://127.0.0.1:5173` |
| Backend API | `http://127.0.0.1:8080/api` |
| Swagger UI and same-origin API proxy | `http://127.0.0.1:8082/api-ui/` |
| PostgreSQL | `127.0.0.1:5432` |
| Backend debugger | `127.0.0.1:5005` with `dev-debug` |

Dev activates the `demo` Spring profile and confirms that its database is disposable. It creates
English placeholder data and local accounts `admin`, `jane.doe`, and `john.roe`. Their passwords
are `courtside-admin` and `courtside-member`, respectively. Neither UAT nor production activates
the demo profile.

Connect to Dev PostgreSQL with database `courtside_dev`, username `courtside`, password
`courtside-dev`, and JDBC URL `jdbc:postgresql://127.0.0.1:5432/courtside_dev`.

Dev delivers no mail. Its relay is `mail.invalid`, so a message such as a one-time password or a
recovery link is retried for about half an hour and then given up as failed.

## User acceptance testing

Start UAT with `node tools/courtside.mjs uat`. The default command verifies the current checkout,
builds its container image, and starts it as the `courtside-uat` Compose project. Its database and
Caddy certificate authority survive restarts and source rebuilds. UAT never loads demo data.
`COURTSIDE_UAT_PROJECT`, `COURTSIDE_UAT_LOCAL_IMAGE`, `COURTSIDE_UAT_HTTP_PORT`,
`COURTSIDE_UAT_HTTPS_PORT`, `COURTSIDE_UAT_SHARED_PORT` and `COURTSIDE_OPERATIONAL_LOG_PORT` name a
second instance; the local check's qualification gate uses them so it never touches this one.

On an empty database, the CLI prints the generated one-time password for the local `admin` account.
Change it at the first login. Later starts preserve that account and do not reset its password.

| Service | Address |
|---|---|
| Courtside | `https://localhost:8443` |
| Swagger UI | `https://localhost:8443/api-ui/` |
| HTTP-to-HTTPS redirect | `http://localhost:8081` |
| PostgreSQL with `--db-port` | `127.0.0.1:5433` |

Swagger UI and the API share the HTTPS origin. The UI reads the hand-written source-of-truth
contract served by the application at `/api/openapi.yaml`; no runtime contract is generated.

PostgreSQL stays inside the Compose network unless UAT is started with `--db-port`. For interactive
access without publishing a port, use `uat-db-shell`. External clients use database `courtside`,
username `courtside`, password `courtside-uat`, and JDBC URL
`jdbc:postgresql://127.0.0.1:5433/courtside`.

### Immutable local image qualification

The existing UAT smoke producer can qualify an already imported image on a native Linux host.
It does not build, pull, publish, or substitute an image. The clean checkout must have the exact
requested source commit. Image filesystem `git.properties`, image architecture, native host
architecture and the running container image must agree. The selected engine-native image ID
can differ from the observed container runtime image ID. Actual inspected metadata establishes
that mapping; neither ID certifies an OCI config or registry manifest digest.

The checkout and every evidence-directory ancestor, including ignored `build/` directories,
must be operator-owned and protected from foreign writers. This path assumes trusted filesystem
ancestors; it does not provide an adversarial no-follow guarantee for symlinks. Before native
candidate execution, resolve the checkout and evidence paths, reject symlink ancestors, and
verify ownership and private directory/file modes of `0700` and `0600`. The dedicated VM payload
must contain regular files.

Use a fresh `courtside-uat-qualification-<run>` project and four explicit, distinct ports. The
persistent UAT ports are refused. All pinned Compose dependencies must already exist locally.
The Docker endpoint must be the local default Unix socket.

```bash
COURTSIDE_UAT_HTTP_PORT=28081 COURTSIDE_UAT_HTTPS_PORT=28443 \
COURTSIDE_UAT_SHARED_PORT=28083 COURTSIDE_OPERATIONAL_LOG_PORT=21515 \
node tools/courtside.uat-smoke.mjs \
  --confirm courtside-uat-qualification-example \
  --image "sha256:<64-lowercase-hex>" --source-commit "<40-lowercase-hex>"
```

Replace both identity placeholders with the actual image ID and full source commit. This path
runs the existing deployment, authentication, booking-persistence and hardening checks.
It reserves its project, rejects existing or foreign resources and deletes only recorded owned
resources. It never queries or changes host Tailscale Serve or Funnel state. Changed source,
Compose configuration, ownership or image identity stops the lifecycle and refuses cleanup of
unproven resources. Inspect the private ownership evidence before any manual recovery.

The app and database each have a 1 GiB memory and swap ceiling, two CPUs and 256 PIDs. The native
application entrypoint and its heap policy remain unchanged. Dependency limits remain bounded
without removing the reference deployment's privilege or network restrictions. Each native
command has a 60-second watchdog and bounded output.
HTTP requests use loopback only, a 30-second absolute deadline and a 4 MiB response ceiling.
HTTPS uses the owned proxy CA with certificate and hostname verification enabled.

Private attempt, candidate, provenance and sanitized log artifacts are stored under
`build/immutable-qualification/<project>/`. The directory is fresh per attempt and mode `0700`;
JSON and log artifacts use `0600`. A passed `qualification.json` is written only after every
check, certificate-reuse verification and owned cleanup succeeds. A failed attempt records the
failing assertion, with the status and bounded body the server answered, in `attempt.json`.

The legacy smoke under `build/uat-smoke/` removes an earlier `qualification.json` and
`lifecycle.log` before it starts, and writes `qualification.json` in both outcomes: a failed run
records `status: "failed"` and the redacted failure. It keeps the redacted output of `uat` and
`uat-reset` in `lifecycle.log`. The local release gates and the passive security assessment
accept only a receipt with `status: "passed"`.

### Immutable PERFORMANCE and SECURITY reuse

Select two distinct, locally imported engine-native IDs and the exact full source commit.
The fixture image must contain the complete production layer sequence plus exactly one fixture
layer and preserve its native configuration. The proof compares actual image file hashes with
the checkout's existing compiled and packaged artifacts, including the fixed SECURITY helpers.
These artifacts must already exist. A dirty checkout, stale helper, changed application byte,
remote engine or missing dependency refuses the explicit path.

```bash
node tools/courtside.mjs perf --image "sha256:<production-engine-id>" \
  --fixtures-image "sha256:<fixture-engine-id>" --source-commit "<40-lowercase-hex>"
node tools/courtside.mjs security example-run --image "sha256:<production-engine-id>" \
  --fixtures-image "sha256:<fixture-engine-id>" --source-commit "<40-lowercase-hex>"
node tools/courtside.mjs security-seed example-run "sha256:<production-engine-id>" \
  --state build/security/example-run/environment.json
```

Each engine ID placeholder represents 64 lowercase hexadecimal characters after `sha256:`.
Both flags are required together with the production selection. `--skip-verify` cannot be used
with immutable reuse. Existing starts without this selection retain their build behavior.
The explicit path never falls back to a build or pull. Its pinned dependencies and PERFORMANCE
runner must also be available locally.

PERFORMANCE retains the fixture proof, owned Compose override, resource identities and startup
telemetry in private local state. `perf-run` checks actual runtime identity before and after
traffic and compares the TLS source commit with the selected commit. `perf-reset courtside-perf`
checks the retained proof and ownership before removing the project and reservation. SECURITY
persists its selection in private run state; `security-seed` revalidates that proof and the app
runtime instead of rebuilding a fixture. Recovery checks ownership and retained image mapping.
Both lifecycles retain imported production and fixture images.

Missing or corrupt PERFORMANCE state cannot select a legacy reset, stop, logs or DB-shell
while an immutable override or reservation remains.
Legacy PERFORMANCE starts are refused until the owned immutable reset succeeds; an override cannot bypass this refusal.
SECURITY retains exact container IDs and effective Config/HostConfig and rejects same-image replacements or configuration drift before
seed, verification and cleanup. UAT checks initial effective settings against rendered Compose;
only the planned bootstrap app recreation may introduce its replacement container.

Image proof has a 120-second monotonic budget with at most 256 commands, each limited to ten
seconds and 4 MiB output. PERFORMANCE startup has a 180-second monotonic budget. SECURITY
startup and seed commands have a 180-second watchdog. Existing resource caps, TLS deployment
and network isolation remain in effect. A passing pure test is not native qualification;
the selected production subject still needs the existing four-check qualification receipt.

Probe cleanup has its own 30-second budget and verifies the exact CID and owner before removal.
Proof failures retain their original error and write a private, non-qualifying cleanup receipt
under `build/immutable-image-reuse-failures/`; the CLI reports the bounded cleanup outcome and
whether that receipt was retained. Immutable PERFORMANCE TLS identity requests retain CA and
hostname validation and enforce a 30-second absolute deadline and 4 MiB response limit.

### Sample booking history

Run `node tools/courtside.mjs uat-seed-bookings` first. This is a read-only preview that reports
planned bookings, bookings already present, scheduling conflicts, and booking types for which the
current accounts have no eligible role. The plan spans eight weeks in the past and twelve weeks in
the future. It includes singles, doubles, guest and ball-machine bookings, weekday training series
on two courts, fortnightly weekend league-match series on every active court, and court closures.

Apply the plan with
`node tools/courtside.mjs uat-seed-bookings --confirm courtside-uat`. The command creates a
timestamped UAT backup before writing. It reads the existing active courts, current memberships,
enabled accounts, and roles; it neither creates nor changes any of them. Existing bookings are
also retained. Conflicting sample occurrences are skipped, and deterministic fixture identifiers
make repeated runs idempotent. The one-shot fixture image is derived from the UAT image recorded by
the CLI and is not used by the running application or production image.

### Local TLS trust

Run `node tools/courtside.mjs uat-cert` to write the root CA to
`build/courtside-uat-root.crt`, or supply another output path. The command prints the exact trust
command for the current operating system. Trusting the CA removes browser and REST-client warnings;
it changes the system trust store and may require administrator rights. Remove the certificate from
the trust store when it is no longer needed. A normal UAT reset retains the CA, while `--all`
deletes it and the next start creates a new certificate.

### Temporary public sharing

`node tools/courtside.mjs uat share` performs a read-only Tailscale preflight before changing
anything. The device must be connected to Tailscale, MagicDNS and HTTPS certificates must be
enabled, and the tailnet policy must grant the device the `funnel` capability. Configure these
prerequisites in the Tailscale administration console; Courtside neither stores a Tailscale API
token nor changes tailnet policy.

The command refuses to start when any foreign Serve or Funnel handler exists. It never replaces or
resets another application's configuration. A successful session stays attached to the terminal
and prints its public `https://*.ts.net/` address. Press `Ctrl+C` to remove the public route while
leaving the UAT containers and persistent database running. `uat-stop` and both `uat-reset` modes
also remove a Courtside-owned route. A cleanup failure exits with an error and identifies the
manual `tailscale funnel reset` recovery command; verify ownership before running it.

Funnel reaches a dedicated Caddy listener bound to `127.0.0.1:8083`. It exposes the PWA and its
application API, replaces forwarded headers, preserves the outer HTTPS request context, adds
security and no-index headers, and returns `404` for `/api-ui`, `/api/openapi.yaml`, and
`/actuator`. PostgreSQL remains private. Ordinary `uat` startup never enables Funnel.

The Funnel URL is public internet access, not tailnet access control. Use only synthetic data and
individual test accounts, never production data, personal data, or a shared administrator account.
All public requests currently reach application-level address throttling through the trusted proxy
boundary; do not assume that this represents an end user's public address. The global login limit
remains the dependable protection until client-address behavior has been verified against the
installed Tailscale version.

An exit node does not publish UAT. It is optional client-side test infrastructure for checking how
Courtside behaves through another network or geographic egress. Funnel is the mechanism that makes
the temporary UAT address reachable by testers who are not tailnet members.

For release verification on macOS, Linux, and Windows, run `uat share` in a terminal, open the
reported URL in a browser on a device that is not a tailnet member, install or launch the PWA, and
complete login, CSRF-protected changes, navigation, and sign-out. Confirm that `/api-ui/`,
`/api/openapi.yaml`, and `/actuator/health` return `404`. Press `Ctrl+C`, verify that the local UAT
site and its data remain available, and use `status uat` to confirm that Funnel reports `none`.
Repeat `uat-stop` with an active Courtside share and confirm the same cleanup before treating that
platform as verified.

### Persistence and recovery

`uat-stop` keeps the database, MFA keys and local certificate volumes. `uat-backup` defaults to a
timestamped private directory below `build/backups`; an explicit unused destination is also
accepted. It contains `database.dump` and `mfa-keys.tar`. Keep both files protected and together.
Restore requires the exact confirmation `--confirm courtside-uat`. It first restores into an
isolated database and key volume and waits for the same application's key validation to pass.
Only then does it stop the target app, import matching keys and restore the target database
transactionally. It restarts the target even when that restore fails.

A legacy `.dump` file remains accepted. Its validation uses the target's current keyring. Dumps
from before MFA initialize keys automatically. Encrypted TOTP enrollments require their matching
retained keys. Missing or wrong keys stop validation before the target database changes. An
existing different keyring is never overwritten. After rotation, supply the current retained-key
archive or restore into a fresh environment rather than replacing it with an older key snapshot.

For an operator-provided keyfile, backup captures the configured container file as
`provided/mfa.keys`. Restore validates it with the same application's explicit keyfile setting and
records the restored path for future starts. A custom existing target path must contain the same
keyring or the restore stops before changing the database. Mount a private writable parent
directory for a custom keyfile so locking and atomic rotation can work. The recovered default
location is inside the private key volume.

`uat-reset courtside-uat` deletes only the database and keeps the keys, configured keyfile and local
CA. The new database receives a new installation UUID. With automatic keys it initializes its own
keyring, and with an operator-provided keyfile it keeps that selected keyring. Retained keys still
permit a deliberate restore of the previous database. `--all` discards every volume,
including keys and the CA. Save a complete backup before that reset if you need to recover the data.

Local HTTPS sets the trusted WebAuthn origin to `https://localhost:<configured-https-port>`.
`uat share` changes it to the verified Tailscale DNS origin and recreates the app before exposing
the share. Stopping the share restores the local origin. Credentials registered at one hostname
remain bound to that hostname. Use another enrolled factor or a recovery code to sign in at the
other hostname and enroll a device there.

A share's marker binds its project, shared port, local HTTPS port and Tailscale node. Readiness and
Funnel target the selected project's configured shared port. Readiness verifies the selected
Compose proxy's container identity, ownership and published loopback port before probing HTTP.
Tailscale permits only one active
Courtside share per node. Another UAT project's stop or reset leaves that share and its origin
unchanged. Starting a share refuses a foreign or stale association, and cleanup refuses changed
ports or ownership instead of resetting another instance's Funnel.

For the same server-access maintenance paths in UAT, use:

```sh
node tools/courtside.mjs uat-mfa-recover --account-id <account-uuid> --identity-checked
node tools/courtside.mjs uat-mfa-correct-email --account-id <account-uuid> --identity-checked --email-file /private/corrected-email
node tools/courtside.mjs uat-mfa-rotate-keys
```

The account operations require the external identity check. The email input is a private
operator-owned mode-`0600` UTF-8 file, at most 254 bytes plus an optional final newline. UAT sends
its content only through standard input to the maintenance container's private tmpfs. Create the
file without hard links in a private mode-`0700` directory. Every parent must belong to the
operator or root and prevent writes by other users. A root-owned sticky temporary directory is
accepted when its direct child is the operator's private directory. The launcher validates the
opened descriptor and keeps reading that descriptor if the path changes. The
commands reuse the recorded image, database and key configuration. Take a complete backup before
and after key rotation. The database must already be running.

## Bruno API collection

Open [`../bruno`](../bruno) as a collection in Bruno and select the `Dev` or `UAT` environment.
The requests cover public configuration, CSRF acquisition, login, authenticated session state, and
logout. Run them in sequence because Bruno's cookie jar carries the CSRF and session cookies.

Create private runtime variables named `username` and `password` in Bruno before login. The CSRF
request derives `csrfToken` in memory from the response cookie. Credentials, cookies, and tokens are
therefore absent from the tracked collection and environment templates. Bruno is optional local
tooling and is not installed or run by Maven.
