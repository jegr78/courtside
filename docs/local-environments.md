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
| `node tools/courtside.mjs uat-logs` | Follows all UAT container logs. |
| `node tools/courtside.mjs uat-db-shell` | Opens `psql` inside the private UAT database container. |
| `node tools/courtside.mjs uat-cert [file]` | Exports the UAT root certificate and prints trust instructions. |
| `node tools/courtside.mjs uat-backup [file]` | Creates a portable compressed PostgreSQL dump. |
| `node tools/courtside.mjs uat-restore <file> --confirm courtside-uat` | Replaces the UAT database from a dump and restarts the application. |
| `node tools/courtside.mjs uat-reset courtside-uat` | Deletes the UAT database but retains its local CA. |
| `node tools/courtside.mjs uat-reset courtside-uat --all` | Deletes the UAT database and local CA. |
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
merge base, and classifies committed, staged, unstaged and untracked changes with
`ci/test-profiles.json`, the same contract protected pull-request CI uses. Documentation changes
need only clean change evidence. Backend changes run the Java profile; frontend changes run lint,
unit tests, build, audit, application packaging and browser journeys. A mixed change runs both
profiles. Build, workflow, security, deployment, database, OpenAPI, shared test-infrastructure,
unknown and structural changes run the complete Maven verification.

The command writes `build/local-check/result.json` with the base and head commits, selected
profiles, reasons, tasks and outcome. If `origin/main` cannot be refreshed, classification falls
back to `full`. `--full` only escalates. It cannot suppress a required task.

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

## User acceptance testing

Start UAT with `node tools/courtside.mjs uat`. The default command verifies the current checkout,
builds its container image, and starts it as the `courtside-uat` Compose project. Its database and
Caddy certificate authority survive restarts and source rebuilds. UAT never loads demo data.

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

`uat-stop` keeps both persistent volumes. `uat-backup` defaults to a timestamped file below
`build/backups`; an explicit destination is also accepted. Restore requires the exact confirmation
`--confirm courtside-uat`, stops the application during `pg_restore`, and starts it again even when
restore fails.

`uat-reset courtside-uat` is intentionally explicit and destructive. It deletes only the database,
so the next start bootstraps a fresh admin while browsers can continue trusting the same CA. Add
`--all` only when both database and CA should be discarded.

## Bruno API collection

Open [`../bruno`](../bruno) as a collection in Bruno and select the `Dev` or `UAT` environment.
The requests cover public configuration, CSRF acquisition, login, authenticated session state, and
logout. Run them in sequence because Bruno's cookie jar carries the CSRF and session cookies.

Create private runtime variables named `username` and `password` in Bruno before login. The CSRF
request derives `csrfToken` in memory from the response cookie. Credentials, cookies, and tokens are
therefore absent from the tracked collection and environment templates. Bruno is optional local
tooling and is not installed or run by Maven.
