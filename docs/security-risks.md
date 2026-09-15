# Accepted security and privacy limitations

This register describes limitations in the current product that have no proportionate approved
correction. It is not a roadmap. Product changes belong in issues. Expiring exceptions for scanner
or assessment findings belong in [`security/exceptions.json`](../security/exceptions.json).

Each entry names the exposure, its current bound and the condition for reconsidering it.

## Private deployment hops use optional certificate verification

The standard single-host deployment uses private Compose networks between the application,
PostgreSQL and Caddy. PostgreSQL's default `prefer` mode does not verify a server certificate, and
the default Caddy-to-application hop is plain HTTP.

An observer needs access to the host or its private container networks. No database or application
port is published. Operators may enable verified TLS for either hop. Reconsider the default if the
reference architecture places one across hosts or a shared network.

## Password-hash age can affect failed-login time

A wrong password for an older Argon2 encoding may take a different time from a wrong password for
an unknown username, whose dummy verification uses the current cost. An observer needs repeated
samples through network noise. Rate limiting bounds sampling, and successful login upgrades an old
hash. Reconsider padding if measurements show a reliable distinction.

## Account recovery exposes bounded availability and timing differences

Known and unknown recovery subjects receive the same status, headers and body. Execution time can
still differ because a known subject creates mail work. Source and subject windows limit sampling.
The shared subject window lets another caller delay recovery for that username, and a shared source
address can make unrelated members share a limit. Neither blocks sign-in, and the board can issue
credentials from the roster.

The mail pool may run work on a request thread when saturated. Separate sign-in capacity and request
limits bound the effect. Reconsider when production evidence shows request starvation.

## Reset codes use an unkeyed digest

An outstanding reset code is stored as SHA-256 of a short random code. Read access to a current
database or backup permits offline guessing during its lifetime. Redemption deletes the row and
expiry is short. A keyed digest needs an instance secret with rotation and migration support.
Reconsider when Courtside has a general secret lifecycle that can own that key.

## Shared mailboxes share recovery authority

Anyone controlling a mailbox can receive credentials and reset codes for every account registered
to it. The roster and import preview show shared-mailbox counts before issuing credentials.
Correcting an address invalidates credentials sent to the old one. Forbidding shared addresses
would exclude clubs that use family mailboxes.

## Person-related identifiers remain in authorized URLs

Random identifiers such as `personId`, `bookingId`, session handles and cursors appear in paths or
queries. An upstream log can correlate requests carrying the same value. The identifiers contain no
user-entered identity and resolve to personal data only through authorized operations. The reference
deployment writes no access log. Reconsider only with a design that also removes them from browser
routes instead of moving the same correlation elsewhere.

## Roster exports are not audit events

An administrator can export the roster without creating an audit event. The audit model currently
requires one subject, while a roster export concerns the instance. The Product Backlog owns an
instance-wide audit shape and operational-record exports. Until then, Courtside cannot report who
exported the roster or when.

## Assessment instrumentation remains in the image

The image contains a response filter used only with `COURTSIDE_ENVIRONMENT=SECURITY`. It repeats the
host and scheme observed by the application so an assessment can verify proxy canonicalization. An
operator could enable it in a club deployment, but the headers reveal only values sent by the same
client. Build tests permit no other assessment-only production class.

## Static web-resource inspection cannot detect hidden destinations

The published-resource inventory reads source and built text. It catches literal origins,
credentials and comments but cannot prove that code does not assemble a destination at runtime.
Every shipped file is committed and reviewed. Deliberate obfuscation remains a review concern.

## Release automation uses a maintainer-owned token

Release Please uses a fine-grained personal access token because a tag created with the workflow's
own token starts no release workflow. It can write contents, pull requests and issue labels in this
repository. It cannot change workflows or publish the final release alone.

The token acts with its issuer's repository ceiling, including the single maintainer's admin
bypass. The workflow runs only after a push to `main`. Reconsider when GitHub provides a repository
identity that can trigger the same pipeline without a personal token.

## Stalwart fetches its administration interface outside the pinned image

The pinned Stalwart image downloads its administration interface from the latest GitHub release on
first start. The content is outside the pinned image digest. Its port is bound to loopback for setup
and recovery. Closing the gap requires a maintained image or vendored interface. Reconsider when
Stalwart offers a version-bound artifact.

## A refused Stalwart reload can replace the valid certificate

Stalwart may discard its previous certificate after refusing a reload and serve a self-signed
fallback. The helper remains unhealthy and retries. The application refuses the fallback instead
of sending mail over the downgraded hop. Caddy validates a pair before publishing it. Reconsider
when Stalwart retains the last valid certificate or offers an atomic reload.

## Active security suites do not run for every application pull request

The required pull-request build runs contract, schema, source and passive checks. The active
assessment is manually dispatched, while a weekly safe assessment runs against `main`. An
application-only change can reach `main` before active authorization and scanner suites exercise it.
Reconsider when their measured runtime fits the normal gate or a scheduled active profile has an
agreed budget.

## Passive scanner dispositions depend on review

A checked-in disposition can classify a passive scanner observation. It matches rule, route,
method, risk, confidence, scanner version and observation text. Changed input fails closed. The
mechanism proves that the record matches, not that its conclusion is correct. Changes under
`security/` therefore require explicit review.

## Leftover-file probes cover anonymous access only

The passive suite requests representative backup and editor-file paths without a session. It proves
that an anonymous caller receives no file, not what an authenticated account would receive. Caddy
has no document root, the image is read-only and the published-resource inventory rejects an
unclassified static resource. Reconsider if authenticated static serving is added.

## Scheduled failures appear in public issues

The failure tracker opens a public issue naming the workflow, job, failed step, commit range and
run. It does not copy findings, credentials, requests or protected evidence. The repository and
Actions history are already public, while the issue shortens the time a red gate can go unnoticed.

## Reduced pull-request profiles depend on correct classification

Pull requests run checks selected from closed path inventories. Unknown files, deletions, renames,
classifier failures and policy changes select the full build. Main and scheduled builds run every
check. A wrong mapping can therefore surface after merge. Reconsider shadow comparison only when it
can measure misses without paying full-build cost on every pull request.

## Some security controls rely on documented reasoning

The assessment catalog contains controls whose universal wording cannot be proved by one artifact.
Their rationale remains visible and is not reported as automated evidence. Courtside does not claim
complete conformance from those entries. A control with a concrete product remedy becomes tracked
work. Reconsider when an inventory or executable test can replace the reasoning.
