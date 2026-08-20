# Security scanning

Courtside treats scanners as evidence, not as proof that the product is secure. The required build scans dependency changes, hand-written Java and TypeScript, the assembled application JAR, npm dependencies, repository secrets and deployment configuration. Release qualification separately scans the exact candidate image on both supported architectures.

CodeQL runs the `security-extended` query suite. Trivy scans the unpacked runtime JAR as a root filesystem so that transitive Java libraries are included, then scans repository secrets and deployment configuration separately. Dependency Review rejects newly introduced High and Critical vulnerable dependencies. A scanner outage or a missing report fails its named workflow step and is never reported as a clean scan.

The importer records each scanner's name, version, completion state, subject and finding count. A
zero count therefore means a completed clean scan, not missing evidence. Findings retain their
advisory source, aliases, CWE mappings, affected component and reachability state. Matching npm and
Trivy observations with the same component and advisory alias become one finding with both source
observations. The importer does not execute scanners.

## Triage and exceptions

High and Critical npm and Trivy findings and CodeQL findings with a security severity of at least 7 block the gate. A maintainer validates reachability and exploitability before deciding whether to fix the dependency, remove the affected feature or record an exception.

Exceptions live in `security/exceptions.json` and match one scan scope, scanner, finding id and target exactly. The maintained scopes are `required-build`, `release-build`, `release-image-amd64` and `release-image-arm64`. Each record contains a rationale, owning area, compensating control, expiry and whether independent review occurred. Expired, duplicate and incomplete exceptions fail every gate; an unused exception fails its own scope without blocking unrelated scopes.

The same file contains dynamic `riskAcceptances`, keyed by the stable fingerprint from the
[security finding lifecycle](security-findings.md). The two lists are separate because a raw static
scanner result and a reproducibly validated product vulnerability do not have the same identity or
state. The closed schema rejects fields that could become an informal evidence store.

The project currently has a single maintainer. That maintainer may set `independentReview` to `false` to stay operational, but the missing peer review remains visible in the record. This is intentionally not an approval requirement until another regular maintainer exists.

Raw scanner output is temporary because it can contain source excerpts or secret matches. The
retained summary uses a fixed projection and never copies excerpts, secret values, request data or
scanner messages. Accepted findings retain the exception owner, rationale, compensating control,
expiry and review state. Findings below the blocking threshold remain visible as informational
evidence. Workflow artifacts are retained for fourteen days; CodeQL also uploads its findings to
GitHub code scanning.

Release qualification imports npm, CodeQL, source and assembled Java-runtime findings from the
release build. It adds image findings from both architectures. The combiner requires all three
records, rejects stale inputs and binds the build record to the release commit and both image
records to the candidate digest.

The publish job creates the SBOM, provenance attestation and keyless image signature only after the
candidate has passed qualification. It then verifies all three against the digest-qualified image.
The final release record contains the image digest, SBOM digest and hashes of the verification
outputs. Publication stops if a proof is absent, empty or bound to another digest.

The required build owns static analysis, dependency checks, image scanning and supply-chain
verification. The penetration-testing framework imports their normalized evidence. It owns dynamic
test authorization, target identity, candidate validation, retests and manual WSTG evidence; it
does not rerun the static scanners.

False positives are never suppressed by a broad scanner rule or permanent ignore file. They use the same precise, expiring exception path and disappear from the exception file when the scanner no longer reports them.

## Updating tools

Actions are pinned to full commit hashes. Dependabot proposes action and container updates, and the required build qualifies them by behaviour. Trivy vulnerability databases remain cached but are refreshed by the action; a failed refresh is distinguishable from a finding-free result.
