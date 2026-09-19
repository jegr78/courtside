# Accepted security and privacy limitations

This register describes limitations in the current product that have no proportionate approved
correction. It is not a roadmap. Product changes belong in issues. Expiring exceptions for scanner
or assessment findings belong in [`security/exceptions.json`](../security/exceptions.json).

Each entry names the exposure, its current bound and the condition for reconsidering it.

## Operational-log sources are claimed, not authenticated

The reference deployment's Docker logging drivers send records to a UDP listener bound to host
loopback. Any other local process can reach that listener and imitate the fixed application,
database or proxy tag. The administrator view therefore labels sources as reported, timestamps
records on receipt and warns that the stream is diagnostic rather than audit evidence. Closed tags,
strict parsing, pre-storage redaction, a 50-datagram-per-second limit, coalesced status writes and
bounded rotation constrain forgery and write amplification but cannot establish provenance.

Reconsider this limitation when the reference deployment can use an OS-permission-protected local
transport supported by both Docker's logging driver and the collector, or when a mutually
authenticated external collector becomes part of the reference architecture.

## Private deployment hops use optional certificate verification

The standard single-host deployment uses private Compose networks between the application,
PostgreSQL and Caddy. PostgreSQL's default `prefer` mode does not verify a server certificate, and
the default Caddy-to-application hop is plain HTTP.

An observer needs access to the host, including its loopback interface, or to its private container
networks. The database port is not published. `production-architecture.json` records the application
listener exposed by each recipe. Operators may enable verified TLS for either hop. Reconsider the
default if the reference architecture places one across hosts or a shared network.

## Setup and migration reach an external database unverified unless the operator says otherwise

`existing-infrastructure` puts every database hop on the operator's own network instead of a private
one. That already held for the application's connection; separated identities add the setup and
migration processes, which carry the owner and migration credentials. Selecting `database-tls` sets
`verify-full` on the application alone. Setup and migration read `COURTSIDE_DB_TLS_MODE`, which
defaults to `prefer`, so that overlay on its own leaves them unverified while the application is held
to the trust anchor.

`prefer` attempts TLS and continues in the clear when the server declines, so against a database
that serves no certificate a passive observer on the path reads the whole setup session. An active
one needs no certificate either: nothing constrains which authentication method the driver accepts,
so a server that asks for a plaintext password is answered with one, and the owner credential is the
most privileged the deployment holds. Courtside writes the migration and runtime passwords as
verifiers rather than sending them, which bounds what a rotation exposes but not the owner's own
login.

Setup and migration run during installation, upgrade and credential rotation only, and their
container is the first to hold the owner credential with a route off the host; the bundled database
keeps the same two processes on an internal network. The continuous member-data connection is
covered by `verify-full` wherever `database-tls` is selected. Setting `COURTSIDE_DB_TLS_MODE` to
`verify-full` in `.env` closes the gap, together with `database-tls`, which supplies the trust anchor
those two processes would otherwise look for in an empty directory. `deploy/README.md` says so where
it describes the combination. This entry ends when selecting `database-tls` holds all three processes
to the anchor without that variable.

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
