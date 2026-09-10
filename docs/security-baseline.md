# Internal security assessment baseline

Status: baseline execution completed; manual evidence remains incomplete as of 6 September 2026.

This is the redacted record of an internal OWASP-oriented assessment. It does not declare the
application secure and does not replace an independent penetration test.

## Candidate and evidence identity

- Source commit: `63bcd3ed81fdd7bc5e931d7a06ee3a57c04ffd69`
- Application image: `sha256:7dcf2f8034fe9951fe8ce3837dbd237f64d4a44ea1bcd4fbed06f2746242105e`
- Target fingerprint: `sha256:849b0aa130dd720847194fe6c5325f5ebbcc7704cd904f80078dc2b1c613d47b`
- Catalog: `1.3.0`
- Hosted workflow: [run 34004691464](https://github.com/jegr78/courtside/actions/runs/34004691464)
- Paired run: `assessment-34004691464-1` (safe attempt 1, active attempt 2)
- Manual record: `manual-baseline-20260906`
- Sealed paired-evidence digest:
  `sha256:c7cc5c839298629bcb6913fd4752eb0b98ecc67548c2cc3ba36ada8e2b2beb09`

The workflow qualified one immutable image, started one fresh `SECURITY` environment and bound both
attempts to the same commit, image, target origin, target fingerprint and seed. The encrypted
evidence envelope uses the repository's RSA-OAEP recipient. Its GitHub artifact attestation was
verified before local decryption. Protected evidence is mode `0600`, is not committed, and expires
on 6 October 2026.

## Automated execution

| Attempt | Profile | Duration | Requests | Generated data | Evidence | Runner result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | safe | 50.009 s | 30 | 0 MiB | 12,403 bytes | incomplete before triage |
| 2 | active | 203.567 s | 2,124 | 5.972 MiB | 397,693 bytes | passed |

The workflow spent 26 minutes 49 seconds building and testing the candidate, 3 minutes 10 seconds
qualifying it, and 5 minutes 18 seconds preparing and executing the isolated assessment. The target
identity, authenticated ZAP plan, OpenAPI fuzzer and authorization matrix all passed. Every active
check remained inside its request, concurrency, duration, generated-data and evidence budgets.
Cleanup removed the run-owned containers, network and volumes.

The safe runner correctly stopped at `incomplete` because it cannot decide whether scanner alerts
are findings. Reproducible lifecycle triage classified all 12 observations: eleven are false
positives and one is the existing P3 acceptance for administrator-selected remote HTTPS logos. No
scanner rule was suppressed. The resulting safe lifecycle passes with no untriaged candidate and no
regression. Its redacted
[`passive-baseline-finding-summary.json`](../security/passive-baseline-finding-summary.json) has
digest `sha256:62e07b38ecc6e1b998abad9abe2b66197b3c97e849f84410d81be0179bf40790`.

That triage was a record no run could read. The eleven classifications now live beside their
fingerprints in [`passive-alert-dispositions.json`](../security/passive-alert-dispositions.json),
each with the reason it is not a finding, and the twelfth resolves through its unexpired acceptance,
so a repeat of this run reaches `passed` instead of stopping at `incomplete` a second time.

The harmless authenticated-scanner canary completed the full lifecycle in the isolated target:
detected, validated, remediation in progress, fixed, and independently retested without the seeded
header. The retest used a separate closed ZAP plan and required the protected route's actual `401`
response, rather than weakening application behavior to manufacture a `404`. The retained proof
binds each transition to its actual event time and binds the separate retest request count and
report digest without publishing the report. Supplemental local run `issue253-canary-evidence-v4`
reproduced the complete active profile against qualified immutable image
`sha256:ac5474ecd824d7d68fc973538533db17177d856f11bea48ce8faf9fda82ac836` in 162.410 seconds. Its
authenticated ZAP evidence records 129 requests, one retest request, strictly increasing phase
times and protected retest-report digest
`sha256:aa4d3286770df2985eed45c47175775da70d29a8ff14d6e7f7b5934f1935a64a`.

## Manual WSTG and ASVS review

The manual record covers 316 unique selected controls from OWASP WSTG 4.2 and ASVS 5.0.0 Level 2:

| Outcome | Controls |
| --- | ---: |
| pass | 0 |
| not applicable, with rationale | 111 |
| fail, linked to a validated or accepted finding | 59 |
| blocked pending control-specific evidence | 146 |

The per-control outcomes of this run are published, redacted to one identifier and one outcome each,
as [`manual-baseline-control-outcomes.json`](../security/manual-baseline-control-outcomes.json),
with digest `sha256:20a8ae70f327fbc877c533ec52a4817856a79b1ce453e7df23178359faa641a1`. The protected record they derive from expires;
the list of controls the next run has to work through does not.

Publishing it is a deliberate disclosure, and a narrow one. The 59 failed controls are exactly the
controls `manual-baseline-finding-summary.json` already maps its eleven findings to, so nothing about
what is broken is new. What is new is the split of the remaining 257 into 111 that do not apply and
146 nobody has read against a named production path. That tells a reader where this assessment has
not looked yet, which the counts above already say in aggregate and which the source of an AGPL
application says in full. Being able to name them is worth more than the hint, because a control
nobody can name is a control nobody fixes.

The first review had assigned 158 pass outcomes from chapter-level file inventories. Independent
review showed that those records were not control-specific and contradicted ten known gaps. None of
those generated outcomes remains a pass: 12 map to a validated or accepted finding and the other
146 are explicitly blocked under #804 until a named production path and a falsifying check exist.

The 59 failed controls reduce to ten unique unresolved findings and the existing accepted risk.
There are no untriaged candidates, regressions, P0 findings or P1 findings. The ten remediation
items are:

- #792 permanent-password lifecycle (P2)
- #793 complete session lifecycle (P2)
- #794 host-bound authentication cookies (P3)
- #795 encrypted internal reference-deployment traffic (P2)
- #796 bounded backend-service identities (P2)
- #797 actionable authentication and authorization log retention (P2)
- #798 cryptographic inventory and key lifecycle (P3)
- #799 documented upload type boundary (P3)
- #800 refusal of plaintext API requests before redirect (P2)
- #803 dependency remediation deadlines (P3)

They are ordered under parent #801. The redacted
[`manual-baseline-finding-summary.json`](../security/manual-baseline-finding-summary.json) has digest
`sha256:1b6b90e83009d299d43b627e5148f4485f00a03e228e351b5a9f1b947fe2d03e`.
It contains eleven findings: ten `validated`, one `accepted-risk`, zero candidates and zero
regressions. The overall assessment fails on those findings and remains
incomplete on the 146 blocked controls. A completed execution is not a passing baseline.

Administrative multi-factor authentication remains explicitly blocked by #69. Destructive
resource-abuse tests, physical-device checks and independent external testing were not inferred
from automated evidence. They remain separately owned release activities.

## Failed attempt and reproducibility

The first hosted attempt, [run 34002456549](https://github.com/jegr78/courtside/actions/runs/34002456549),
was retained rather than retried as a flake. Safe attempt 1 ran for 46.084 seconds and produced the
same 30 bounded requests and 12,403 evidence bytes. Active attempt 2 stopped after 134.271 seconds
because the canary retest expected `404` from an authenticated route that correctly returned `401`.
The failure was deterministic. The implementation was corrected to assert `401`, redact and bound
diagnostics, and keep synthetic credentials out of startup logs. A fresh isolated local active run
then passed all 2,124 requests before the second hosted run reproduced that result. After the
evidence contract was tightened, local run `issue253-canary-evidence-v4` repeated all 2,124 requests
and proved the retained timestamp and report-digest binding.

## Gate recommendation

- Pull requests retain the build, static analysis, contract tests and packaged browser journeys.
  The network assessment is too stateful and expensive for every PR.
- The bounded safe profile runs weekly. An incomplete run requires lifecycle triage; it is never
  silently treated as passed or retried as a presumed flake.
- The active profile remains manually dispatchable and runs against an immutable release candidate.
  It blocks release when its automated gate fails.
- The control-specific manual checklist, destructive procedures and independent assessment remain
  explicit release activities. Active tests never target production.
- Release gating must not pass with an untriaged observation or an unresolved P0/P1 finding.
  It also cannot use the manual baseline as positive evidence while #804 controls remain blocked.
  Accepted risks require a rationale, compensating control and expiry.

## Reproduction

Follow the qualification and environment sequence in
[`security-environment.md`](security-environment.md), then run the paired `baseline` workflow from
[`security-assessment.md`](security-assessment.md) against one resolved image digest. Verify the
artifact attestation and OAEP envelope before decrypting protected evidence. Classify every retained
observation through [`security-findings.md`](security-findings.md), execute the manual procedures in
[`security-manual-assessment.md`](security-manual-assessment.md), and finish with ownership-checked
cleanup. Each rerun gets a new run identifier and preserves the prior record.
