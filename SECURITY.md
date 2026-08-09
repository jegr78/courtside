# Security Policy

## Supported versions

No version is tagged or published yet, so nothing is under maintenance. Once a release exists,
this section will name which versions receive security fixes.

Until then, security fixes land on `main` and are described in the commit that carries them.

## Reporting a vulnerability

Report privately through GitHub's **Security** tab → *Report a vulnerability*. That opens a
private advisory visible only to the maintainers, so the report is not public while a fix is
prepared. Please do not open a normal issue for a security problem.

A useful report says which version or commit you tested, what an attacker gains, and the
smallest sequence of steps that shows it. A proof of concept is welcome but not required.

Expect an acknowledgement within a week. This is a volunteer project, not a vendor with an
on-call rotation — if a report is urgent, say so in the title.

## Scope

Courtside is deployed by each club on its own infrastructure. Reports about the application
belong here; reports about a specific club's installation belong to that club.

In scope: authentication and session handling, authorisation across the roles `MEMBER`,
`TRAINER`, `GROUNDSKEEPER`, `TREASURER` and `ADMIN`, the booking rules that decide who may book
what, injection into the API or the database, and anything that lets one member read or change
another member's data.

Out of scope: findings that require an already-compromised database or host, missing hardening
headers with no demonstrated impact, and results from automated scanners that are not backed by
a working example.

## Known gaps

These are absent by design decision or by not being built yet, so they need no report:

- No multi-factor authentication.
- The first admin account comes from one-time bootstrap environment variables; the README
  documents the forced password-change flow and the manual SQL alternative.
- `GET /api/source` names the commit an instance is running, without a login. Fixes land on `main`
  and are described in their commit, so anyone can tell whether a given instance has one yet. That
  is what AGPL section 13 asks for — an offer of source has to say which source — and every honest
  implementation of it can be read the same way. It is accepted, not overlooked.
