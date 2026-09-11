# Security finding lifecycle

Scanner output is an observation, not a finding. Courtside keeps the distinction because a noisy
tool must not block a release as if a maintainer had reproduced a vulnerability. The opposite also
matters. A candidate cannot disappear without an auditable validation, rejection or duplicate
record.

## Current control-review findings

These public entries record the safe result of reading a pinned control against the shipped source.
They omit request examples, concrete identifiers and protected evidence. The catalog links the
affected control to the heading, and the remediation issue owns the product change and retest.

### Principal workflow inventory is incomplete

- State: validated architecture gap
- Priority: P2
- Controls: WSTG 4.2 `WSTG-v4.2-INFO-07`
- Review: `MAN-ARCH-001`, 9 September 2026
- Remediation: #902

The application classifies mapped routes by access level, and browser tests exercise selected core
journeys. Neither source is a closed map of principal workflows, their state transitions, or their
alternate and failure paths. The control remains non-passing until a bounded inventory covers the
member, booking, import, account and administration workflows and fails when an unclassified path
is introduced.

### External trust-boundary map is incomplete

- State: validated architecture gap
- Priority: P2
- Controls: WSTG 4.2 `WSTG-v4.2-INFO-10`; ASVS 5.0.0 `v5.0.0-13.1.1`,
  `v5.0.0-13.2.4`, `v5.0.0-16.5.2`
- Review: `MAN-ARCH-001`, 9 September 2026
- Remediation: #902

The current map covers the browser, proxy, application, database, build and evidence boundaries.
It omits application calls to SMTP, HIBP and an optional OTLP collector, certificate automation
from the proxy to its ACME provider, mail delivery to DNS and external recipients, and configurable
browser-to-third-party branding or legal destinations. The control remains non-passing until a
closed inventory names those flows and a test fails for an undocumented production service,
listener, outbound client or trust transition. That inventory must also state the allowed target
for every outbound flow and the secure behavior when the dependency refuses, times out or returns
invalid data; the current map cannot yet prove either property across the complete set.

### Incomplete sensitive-data classification

- State: validated design gap
- Priority: P2
- Controls: ASVS 5.0.0 `v5.0.0-14.1.1`
- Review: `MAN-DATA-001`, 8 September 2026
- Remediation: #882

`docs/data-model.md` inventories stored fields and section 11 of `docs/design.md` describes selected
personal-data lifecycles. Neither assigns every stored, exported, cached, logged and retained field
to a maintained protection level. The repository therefore cannot prove that it identified all
sensitive data or derive handling rules from one complete classification.

### Personal data enters request URLs

- State: validated design gap
- Priority: P2
- Controls: ASVS 5.0.0 `v5.0.0-14.2.1`
- Review: `MAN-DATA-001`, 8 September 2026
- Remediation: #882

The public OpenAPI contract accepts personal name fragments and person-linked identifiers in path or
query parameters. Such values can enter browser, intermediary and operator URL records even though
response bodies and retained assessment evidence have stricter handling. The reference deployment
does not enable access logs by default, but the software cannot treat that optional operator choice
as proof that URLs contain no personal data.

### Incomplete authorization rule documentation

- State: validated design gap
- Priority: P2
- Controls: ASVS 5.0.0 `v5.0.0-8.1.1`, `v5.0.0-8.1.2`
- Review: `MAN-AUTHZ-001`, 8 September 2026
- Remediation: #884

`docs/design.md` defines broad role capabilities and selected ownership and field-minimisation rules.
The active assessment also exercises an operation-role matrix and selected object substitutions.
Neither is a complete, maintained policy for every function, resource attribute and field-level read
or write restriction. Tool expectations cannot silently stand in for the normative authorization
documentation these controls require.

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
- A passive scanner alert is untriaged until a record in
  [`passive-alert-dispositions.json`](../security/passive-alert-dispositions.json) covers it. A
  fingerprint alone does not: the record also names the risk, the confidence, the pinned scanner
  version and what the rule concluded, and all of them have to match the alert in hand. What the
  rule concluded is the rule's own reading, not a count of it: for the policy rule that is every
  wording the pinned scanner emitted, so a wording naming no directive still moves the observation
  the record has to match.
- A validated or in-progress finding makes the run `failed`.
- A fix awaiting retest makes the run `incomplete`.
- A passed retest, reproducible false positive or duplicate does not block the run.
- An expired, unused or incomplete risk acceptance fails closed.

Static scanner thresholds remain in [`security-findings.mjs`](../tools/security-findings.mjs). Their
precise scanner exceptions and dynamic risk acceptances share one policy file, but the two record
types stay distinct. A static scanner exception matches scope, scanner, finding id and target. A
dynamic acceptance matches the stable lifecycle fingerprint.

Every scanner-policy invocation declares `--assessment-policy`. The current build and release
workflows record `not-applicable` because executable assessment adapters are deliberately disabled.
They cannot silently imply that a dynamic assessment ran. Once a workflow runs an assessment, it
uses `required` with `--lifecycle`; omitting that record then fails the gate.

A required lifecycle is validated and embedded in the same normalized record as static scanner
results. Pending validation makes that record incomplete; validated unresolved findings block it.
Combined release evidence rejects incomplete source records and preserves explicit assessment
policy, so a lifecycle cannot disappear between build and release policy gates.

## Evidence handling

Assessment adapters may not write arbitrary retained files. The safe evidence projection accepts
only a known HTTP method, status, Courtside problem type, a fixed observation code and the names of
present non-sensitive response headers. Unknown fields and invalid values are rejected. It drops
URLs, header values, request and response bodies, credentials, cookies and unapproved headers, and
redacts every retained string.

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
