# Security finding lifecycle

Scanner output is an observation, not a finding. Courtside keeps the distinction because a noisy
tool must not block a release as if a maintainer had reproduced a vulnerability. The opposite also
matters. A candidate cannot disappear without an auditable validation, rejection or duplicate
record.

[`finding-lifecycle.schema.json`](../security/finding-lifecycle.schema.json) defines the retained run
record. [`exceptions.schema.json`](../security/exceptions.schema.json) defines the shared policy for
static scanner exceptions and accepted dynamic risk. Both schemas are closed. Unknown fields fail
validation instead of becoming an undocumented place to store raw traffic.

## Identity and provenance

A candidate fingerprint is the SHA-256 digest of four normalized values:

1. rule identifier;
2. HTTP or product operation;
3. affected parameter; and
4. attack class.

Whitespace and case do not change the fingerprint. Tool version, run identity, attempt, target
fingerprint and observation time remain separate provenance. Another scanner or tool version can
therefore report the same underlying condition without inventing a second finding.

Each evidence reference records its retention state, classification, digest and expiry. A retained
protected reference may name a location in restricted storage. Public summaries never contain that
location, the affected operation, validation reference or evidence metadata.

## States

A scanner creates a `candidate`. Triage then takes one of three paths.

- Reproducible validation promotes it to `validated`.
- A reproducible rejection records `false-positive`, the actor, rationale, time and reference.
- Matching an existing record produces `duplicate` with the same disposition fields.

A validated finding can move through `remediation-in-progress`, `fixed`, `retest-passed` or
`accepted-risk`. State changes record the actor, time and reference. Retests have their own history.
A failed retest returns the finding to `validated`. If a scanner reports the same fingerprint after
a passed retest, the new candidate carries `regression: true`.

`fixed` is not a completed state. It leaves the assessment incomplete until a retest passes.
`accepted-risk` requires a matching, current entry in [`exceptions.json`](../security/exceptions.json).
P0 findings cannot be accepted.

## Outcome rules

The lifecycle result uses the assessment outcomes from
[`security-assessment.md`](security-assessment.md).

- An untriaged candidate makes the run `incomplete`. It does not become a release-blocking finding
  until reproducible validation succeeds.
- A validated or in-progress finding makes the run `failed`.
- A fix awaiting retest makes the run `incomplete`.
- A passed retest, reproducible false positive or duplicate does not block the run.
- An expired, unused or incomplete risk acceptance fails closed.

Static scanner thresholds remain in [`security-findings.mjs`](../tools/security-findings.mjs). Their
precise scanner exceptions and dynamic risk acceptances share one policy file, but the two record
types stay distinct. A static scanner exception matches scope, scanner, finding id and target. A
dynamic acceptance matches the stable lifecycle fingerprint.

## Evidence handling

Assessment adapters may not write arbitrary retained files. The safe evidence projection accepts
only the request method, path, status, problem type, a short observation and an allowlist of
non-sensitive response headers. It drops request and response bodies. It drops credentials,
cookies and unapproved headers, and redacts query values, email addresses, tokens and authentication
material from retained text.

Full requests, responses and exploit details belong in restricted storage with the expiry recorded
by the evidence reference. They do not belong in repository files, ordinary GitHub issues, CI logs
or public workflow artifacts. Public records contain the fingerprint, state, priority, standards
mappings and regression flag only.

Use GitHub private vulnerability reporting for a reproducible issue when a public description would
disclose an attack. A harmless regression test may enter the repository after it no longer exposes
a usable exploit or sensitive data.

## Triage procedure

1. Import the scanner observation as a candidate with complete provenance and at least one evidence
   reference.
2. Reproduce or reject it using a minimized request, a regression test or a recorded manual check.
3. Record CWE, WSTG 4.2, ASVS 5.0.0 and API Security Top 10 mappings for a validated finding.
4. Record the CVSS 4.0 vector, then assign P0 to P3 from Courtside impact and reachability.
5. Fix and retest the finding, or add a precise risk acceptance when policy permits one.
6. Publish only the redacted summary. Keep protected evidence until its recorded expiry, then remove
   it.

One maintainer may perform every step. The records state whether independent review occurred. A
missing second maintainer does not stop remediation, retesting or risk acceptance, but it is never
represented as independent review.
