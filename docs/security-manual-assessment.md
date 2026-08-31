# Manual security assessment runbook

This runbook covers security judgments that the automated suites cannot make reliably. It uses
WSTG 4.2 and ASVS 5.0.0 Level 2 identifiers from the assessment catalog. Automation results are
inputs, not substitutes for the observations recorded here.

## Assessment record

Create one protected version 2 record before testing. Record the tester, UTC timestamp, catalog version,
source commit, target image digest, target fingerprint, environment, selected procedures and
authorization. Record whether an independent reviewer participates; a single maintainer may
authorize, execute, validate and accept risk.

Use [`security/manual-assessment-evidence.schema.json`](../security/manual-assessment-evidence.schema.json)
for the record and validate it with the repository contract tests. The authorization object binds
the exact HTTPS origin, target fingerprint, image digest, profile, procedure set and expiry.

For every procedure retain:

- Prerequisites
- Tester
- Timestamp
- Target image digest

For every selected control within that procedure retain:

- Steps
- Expected secure outcome
- Observed result
- Redacted evidence
- Outcome

Outcome is exactly `pass`, `fail`, `not-applicable` or `blocked`. `not-applicable` and `blocked`
require a control-specific rationale and owner and may omit evidence when none exists. `fail`
requires redacted evidence and a private lifecycle candidate. Only `pass` may omit a rationale.

## Authorization and profile boundary

Start with `safe`. It permits bounded passive checks against SECURITY, UAT or an explicitly
authorized production origin. Production authorization names the origin, digest, procedures and
expiry; it does not authorize login attempts, mutation, discovery outside that origin or load.

`active` permits curated mutations only in the disposable SECURITY environment after target and
seed verification. `destructive` additionally requires its distinct confirmation and the resource
budgets, telemetry, emergency stop and recovery proof. Never reinterpret a safe authorization as
active or destructive authorization.

`MAN-INPUT-001`, `MAN-IDENTITY-001`, `MAN-SESSION-001`, `MAN-AUTHZ-001` and
`MAN-BUSINESS-001` require `active`; every other procedure is `safe`. No manual procedure currently
requires `destructive`. A safe procedure may run against production only when its authorization
names that exact origin and procedure.

Perform a dry run first and compare the selected procedures, profile, target fingerprint, image
digest and budgets with the assessment record. Stop if any value differs.

## Execution and emergency stop

Prepare and verify the environment with the commands in
[`security-environment.md`](security-environment.md). Use `node tools/courtside.mjs security-plan
<run-id> <profile>` for the dry run and `node tools/courtside.mjs security-verify <run-id>` before
the first active request.

Keep the SECURITY state and STOP-file paths visible throughout active work. Stop immediately on a
target mismatch, traffic outside the authorized origin, unexpected personal data, unavailable
telemetry, a hard resource limit, unexplained state mutation or loss of evidence protection. Use
`node tools/courtside.mjs security-stop <run-id>`, capture only redacted diagnostics, and do not
retry over the first attempt.
Mark the procedure `blocked` or `fail` according to whether a secure outcome was actually violated.

After active or destructive work, run `node tools/courtside.mjs security-cleanup <run-id>` and
verify health, restart, database access, domain
fingerprint restoration and absence of run-owned resources. A cleanup or recovery failure makes
the assessment incomplete and must be resolved before another run uses the same identity.

## Evidence and incident handling

Do not place credentials, cookies, CSRF values, raw requests or responses, URLs with identifiers,
personal data, exploit payloads, traces or screenshots in Git, ordinary issues, CI logs or public
artifacts. Store necessary raw evidence only in restricted storage, record its digest,
classification and expiry, and retain a redacted observation in the assessment record.

If a test exposes real data, reaches an unapproved target or affects a non-disposable system, stop
traffic, preserve minimal protected evidence, record the exact authorization boundary and notify
the repository owner. Reproducible vulnerabilities enter GitHub private vulnerability reporting.
Public regression tests and issues are created only after they no longer disclose a usable attack.

## Procedures

Each procedure applies only to catalog controls that name its identifier. Before execution, create
one worksheet row per selected control. Copy its exact requirement from the catalog's immutable,
commit-pinned OWASP source, identify the concrete Courtside component and observable result, expand
the procedure steps into actions for that requirement, and state the expected result in testable
terms. A category-level observation never satisfies multiple controls by itself. The evidence
record must reproduce the performed control-specific steps and expected result; a generic copy of
the category procedure is incomplete.

### MAN-ARCH-001 Architecture and threat-boundary review

- Prerequisites: current design, deployment manifests, OpenAPI document, module model and threat model.
- Steps: trace each trust boundary and sensitive data flow from browser to storage; compare the
  deployed components, roles and external dependencies with the documented model; challenge every
  implicit trust decision and record an owner for each security control.
- Expected secure outcome: the shipped architecture has no undocumented trust boundary, privileged
  flow or control owner, and deviations are explicit findings rather than assumptions.

### MAN-DATA-001 Data classification, privacy and lifecycle review

- Prerequisites: synthetic SECURITY data, import/export formats, backup model and retention rules.
- Steps: classify every stored and exported field; follow creation, correction, disclosure,
  retention and deletion paths; inspect aggregate and error views for inference; verify that test,
  backup and operational copies follow the same classification.
- Expected secure outcome: personal and sensitive data is minimized, purpose-bound, access-controlled
  and removable without leaving an undocumented copy or cross-person disclosure.

### MAN-COMMS-001 Communications and deployment-boundary review

- Prerequisites: qualified image, reference proxy, TLS evidence and an explicitly authorized origin.
- Steps: inspect protocol versions, certificate chain, redirects, host handling, cache boundaries,
  proxy normalization and service exposure; compare direct-container and proxied behavior; perform
  passive production checks only when the assessment record names the production origin.
- Expected secure outcome: one canonical HTTPS boundary protects traffic and metadata, internal
  services remain unreachable, and ambiguous proxy interpretation fails closed.

### MAN-INPUT-001 Parser and protocol-ambiguity review

- Prerequisites: SECURITY only, active authorization, OpenAPI inventory and bounded gateway.
- Steps: select representative JSON, multipart, CSV and header operations; vary duplicate fields,
  encodings, delimiters, lengths and conflicting framing without volumetric traffic; compare proxy,
  application and persistence interpretation; minimize any disagreement before retaining evidence.
- Expected secure outcome: every layer agrees on one request meaning, rejects ambiguity before state
  changes and returns no sensitive parser detail.

### MAN-IDENTITY-001 Identity, credential and recovery review

- Prerequisites: two synthetic identities per relevant role and initial-password accounts.
- Steps: review enrollment, credential handover, password change, recovery, identifier change,
  enumeration resistance and account disablement; attempt social and workflow abuse without using
  real people; verify that every credential transition invalidates previous authority.
- Expected secure outcome: identity proof and credential lifecycle cannot be bypassed, delegated to
  an unintended person or inferred through response differences.

### MAN-SESSION-001 Session and concurrent-authority review

- Prerequisites: two browsers, multiple synthetic sessions and active authorization in SECURITY.
- Steps: exercise login, logout, expiry, password and role changes across concurrent tabs and
  in-flight requests; inspect browser history, shared-device behavior and restart persistence;
  verify idle and absolute lifecycle decisions against the documented policy.
- Expected secure outcome: stale or parallel sessions cannot restore revoked authority or disclose
  authenticated state after logout, expiry or a credential change.

### MAN-AUTHZ-001 Object, function and workflow authorization review

- Prerequisites: complete role matrix, two identities per class and synthetic owned objects.
- Steps: walk each business workflow as its intended role, another member and every managing role;
  substitute object ownership and sequence steps; inspect read, write, export and indirect effects;
  verify the domain state after every rejection.
- Expected secure outcome: authorization follows current identity, ownership and workflow state at
  every use, with no partial side effect or role-confusion path.

### MAN-BUSINESS-001 Business-logic and chained-abuse review

- Prerequisites: SECURITY, active authorization, documented booking invariants and reset capability.
- Steps: combine individually valid booking, cancellation, series, participation, membership and
  import actions in reordered or repeated sequences; use two sessions where timing matters; test
  incentives and quota bypass without increasing declared load budgets.
- Expected secure outcome: chains preserve booking, membership, capacity and consent invariants and
  cannot gain value through repetition, ordering or cross-role cooperation.

### MAN-CLIENT-001 Browser, accessibility and physical-device review

- Prerequisites: supported desktop browsers, at least one physical mobile device and test assistive technology.
- Steps: inspect focus, announcements, clipboard, autofill, browser storage, back/forward cache,
  service-worker update and offline states around login and sensitive mutations; repeat critical
  journeys with keyboard and screen reader; review installed-PWA behavior after logout and upgrade.
- Expected secure outcome: browser and assistive paths neither conceal security decisions nor retain
  authenticated or personal data beyond the documented session.

### MAN-CRYPTO-001 Cryptographic use and secret-lifecycle review

- Prerequisites: configuration, dependency evidence and synthetic credentials; no production secrets.
- Steps: inventory encryption, hashing, randomness, signing and trust stores; verify algorithm,
  parameter and key-lifecycle choices against current project policy; inspect failure and rotation
  paths and ensure logs and evidence never receive secret material.
- Expected secure outcome: approved primitives protect the intended property, keys and credentials
  have explicit lifecycles, and failure does not downgrade protection.

### MAN-OPS-001 Logging, recovery and operational-access review

- Prerequisites: disposable deployment, synthetic events, backup/restore proof and operator documentation.
- Steps: trigger successful and rejected sensitive operations; inspect redacted logs, audit events,
  monitoring and backup artifacts; follow alert, investigation, restore and evidence-expiry steps;
  verify that operator access is bounded and attributable.
- Expected secure outcome: security events are actionable without exposing personal or secret data,
  and recovery restores integrity without granting undocumented operator access.

### MAN-EXTERNAL-001 Independent assessment intake

- Prerequisites: threat model, catalog, authorized target statement, disclosure channel and protected transfer method.
- Steps: give an independent external tester the architecture, scope, constraints and finding schema
  without prescribing test cases or limiting methodology; require target-safe communication and
  import each returned observation as a candidate with its original provenance; validate, remediate
  and retest through the same private lifecycle.
- Expected secure outcome: external work remains methodically independent while findings retain
  reproducible provenance, protected evidence, priority and retest history.

## Completion

Confirm every selected control has one outcome and every non-pass result has a rationale. Reconcile
the record with the catalog, finding lifecycle and retained evidence digests. Delete expired raw
evidence and synthetic credentials, reset the environment, and record whether an independent
external tester or reviewer participated. The absence of independent review is recorded, not hidden
and not used to prevent the single maintainer from acting.

For risk acceptance, follow [`security-findings.md`](security-findings.md): validate and prioritize
the finding first, refuse acceptance for P0, and create a matching exception with owner, rationale,
compensating control, acceptance time and expiry. The `accepted-risk` transition references that
exact exception. A single maintainer may create it; the independent-review field remains truthful.
