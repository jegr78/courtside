# Privacy kit

This kit helps a club document how it runs its Courtside instance under data-protection law. It
holds three templates to adapt: the record of processing activities, the technical and
organisational measures and the privacy notice of the application.

::: warning No legal advice
The club is the controller of its members' data. It decides the lawful basis, the retention periods
and how the instance is run. Courtside supplies tools and these templates, not legal advice. Check
the texts with your board and, when in doubt, with a qualified adviser before you use them.
:::

## How to use the kit

1. Read [What Courtside stores](#what-courtside-stores). It describes what the application itself
   keeps and holds for every instance.
2. Copy the templates into a document of your own. Replace everything in square brackets with your
   club's details, for example `[Name of the club]`.
3. Decide the periods and enter them in the administration under *Records → Retention*. The
   [board handbook](board-guide#records-retention) explains how. A category without a period stays
   untouched, and Courtside deletes nothing there on its own.
4. Add what your club does outside Courtside: hosting, backups, mail delivery and who can reach the
   server.

## What Courtside stores

| Area | Data | Purpose | End |
|---|---|---|---|
| People | First and last name, email address | Member administration, access, messages | *Former members* period after the membership ended |
| Membership | Membership type, start, end | Booking rights, statistics | with the person |
| Accounts | Username, password as an Argon2id hash, language, roles, last sign-in | Sign-in and permissions | with the person |
| Bookings | Court, time, card, status, booking account, players, guest names, notes | Court allocation | *Bookings* period pseudonymises the people and notes, time and court stay for utilisation |
| Waiting lists and open places | who waits for a court or looks for a partner | Court allocation | after the slot |
| Attendance | attended or not, who recorded it | Rules against no-shows | pseudonymised with the booking |
| Messages | kind, status and identifiers of the booking concerned | Notification, delivery record | with the account |
| Change log | kind of change, identifier concerned, acting account, time; no names and no free text | Traceable administration | stays, names only an identifier once a person is removed |
| Sessions | session identifier, account, times | staying signed in | after inactivity or expiry |
| Operational logs | redacted messages without names or email addresses | Diagnosis | bounded rotating storage |

In the browser Courtside keeps the chosen language and appearance in local storage and holds the
member's own upcoming bookings for display without a network. The session runs on a cookie used
only for signing in, and a second cookie protects forms against forged requests. Courtside embeds
no tracking or advertising services.

The administration answers a subject access request under *People and accounts* with *Produce the answer*.

## Template 1: Record of processing activities

```text
Controller: [Name of the club], [address], [email address]
Represented by: [board under the statutes]
Data protection officer: [name and contact if appointed, otherwise "not appointed"]

Name: Court booking and member access with Courtside
Purposes: allocating and managing courts, members' access to booking,
  messages about bookings, evaluating court utilisation
Lawful basis: [to be decided by the club, for example the membership under the statutes]
Data subjects: members, former members, guests a member brings,
  people with administrative roles
Categories of data: see "What Courtside stores"
Recipients: [hosting provider], [mail provider], internally the people with the
  Administrator role and the roles a booking card lets manage it
Transfers to third countries: [none / country and safeguard]
Erasure periods:
  Bookings: pseudonymised [number] months after they ended
  Former members: removed [number] months after the membership ended
  Sessions: after inactivity or expiry, automatically
  Operational logs: [retention in the club's own operation]
Technical and organisational measures: see template 2
```

## Template 2: Technical and organisational measures

The first list describes what Courtside brings. The club fills in the second for its operation.

**Provided by Courtside**

* Passwords exist only as an Argon2id hash. Failed sign-ins are limited.
* Sessions live on the server and end after inactivity or expiry. An account can end all of its own
  sessions.
* Roles limit who sees the administration. Critical steps such as the retention run require a
  fresh password confirmation.
* Forms are protected against forged requests.
* The change log records administrative changes without names or free text.
* Application logs contain no names, email addresses or request content.
* The club sets the retention periods itself. Every run starts with a preview and needs an explicit
  confirmation.

**To be filled in by the club**

```text
Server operation: [own server / hosting provider, data processing agreement of ...]
Encrypted connection: [TLS through the bundled reverse proxy / own solution]
Access to the server: [people and kind of access]
Backups: [location, frequency, encryption, retention]
Updates: [who installs updates and how often]
Accounts with the Administrator role: [people, reviewed at least yearly]
Mail delivery: [provider, data processing agreement]
Handling a data breach: [person in charge, reporting path]
```

## Template 3: Privacy notice of the application

```text
Privacy notice for court booking

[Name of the club], [address], [email address] is responsible for court booking.
[Contact of the data protection officer if appointed.]

What we process
For your membership we store your name, your email address, your membership type and the dates of
your membership. For signing in we store your username, your password as a hash that cannot be
reversed, your language, your roles and the time of your last sign-in. For court booking we store
court, time and kind of your bookings, who plays, the names of guests you enter, notes and whether
a booking was attended.

Why
We use them to allocate the courts, apply the club's booking rules, send you messages about your
bookings and evaluate how the facility is used. Evaluations name nobody.

Lawful basis
[to be decided by the club]

Who sees the data
The court plan is public and shows taken courts with the number of participants but without names.
You see names only on your own bookings. People with administrative roles see what their task
requires. [Hosting provider] and [mail provider] process data on our behalf.

How long
Bookings are pseudonymised [number] months after they ended: name, players, guests and notes are
removed, court and time stay for utilisation. After your membership ends your data is removed after
[number] months unless you signed in during that time.

In your browser
The application stores your language and appearance in the browser and holds your upcoming
bookings for display without a network. One cookie keeps you signed in, a second protects forms
against forged requests. There are no tracking or advertising services.

Your rights
You have the right of access, rectification, erasure, restriction of processing, data portability
and objection, and the right to lodge a complaint with a supervisory authority. Write to
[email address]. You change your password yourself in the application, the board corrects
everything else.

Last updated: [date]
```
