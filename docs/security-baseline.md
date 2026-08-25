# Internal security assessment baseline

Status: incomplete as of 2026-08-24.

This record is the redacted result of the first complete execution of the automated safe and active
assessment boundary. It does not declare the application secure, and it does not replace an
independent penetration test.

## Candidate identity

- Source commit: `92e766610e8c3940ea409158b1c3073b9be14ad1`
- Application image: `sha256:beac6ddca2c1546cdf2912e1a0ae4ae62d9e137489f404dff433caada2c1cf71`
- Catalog: `1.2.0`
- Run: `baseline-20260824`
- Environment: disposable `SECURITY`
- Target fingerprint: `sha256:a89f08ba255dc0f66c6728bdd8c83a7b52aa4dcaa328c7a6ea942208ee54be03`

The UAT qualification bound the deployment, authentication, booking-persistence and runtime-
hardening checks to that image. Safe attempt 1 and active attempt 2 used the same running instance,
seed fingerprint and instance fingerprint. No image rebuild or retry occurred between them.

## Executed evidence

The candidate passed the full build before assessment: 1,422 backend tests, 384 frontend tests, 416
tool contract tests and 108 packaged browser journeys. That evidence covers the implemented session,
booking, privacy, administration, member, PWA, supply-chain and operations catalog entries without
repeating those journeys inside a scanner.

| Attempt | Profile | Duration | Requests | Generated data | Evidence | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | safe | 55.355 s | 30 | 0 MiB | 13,074 bytes | incomplete |
| 2 | active | 240.236 s | 1,651 | 4.015 MiB | 456,906 bytes | incomplete |

All 28 native deployment checks passed or were explicitly not applicable. The authorization matrix
and authenticated active scan passed. The OpenAPI suite preserved the same domain-state fingerprint
before and after rejected mutations. The authenticated scanner canary was detected and classified
as a reproducible false positive. Both attempts stayed within their declared request, concurrency,
duration, data and evidence budgets.

Cleanup removed every run-owned container, network and volume through the ownership-checked path.
Protected evidence remains local until its recorded 2026-09-23 expiry; it is not part of this
repository or an ordinary CI artifact.

## Candidate triage

The safe attempt retained 22 route-specific observations. The readable CSRF cookie explains five
missing-`HttpOnly` observations; it is not the session cookie and is required by the double-submit
design. Modern-application and session-response detection are informational classifications. One
suspicious-comment observation still lacks the bounded match evidence needed for reproduction. The
remaining observations led to explicit work rather than scanner suppression:

- explicit cookie isolation: #470;
- CSP and proxy capability disclosure: #471;
- reproducible passive-alert evidence: #472.

### Browser and proxy disclosure retest

The #471 retest used commit `918011b8c863e27e9e4a1c2fd17f4fbc6127e172` and qualified image
`sha256:2c0b5af51fc09f1aecfaf20bc4263f7ec58538f5fefc2b8b32ebe61e338e56ee`.
UAT verified the response through Caddy before safe attempt 1 of run `issue471-closed` reused that
exact image. All 28 native deployment checks passed or were not applicable. Each of the five
public response checks observed the narrowed image policy and no `Server` or `Via` header.

ZAP still reported rule `10055` once for `GET /`. Its stable fingerprint
`sha256:971c33107d4bf2efa1ba8cf7eccee04bc287bea807d095b46f782e87e37ca6e2` matches the
time-bounded acceptance in `security/exceptions.json`: arbitrary HTTPS images remain necessary for
administrator-selected club branding until same-origin asset hosting exists. No scanner rule was
disabled. The provenance-bound lifecycle validates it as a P3 finding and transitions it to
`accepted-risk` with that acceptance as its reference. Its protected record has digest
`sha256:337874e6daaf6b696e3ad97b4f977ac8d4dc5155c79b85a0bbe7c8b268571247` and remains
local until 24 September 2026. The redacted
[`passive-baseline-finding-summary.json`](../security/passive-baseline-finding-summary.json) has
digest `sha256:b959f93623401bbe18c13ee1715050e2bd70c9dad4296c50b1963015ea6d6ac3`.
The attempt remains `incomplete` because 16 other passive candidates still await the rule-specific
evidence tracked in #472.

The active attempt retained 66 OpenAPI candidates. They reduce to three attributable classes:

- a nullable audit payload makes the administrative log fail with a server error: #467;
- actual responses and the published formats disagree for problem instances and local times: #468;
- proxy and documented validation outcomes are not represented correctly by the fuzzer policy:
  #469.

The baseline remains incomplete until those classes are fixed or receive reproducible lifecycle
dispositions and the same seed is retested. The records do not treat a scanner observation as a
validated vulnerability. No critical or high vulnerability was validated in these attempts.

## Coverage gaps

The catalog contains 15 implemented entries: 12 automated and three hybrid. One additional entry is
explicitly blocked. Administrative multi-factor authentication remains blocked by #69; it was not
silently counted as executed. Destructive resource-abuse testing is outside this safe-and-active
baseline and remains manual-only.

The control-specific manual WSTG 4.2 and ASVS 5.0.0 Level 2 record is not complete. In particular,
physical-device client review, operational evidence review and the independent-assessment intake
cannot be inferred from automated results. The baseline cannot pass until every applicable manual
control has a recorded outcome and every blocked or not-applicable control has a precise owner and
rationale.

The harmless scanner canary proves candidate creation and false-positive disposition, but not the
required remediation-to-successful-retest path. That proof must accompany the candidate retest and
may not be replaced by a unit test of the lifecycle helper.

## Gate recommendation

- Pull requests keep the existing build, static findings, contract tests and packaged browser
  journeys. Network assessment is too slow and stateful for every pull request.
- The bounded safe profile remains scheduled weekly. Any incomplete attempt is investigated; it is
  not retried over or called flaky.
- The active profile remains manually dispatched for ordinary assessments. The release workflow
  also runs it against the qualified immutable candidate and blocks publication when that automated
  assessment gate does not pass.
- Destructive resource-abuse, manual procedures and independent penetration testing remain explicit
  release activities, never scheduled against a production instance.
- That automated release gate does not complete this broader baseline. Release readiness remains
  incomplete while candidates, manual controls or the successful lifecycle retest remain open.

## Reproduction

Follow the qualification and environment sequence in
[`security-environment.md`](security-environment.md), then execute the safe and active commands in
[`security-assessment.md`](security-assessment.md) with one resolved image digest. Preserve the first
attempt manifests, use the exact active authorization string, classify observations through
[`security-findings.md`](security-findings.md), and finish with the ownership-checked cleanup. A new
run uses a new run identifier; it never overwrites this baseline's evidence.
