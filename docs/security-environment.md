# Security assessment environment

The `security` Spring profile and `deploy/compose.security.yaml` create one disposable target for active security assessments. They are not a general development or UAT environment. The application refuses to start unless all of these identities agree:

- `COURTSIDE_ENVIRONMENT=SECURITY`;
- a confirmed disposable profile;
- a valid per-run identifier and seed fingerprint; and
- the Compose-local `courtside_security` database on host `db`.

## Prepare the images

The environment has no Internet route and every service uses `pull_policy: never`. Pull the pinned PostgreSQL and Caddy images before starting it. Build or pull the Courtside candidate separately and refer to it by immutable image ID or registry digest.

```bash
docker pull postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193
docker pull caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648
node tools/security-environment.mjs start run-0001 ghcr.io/jegr78/courtside@sha256:<digest>
```

The command creates a random shared password, a seed fingerprint and a private state file below `build/security/run-0001`. It prints the synthetic credential once for the operator. The password never appears in a tracked file or command argument.

Each run gets its own Compose project, networks, containers and dynamically allocated loopback TLS port. Both networks are Docker-internal. The application can reach PostgreSQL and the local callback service, but neither the application nor a scanner attached to these networks can follow a redirect or callback to the Internet or the host's private network.

## Dataset

The profile creates two enabled accounts for each product role and one account carrying the relevant member and manager role combination. Every identity uses an English placeholder name and an `@example.org` address. The dataset also contains current and ended memberships, two courts, foreign-owned bookings and a series. The shared password is unique to the run.

The bootstrap administrator is separate and retains its mandatory initial-password state. Assessment code should use the role-specific accounts unless it is explicitly testing bootstrap behavior.

## Verify and remove

Before an active request, verify the live source marker and the container labels against the private run state:

```bash
node tools/security-environment.mjs verify run-0001
```

A different environment, run ID or seed fingerprint stops verification. Reset removes only that run's Compose project and private state:

```bash
node tools/security-environment.mjs reset run-0001
```

The database and Caddy state use size-limited tmpfs mounts, so no data volume survives `down`. An interrupted run can use the same reset command. If its private state file is lost, use `docker compose -p courtside-security-run-0001 -f deploy/compose.security.yaml down --volumes --remove-orphans`; the explicit project name keeps cleanup away from other workspaces.
