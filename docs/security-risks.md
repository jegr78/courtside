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

## Request budgets bound each principal, not the whole instance

Admission control gives every signed-in account and every client address or IPv6 /64 its own
budget. A caller holding many accounts or many address prefixes gets one budget for each, so the
total load it can send grows with what it controls; the per-class bulkheads still cap demanding work
for the whole instance. The instance remembers 50,000 budgets and forgets the least recently seen
first, so a caller cycling through more prefixes than that can return to a full budget. Visitors
behind one clubhouse address share that address's budget until they sign in. Reconsider an
instance-wide budget when production evidence shows sustained load from many principals at once.

## Account recovery exposes bounded availability and timing differences

Known and unknown recovery subjects receive the same status, headers and body. Execution time can
still differ because a known subject creates mail work. Source and subject windows limit sampling.
The shared subject window lets another caller delay recovery for that username, and a shared source
address can make unrelated members share a limit. Neither blocks sign-in, and the board can issue
credentials from the roster.

## A message can reach its recipient twice

The outbox hands a message over and records the outcome in one transaction. A process that stops
after the relay accepted the message and before that transaction commits leaves the row queued, and
a later pass sends it again after the five-minute lease, under the same `Message-ID`. A repeated
credential or reset code is a new one that replaces the first, so only the last mail works. Nobody
can cause this from outside: it needs the application killed during a handover, which a deploy
avoids by letting the outbox finish within its stop grace. The bound is one repeat per crash and
message. Reconsider if the relay offers an idempotent submission keyed by `Message-ID`.

## A cached booking page keeps an access code until the next refresh

The installed app keeps the member's last bookings page and the first page of bookings they play in
in the browser cache so both still show without a connection, and those pages hold the static access
codes of the bookings. The client
stops showing a code once its validity window has ended, but the cached response itself keeps it
until the next successful refresh, sign-out or the cache's seven-day limit. Reading it needs access
to the unlocked device or its browser profile, and it yields only the codes of that member's own
bookings and of the bookings they play in, which the board changes at its keypad. Reconsider if access codes become per-booking
dynamic codes, or if a club reports codes leaking from devices.

## A members' door code outlives a membership

Every current member reads the static code of an access point open to members in the app, with or
without a booking. A static code cannot be withdrawn from somebody who has read it, so a member whose
membership ends keeps knowing the code until the board changes it at its keypad. The installed app
also keeps the last answer in the browser cache, without an end of validity, until the next
successful refresh, sign-out or the cache's seven-day limit, so a device that stays offline keeps
showing it. Reading the cached code needs the unlocked device or its browser profile. Changing the
code tells every current member the new one and nobody else. Reconsider if a club needs a door that
stops opening for a departed member on the day the membership ends, which only a per-member dynamic
code can do.

## An emergency code is a permanent shared code

An access point without a static code may keep an emergency code that the board leaves on its
keypad for the case that a booking's own code is missing or does not work. It is one code for
everybody: any booker or player of a booking behind that access point may ask for it in the app while
the booking's window is open, and whoever asked once keeps knowing it, and can open the door with it,
until the board changes it at the keypad and in Courtside. Asking needs a signed-in account that takes
part in such a booking. The audit log records each answer with the account, the booking and the
access point, never the code, so a board can see who learned it; Courtside does not rotate it, limit
how often it is asked for or alert anybody. `access_point.emergency_code` is stored in clear, like a
static code. Reconsider if a club needs the emergency path to stop working for one member, which only
a per-booking fallback code can do, or if the audit shows the code asked for without a failing grant.

## The occupancy key travels in the query string

Building automation reads `GET /api/public/occupancy?key=<key>`, with the key in the URL because a
Loxone Virtual HTTP Input sends no request headers. A URL is recorded in more places than a header:
a reverse proxy, a router or the automation's own configuration and logs may keep it outside
Courtside. Courtside itself masks the query value as `key=[REDACTED]` before its request logging
reads it, its operational log redacts any `key=` value it collects, the reference `deploy/Caddyfile`
writes no access log and the UAT proxy strips the query from what it logs. Whoever holds the key
learns, per active court, whether it is occupied and how many minutes remain until its next
booking, nothing about who booked or which card, and can change nothing. The reference deployment
accepts the request over HTTPS only; Courtside itself does not require it, so a club that serves this
path over plain HTTP behind its own proxy also exposes the key on the network. A board revokes or replaces
the key on the access points page and the old one is refused on the next poll. Reconsider if the
answer grows to carry anything about a person or a booking, or if a supported poller can send a
header.

## A dynamic access code is stored in clear while a door may accept it

With an access-control connector selected, `access_code.code` holds each grant's code as typed,
because Courtside sends it again after a move or a failed attempt and hands it to the booking's
players. Reading it needs access to the database or a backup. A code is drawn when its booking enters
the booking horizon, the longest advance window of any rule set or 14 days when no rule set has one,
and stays until the latest window any install asked for has ended, a confirmed removal included. So the exposure is the horizon plus
the validity window, not the hours of the booking. No event, log line, stored failure, problem body
or administrative response carries it. Reconsider if an access-control system can accept a code
Courtside keeps only as a digest, or if a club's horizon grows beyond a few weeks.

## A code may stay valid at the door after an unclear call

An install whose answer was lost, timed out or failed counts as applied, and Courtside revokes it
once the booking no longer wants it. Until that revoke succeeds, and at the latest until the window
end the install asked for, a door may still accept the code. A late install the system processes
more than two call deadlines after it was sent, behind a later revoke, can also outlive that revoke
until the same bound. Exploiting it needs the code, which only the booking's players received, and
the bound is the booking's own window plus the club's minutes after it. Reconsider if a connector
can confirm what the system holds, which the reconciliation of the access-control connector is meant
to provide.

## A rescheduled grant that keeps failing keeps its old window

When a booking moves and the system answers the reschedule with a failure that is not a refusal,
the grant keeps retrying while the door still holds the window it was installed with. The old window
stays valid until a reschedule succeeds or the grant is refused, which revokes it; the board sees the
grant as waiting and then failing after five attempts. The exposure is the booking's previous slot,
open to the code its own players received. Reconsider if clubs report moved bookings whose players
were let in at the old time, or if a connector can move a window atomically.

## Switching the connector off leaves installed codes at the door

An operator who sets `COURTSIDE_ACCESS_CONTROL_CONNECTOR` to `none`, or points it at another system,
while grants are installed stops the worker that would revoke them. Every dynamic code the old
system holds keeps opening its doors until the window it was installed with ends, a cancelled
booking's code included. Using it needs the code, which only that booking's players received, and
the switch needs operator access to the deployment's environment. The bound is the latest window any
install asked for, the booking's end plus the club's minutes after it. Reconsider if clubs switch
systems while bookings are live, or if a revoke-all operation for the old connector is approved.

## The Loxone technical user can change every non-admin Miniserver user

The Loxone connector signs in as one Miniserver user with the user-management right, because
creating and deleting a timespan user per booking needs it. That right reaches every non-admin user
on the Miniserver, not only the `courtside_` users Courtside creates: whoever holds the token or the
password can change codes, groups and validity of every resident or member account the Miniserver
keeps. Using it needs the password from the deployment environment or a token taken from a running
instance's memory or its traffic to the Miniserver, which runs over verified HTTPS.

The connector itself edits and deletes only users whose listed name has the `courtside_` shape and
that are not administrators, refuses any group outside the normal groups its last probe read, and a
user manager cannot touch admin users or admin groups at all. Reconsider when Loxone offers a right
that is limited to the users or groups one client created.

## The Loxone password sits in the deployment environment

`COURTSIDE_ACCESS_CONTROL_LOXONE_PASSWORD` is read from the environment like the mail password.
Anyone who can read the container's environment, the `.env` file or the process environment of the
running container can read it and sign in to the Miniserver as the technical user. It never appears in a
log, a startup message, an API response or `last_failure`, and actuator exposes only health.

The bound is the deployment's own access control for the host and its secrets. Reconsider when the
reference deployment moves the other credentials into file-based secrets; this one follows them.

## The Loxone group list is per instance and as old as the last probe

A board picks an access point's group from the normal groups the last successful probe read. The
list lives in the instance's memory, so after a restart it is empty until the next probe, and a
second instance behind the same database may show a different age. A group removed on the Miniserver
after that probe can still be picked; the connector then refuses the grant with "Loxone group not
found" and the board sees it failing. A group added since then is missing until the next probe.

No access is needed beyond the board's own; the exposure is a stale choice, not a widened one,
because the connector checks every assigned group against the same list before it sends anything.
Reconsider when the list is stored with the time it was read or refreshed on a board's request.

## The Loxone time base is an assumption until a door has confirmed it

A Miniserver user's validity is sent as seconds since 2009-01-01 00:00 without a zone. Courtside
assumes the Miniserver's local wall time in the club's configured zone. If the Miniserver counts in
UTC instead, every booking's window at the door shifts by the zone's offset, one or two hours in
Central Europe: a code then opens that much too early or too late and closes that much early or
late. Nobody needs access to cause it; it follows from the assumption.

The bound is the access window's minutes before and after a booking, which absorb part of the
shift, and the emergency code a member can ask for where the club keeps one on that keypad. The
acceptance on a real Miniserver checks a window at a door. Reconsider, and correct the conversion,
as soon as that check has run.

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

Release Please uses a fine-grained personal access token, because a pull request or tag created with
the workflow's own token starts no checks and no release workflow. It can write contents, pull
requests and issue labels in this repository. It cannot change workflows or publish the final
release alone.

Three jobs hold it. `release-please` runs only after a push to `main` or to a `release/*` branch,
which carry the same protection, maintains that branch's release pull request and, for a release
commit, creates the branch `release-anchor/v<version>/<sha>` at it. The candidate's `anchor` job
runs only for a selected release and creates that branch when it is missing; it installs no
packages. The `tag` job runs only for a release commit on the branch its version belongs to whose
candidate evidence succeeded, and uses the token to create the version tag, relabel the merged
release pull request and remove the version's anchors. The token acts with its issuer's repository
ceiling, including the single maintainer's admin bypass. Reconsider when GitHub provides a
repository identity that can trigger the same pipeline without a personal token.

## Stalwart fetches its administration interface outside the pinned image

The pinned Stalwart image downloads WebUI v2 from GitHub on first start. The release URL follows a
moving major-version tag and no content digest binds the asset. An attacker who replaces that upstream asset
could change the administration interface. Stalwart requires bundles declaring major version 2 and a compatible minimum server version.
The administration port is bound to loopback for setup and recovery. Closing the remaining gap
requires a maintained image or vendored interface. Reconsider when Stalwart verifies the bundle
against a digest supplied by its pinned image.

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

## The documentation link a club configures is world-readable

`GET /api/public/config` answers without authentication, and `documentationUrl` is part of that
projection because the footer renders before anybody signs in. The value pattern permits userinfo
and a query, so `https://user:pass@wiki.example.org/` and `?token=…` are both accepted, and a board
that points the link at an internal page hands that address to every visitor. The imprint and
privacy links carry the same exposure, but those name pages a club publishes on purpose, and a
documentation target need not be one. The board guide says the link is public; narrowing the
pattern would change all three link fields and is reconsidered when a club reports a need.

## The shipped documentation link names a personal GitHub namespace

A club that configures no target gets `https://jegr78.github.io/courtside/`, so every instance
carries that host in a link that is always visible. GitHub releases a user name once it is freed,
and whoever registers it then serves that address. This is the reason the problem types in this
product are URNs rather than `https://` URLs. Reconsider when the documentation moves to a domain
or an organization the project controls.

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

## Synchronized passkeys may not supply a clone-detection counter

Courtside permits credentials that consistently report a zero signature counter, as synchronized
passkeys may do. If an attacker obtains both the private credential and the account password, a
zero-counter copy cannot be distinguished from the enrolled authenticator by its counter. Every
assertion still needs a fresh, session-bound challenge, the configured origin and RP, and signed
user verification. Nonzero counters must increase. Reconsider this bound if supported authenticators
provide another interoperable clone signal or the product adopts an explicit credential restriction.

## Administrator MFA remains voluntary

An administrator who has not enrolled a second factor can still sign in with a password alone.
An attacker needs that account's password to obtain its administrative access. All roles may enroll
TOTP or WebAuthn, and enrolled accounts require a factor on every new sign-in and sensitive-action
proof. Initiating another account's controlled recovery additionally requires an MFA-authenticated
administrator. Voluntary enrollment does not establish the blanket ASVS Level 2 authentication
strength claim for every administrator. Reconsider this bound only if the product adopts mandatory
administrator enrollment; the current MFA contract explicitly excludes a role-based mandate.

## A known password can pause its holder's second-factor sign-in

Someone who knows an account's password can submit wrong second-factor proofs for it. Every five
consecutive failures pause that account's sign-in and sensitive-action proof, starting at one
minute and doubling up to 24 hours, until a proof succeeds or 30 days pass without a failure. The
holder therefore also waits out the current pause. The first pause of a run mails the holder, who
changes the password through account recovery; the attacker can then no longer start a proof, so
the pause stops growing. This bounds guessing to a few attempts per day after the first hours.
Reconsider this bound if the product gains a way to prove the holder's identity that an attacker
with the password lacks, such as a pause that a recovery code lifts.
