# Security scanning

Courtside treats scanners as evidence, not as proof that the product is secure. The required build scans dependency changes, hand-written Java and TypeScript, the assembled application JAR, npm dependencies, repository secrets and deployment configuration. Release qualification separately scans the exact candidate image on both supported architectures.

CodeQL runs the `security-extended` query suite. Trivy scans the unpacked runtime JAR as a root filesystem so that transitive Java libraries are included, then scans repository secrets and deployment configuration separately. Dependency Review rejects newly introduced High and Critical vulnerable dependencies. A scanner outage or a missing report fails its named workflow step and is never reported as a clean scan.

## Triage and exceptions

High and Critical npm and Trivy findings and CodeQL findings with a security severity of at least 7 block the gate. A maintainer validates reachability and exploitability before deciding whether to fix the dependency, remove the affected feature or record an exception.

Exceptions live in `security/exceptions.json` and match one scan scope, scanner, finding id and target exactly. The maintained scopes are `required-build`, `release-build`, `release-image-amd64` and `release-image-arm64`. Each record contains a rationale, owning area, compensating control, expiry and whether independent review occurred. Expired, duplicate and incomplete exceptions fail every gate; an unused exception fails its own scope without blocking unrelated scopes.

The project currently has a single maintainer. That maintainer may set `independentReview` to `false` to stay operational, but the missing peer review remains visible in the record. This is intentionally not an approval requirement until another regular maintainer exists.

Raw scanner output is temporary because it can contain source excerpts or secret matches. The retained `summary.json` contains only scanner identifiers, severities, targets and exception metadata; findings below the blocking threshold remain visible as informational evidence. Workflow artifacts are retained for fourteen days; CodeQL also uploads its findings to GitHub code scanning.

Release qualification records npm and assembled Java-runtime findings in the release build, adds the exact image findings from both architectures and publishes their combined normalized record with the GitHub release.

False positives are never suppressed by a broad scanner rule or permanent ignore file. They use the same precise, expiring exception path and disappear from the exception file when the scanner no longer reports them.

## Updating tools

Actions are pinned to full commit hashes. Dependabot proposes action and container updates, and the required build qualifies them by behaviour. Trivy vulnerability databases remain cached but are refreshed by the action; a failed refresh is distinguishable from a finding-free result.
