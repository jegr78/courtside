# Acceptance testing

The acceptance harness in `acceptance/` walks a release candidate on a deployed instance. It signs
in as each club role, books, moves and cancels on ten browser profiles in light and dark themes and
in German and English, captures every surface it passes, checks each capture for layout,
accessibility and console problems, and leaves the instance as it found it.

It differs from the journey catalogue in `frontend/e2e/journeys`, which runs against a freshly
seeded local stack. The harness runs against an installed instance with real accounts and the data
the club already holds, so it books only on lanes it has proven free and removes everything it
created.

## What the instance needs

- Accounts for the journey actors in `personas`: an administrator, a trainer, a youth director, a
  sport director, a groundskeeper, a treasurer, three plain members and one to three disposable
  members. All share one password.
- A disposable account may have its password, language and active state changed during the run;
  the harness restores it afterwards. The disposable journeys run on three profiles; with three
  disposable accounts each profile uses its own.
- Active booking cards that the trainer, youth director, sport director and groundskeeper may use,
  and the shipped "looking for a partner" participant card active. The participant journey books
  with it, offers the open place and lets a second member take it.
- At least two active courts. Weekday lanes use the first two courts of `courts`; the five
  Saturday lanes spread over every court in `courts`.
- Opening hours that leave fifteen hours from opening on each weekday of the window. On its
  Saturday the five lanes need one hour per court round plus one hour for the later opening: three
  hours with three courts, four with two. A lane day that is closed or too short stops the run
  before it books anything, naming the profile and the day.
- A booking grid whose slot length divides an hour.
- No opening week scheduled after today, no club booking on the window's Sunday, and none on its
  Saturday before the latest later opening the weekend journeys schedule. The preflight names
  each one it finds. With `notifyClubBookings` such bookings stay in place and their bookers are
  told about the changed hours; the report counts them.
- Mail delivered to a catcher, never to members. The journeys change opening hours, and the
  instance tells members about bookings those changes affect.
- The Mailpit API of that catcher for the journeys that read mail. Without `mail.url` those
  journeys are reported as not checkable, never as passed.

- For the booking-hours journey, `personas.restricted`: a member whose membership type carries a
  `BOOKING_HOURS` rule that the earliest lane hour of the day lies outside, for example from 16:00.
  The journey opens that hour, expects the dialog to refuse it and sends the booking to the server
  as well. Without the persona, or with hours the lane hour lies inside, it is reported as not
  checkable.
- For the welcome, `welcomeAccounts`. The journey creates one account on desktop-chrome to read
  its welcome and deactivates it again. Courtside has no erasure path yet, so with `erasure` the
  postflight removes that account and its person in the database: over `ssh` it runs `psql` in the
  named container, in one transaction, and only for persons this run recorded with an
  `acceptance-welcome-` address whose `acceptance-welcome-` account is deactivated or was never
  created, and who hold no booking, membership, participation, queue or import reference. A person
  whose account creation failed therefore leaves nothing behind either. Without `erasure` the run
  writes the statement to `erase-welcome-accounts.sql` and the person stays on the roster.

The member journeys also walk what members hear. The contention journey queues the refused member
on the waitlist, cancels the holder's booking and takes the offer from the notification centre;
the singles journey tells the partner of a cancellation. A queue a journey leaves behind is left
as its member, because only that member sees it, and the postflight requires none to remain.

## Configuration

`ACCEPTANCE_CONFIG` names a JSON file outside the repository. `ACCEPTANCE_PASSWORD` carries the
shared password of the test accounts; it never appears in the file. `acceptance/config.example.json`
shows the shape with placeholder accounts.

| Field | Meaning | Required |
| --- | --- | --- |
| `baseUrl` | Instance under test | yes |
| `expectedVersion` | Version the preflight must read from the instance | yes |
| `personas` | Username per journey actor: `admin`, `trainer`, `youth`, `sport`, `grounds`, `treasurer`, `memberA`, `memberB`, `memberC`; `disposable` takes one username or a list; `restricted` names a member whose category has booking hours | yes, `restricted` no |
| `timeZone` | Club time zone; default the zone the instance reports | no |
| `window.start` | Monday of the booking window; default the first Monday after the run starts | no |
| `courts` | Court numbers the journeys use; default the first three active courts | no |
| `mail.url` | Mailpit API | no |
| `logs.app`, `logs.proxy` | Log files the operator writes alongside the run | no |
| `metrics.url` | Prometheus query endpoint for request latency around failures | no |
| `browsers.firefox.wsEndpoint` | Remote Firefox launch server; default a local Firefox | no |
| `loadLimit` | One-minute load average the run waits to fall below before it starts; default 5.5 | no |
| `resetCodesPerHour` | Password-reset codes the instance mails per account and hour; default 5, the instance's own default | no |
| `notifyClubBookings` | Let the weekend journeys run over club bookings and notify their bookers; only for an instance whose mail reaches a catcher; default false | no |
| `welcomeAccounts` | Let one profile create an account to read its welcome; default false | no |
| `erasure.ssh`, `erasure.container` | SSH host and database container through which the postflight erases the welcome accounts the run created | no |

The file is validated before any browser starts. A missing or malformed field, two actors sharing
one username, a window start that is not a Monday or fewer than two courts stop the run and name
the field.

Every slot is converted to an instant through the club time zone, so a window across a change of
daylight saving time books the intended local hours. "Today" is the club's today, not UTC's.

Each run asks for one password-reset code per disposable profile, and a repair may ask for one
more. The instance limits reset codes per account and hour, so the preflight counts the codes each
disposable account received in the last hour and starts only when the run's codes still fit;
otherwise it names the time they will. Three disposable accounts let one run follow another
without waiting.

## Running

```bash
cd acceptance && npm ci && npx playwright install
ACCEPTANCE_CONFIG=/path/to/config.json ACCEPTANCE_PASSWORD=… node acceptance/run.mjs
```

A run writes into its own directory under `build/acceptance/` and refuses a directory that already
holds results. It waits until the load average is below `loadLimit`, then runs setup, discovery
and preflight, the journeys on all ten profiles, the postflight and the report.

- `--phase matrix` runs only the journeys; `--project <profile>` narrows them.
- `--phase postflight --run <dir>` cleans up after an interrupted run.
- `--phase report --run <dir>` renders the report again, for example after the review.

Discovery writes `lanes.json`: the window, and for each profile and journey its day, court and
hour. Preflight then proves every lane slot free before a journey starts.

The harness cancels only bookings and removes only opening weeks it recorded in its ledger. A
booking or week of the club in its way stops the preflight or the journey that needs it and is
never touched; choose another `window.start` or other `courts`. Each opening week a journey
schedules is followed the next day by a copy of the hours in force, so the change governs one day.

The harness starts no log or tunnel process. To attribute server log lines to journey steps, follow
the instance's logs into the files `logs.app` and `logs.proxy` name for the duration of the run,
for example with `docker logs -f --timestamps --since <start> <container> >> <file>` on the host
that runs the instance.

Contact sheets and report images need ImageMagick on `PATH`; without it the run skips the sheets
and the report embeds the original screenshots.

## A real iPhone

The iPhone profiles run Playwright's WebKit, which is not Safari. `acceptance/device/iphone.mjs`
checks the same instance in Safari on an iPhone connected to a Mac by cable:

```bash
cd acceptance
ACCEPTANCE_CONFIG=/path/to/config.json ACCEPTANCE_PASSWORD=… DEVICE_OUTAGE_HOST=<ssh host> npm run device
```

The iPhone needs Web Inspector and Remote Automation switched on under Settings > Apps > Safari >
Advanced, a way to reach `baseUrl`, and an unlocked screen for the whole run. Quit Safari on the Mac
first; `safaridriver` ships with macOS and needs no Xcode. Safari locks the iPhone's screen while
the run drives it, and every session starts without cookies, storage or a service worker.

Signed in as `memberA`, and as `admin` for the administration pages, the run checks:

| Check | Passes when |
|---|---|
| `theme-switch` | inherited text has 4.5:1 contrast one second after switching to light |
| `select-heights` | every select in the booking dialog is at least 44 px high |
| `saved-message` | the confirmation is in view after saving the message choices |
| `member-pages` | the plan, the booking dialog, the preferences, My bookings and My messages fit the screen and have no field Safari zooms into |
| `visitor-pages` | the same for the signed-out plan, the sign-in and the account recovery |
| `admin-pages` | the same for every page of the administration navigation |
| `service-worker` | a service worker controls the page |
| `outage` | the instance becomes unreachable for the iPhone and comes back |
| `offline-bookings` | with the instance unreachable, My bookings lists a fresh booking with its offline note within 15 s, and the plan says it is offline |

The page checks run the layout probe the journeys use, `acceptance/lib/layout-probe.mjs`, with
Safari's own font metrics. A page fails when it scrolls sideways, when an element reaches past the
screen edge, or when a visible text field or select is set below 16 px, because Safari on iOS zooms
into such a field when it is tapped. Small targets, truncated text and controls under the sticky
bars are recorded as observations: the plan scrolls under its own bars by design.

Each check writes screenshots and measurements to `result.json` in its own directory under
`build/acceptance-device/` and prints its verdict; any verdict other than `pass` ends the run with
exit code 1. `DEVICE_CHECKS` selects checks by name, `DEVICE_DIAGNOSE=1` makes `safaridriver` log
its protocol under `~/Library/Logs/com.apple.WebDriver/`, and `DEVICE_CANCEL` names booking ids a
broken run left behind. That protocol log holds the shared password in plain text, because the run
types it through a script; delete it once it has served its purpose.

Safari cannot be told to go offline, and its screen lock rules out airplane mode during a run.
`outage` and `offline-bookings` therefore take the instance's HTTPS handler down for everyone, for
up to two minutes each. They expect an instance published through `tailscale serve` or
`tailscale funnel` with a single proxy handler on `/` of port 443, and an SSH host on which
`sudo -n` may run `tailscale`, `systemd-run` and `systemctl`; any other serve configuration stops
them before anything is taken down. The run records the serve status, restores it afterwards and
fails if the status differs. A timer named `courtside-serve-restore` restores it after five minutes
if the run does not, and a successful restore stops that timer. Without `DEVICE_OUTAGE_HOST` both checks are skipped.
The booking `offline-bookings` makes lies two days ahead, outside the cancellation deadline, and
the run cancels it and confirms the cancellation.

## Review

Every finding in the report carries a stable key: `axe:<rule>`, `console:<digest>`,
`http:<status>:<path>` or `failure:<file>:<title>:<profile>`. Identifiers, dates and hosts are
removed before a key is formed, so the same problem keeps its key from run to run.

`review.json` in the run directory holds an assessment for each key:

```json
{
  "assessments": {
    "axe:heading-order": { "assessment": "known-issue", "issue": 1243, "reason": "The series form skips a heading level.", "followUp": "Planned for the next minor release." }
  },
  "manual": [
    { "key": "manual:update-notice", "severity": "major", "kind": "PWA", "title": "Update notice without a deployment", "detail": "", "where": [{ "project": "desktop-firefox" }] }
  ]
}
```

An assessment is one of `product-defect`, `known-issue` (with `issue`), `capture-artefact` or
`harness-gap`, and always has a `reason` and a `followUp`. `manual` holds findings a person made
while reading the captures; their keys start with `manual:`.

A report with any finding left unassessed is a draft and says which keys are open. Assessments
for keys the run did not produce are listed as stale. Findings assessed as capture artefacts
appear under rejected suspicions, harness gaps under their own heading.

## Release summary

Each report also writes `release-summary.md`: the version, the run, the passed, failed and skipped
cells, and every finding with its assessment and issue. It contains no username, email address,
full name of anybody on the roster, instance host or image; a summary that would is refused. Post
it on the release parent or the release pull request.

Full reports and screenshots are never committed. The `report/` directory may be shared
privately. The rest of the run directory stays on the operator's machine: Playwright traces in
`test-results/` hold the shared password as typed, and `state/` holds signed-in sessions.
