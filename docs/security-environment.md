# Security assessment environment

The `security` Spring profile and `deploy/compose.security.yaml` create one disposable target for active security assessments. They are not a general development or UAT environment. The application refuses to start unless all of these identities agree:

- `COURTSIDE_ENVIRONMENT=SECURITY`;
- a confirmed disposable profile;
- a valid per-run identifier, seed fingerprint and instance fingerprint; and
- the Compose-local `courtside_security` database on host `db`.

## Prepare the images

The application networks have no Internet route and every service uses `pull_policy: never`. Pull the pinned PostgreSQL, Caddy, ZAP and Schemathesis images before starting it. Build or pull the Courtside candidate separately and refer to it by immutable image ID or registry digest.

```bash
docker pull postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193
docker pull caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648
docker pull zaproxy/zap-stable:2.16.1@sha256:7840969c7c9fead565bf9734b12f49f6886db90b1d35b1f74d79710bbd081dab
docker pull schemathesis/schemathesis:4.25.0@sha256:980d159d1211ed2ef1f571aa8c6876955c6699dfd6463b8b5f28e788aa61e25e
node tools/courtside.mjs security run-0001 ghcr.io/jegr78/courtside@sha256:<digest>
```

The command creates a random shared password, a seed fingerprint, a random instance fingerprint and a private state file below `build/security/run-0001`. It prints the synthetic credential once for the operator. The password never appears in a tracked file or command argument.

Startup atomically reserves the run ID in Docker before Compose can create resources. The instance fingerprint binds that reservation, private state, manifests, containers and networks; another workspace cannot reuse or clean up the same run ID.

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

The safe suite writes `passive-deployment.json` and `passive-deployment.md` beside the manifest. ZAP creates its raw report in a size-limited container tmpfs. The runner reads it while the container is alive, converts it to the closed evidence schema and removes the container without retaining the raw report. Scanner alerts contain only plugin, risk, confidence and occurrence counts. Any alert leaves the run incomplete until the finding lifecycle validates or rejects it.

The active suite writes `authorization-matrix.json`, `authenticated-zap.json` and `openapi-fuzz.json`. It creates all role sessions outside the scanners and passes credentials only through stdin to mode-`0600` files in container tmpfs. The gateway applies a suite-specific method allowlist, counts requests synchronously and stops forwarding when its reserved budget is exhausted. The ZAP policy disables every passive rule except the isolated canary and every active rule except the two IDs in [`security/zap-authenticated-policy.json`](../security/zap-authenticated-policy.json). The Schemathesis policy in [`security/openapi-fuzz-policy.json`](../security/openapi-fuzz-policy.json) fixes its image, seed, examples, workers and explicit operation exclusions. Run the safe profile separately for the full passive baseline.

Inspect the latest or a specific attempt with:

```bash
node tools/courtside.mjs security-report run-0001
node tools/courtside.mjs security-report run-0001 --attempt 1
```

The emergency stop is local and immediate. The current prerequisite checks it before target verification and preserves the current manifest:

```bash
node tools/courtside.mjs security-stop run-0001
```
