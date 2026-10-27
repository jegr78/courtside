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
- The first disposable person's first name starts with `=` while the administrator downloads the
  audit log and the message log on `desktop-chrome`, so the audit export shows that a name reading
  like a formula leaves as text. The journey puts the name back in the same test.
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
- No season, holiday or court closure that closes a lane's day or court, leaves a lane outside its
  hours, or covers the window's Saturday or Sunday, where it would override the weekly hours the
  weekend journeys change. The preflight names each entry and the lane it hits.
- On the eighth and ninth day after the window, no season, holiday or court closure of the club,
  and weekly hours that open both days. The availability journey adds a holiday on the first and
  closes the first court on the second.
- On the tenth day after the window, no season, holiday or court closure, weekly hours that open
  it, and the last court free at opening time. The closure-notice journey runs on
  `desktop-firefox` only: its disposable member books that court at opening with the second plain
  member, the admin closes the court that day, and the journey reads the count in the form, the
  notice in the member's notification centre and the mail in Mailpit, then removes both.
- Every message on its shipped wording. The admin journey rewords the username reminder in German
  and English, asks for a reminder to the first plain member's address and restores the shipped
  wording; a club wording the run did not store stops the preflight, which names each one.
- Mail delivered to a catcher, never to members. The journeys change opening hours, and the
  instance tells members about bookings those changes affect.
- The Mailpit API of that catcher for the journeys that read mail. Without `mail.url` those
  journeys are reported as not checkable, never as passed.

- For the booking-hours journey, `personas.restricted`: a member whose membership type carries a
  `BOOKING_HOURS` rule that the earliest lane hour of the day lies outside, for example from 16:00.
  The journey opens that hour, expects the dialog to refuse it and sends the booking to the server
  as well. Without the persona, or with hours the lane hour lies inside, it is reported as not
  checkable.
- For the weekly-hours journey, the same `personas.restricted` with a rule set that also carries
  `WEEKLY_BOOKED_HOURS`, for example 1 hour, and `MIN_BOOKING_DURATION` longer than one grid cell,
  for example 60 minutes. The journey opens a lane, expects the dialog to name the weekly hours and
  to offer no duration below the minimum, and sends one booking short of the minimum and one past
  the week. Both are refused, so the persona never holds a booking that counts toward its week.
  Without both rules it is reported as not checkable. The preflight refuses a run in which a lane
  persona's category limits the weekly hours or asks for a booking longer than a lane hour, because
  a run books several lanes per persona in one week.
- For the no-show journey, attendance switched on in the deadlines page and a rule set for the
  disposable member of desktop-firefox that carries `NO_SHOW_LIMIT` with one no-show, for example
  over 30 days, and `erasure` configured. The product writes no booking in the past, so the journey
  seeds one started booking of that member at night two days back over the erasure path, records a
  no-show through the API, expects the next booking to be refused with
  `booking.rule.noShowLimit.reached`, lifts the no-show on the person page and expects the refusal
  gone. The preflight checks all three and refuses the run without them. Preflight and postflight
  erase the attendance recorded for every persona and the bookings the journey seeded, so a lifted
  no-show never stays behind and repeated runs never accumulate one.
- The usage journey needs nothing beyond the no-show journey. On the desktop browsers the admin
  opens the usage report from three days before today to the last lane day and expects the four
  parts to load, and neither the page nor the API answer to carry a persona's full name, address or
  person id, read from the discovery. On desktop-firefox it runs after the no-show journey of the
  same profile and expects refused attempts, a booking in the capacity and a lifted no-show.
  Cancellations are only checked for their shape, because no journey keeps a cancellation in the
  window for certain. The admin page walk follows the navigation the product renders, so a new
  administration page is walked without a change to the harness.
- The operator health journey needs nothing new and changes nothing, so it has no postflight. On
  the desktop browsers the admin opens the overview and expects version, migrations and mail to
  show one of the three states, version and migrations as ok. The backup is judged from the
  overview's own API answer: without configured evidence it must never read ok, and with evidence
  an ok reading has to carry an age that follows from its completion time. A UAT that starts
  recording backups therefore needs no change to the harness.
- The retention journey needs an instance that answers the retention periods to the administrator;
  the preflight checks it. On desktop-chrome the admin records the period of both categories in
  the ledger, sets each to another number of months on the retention page, takes a preview and
  reads its counts and the blocked people with their reason. Former members on the instance may
  make the preview count and block somebody, so the journey checks the shape and never a number.
  It never confirms a run: the page's run request is aborted, the acknowledgement stays unticked
  and the run button disabled, and only a preview id nobody created is sent to the run endpoint to
  read its typed refusal. The journey puts both periods back in the same test, and the postflight
  does so again from the ledger after an interrupted run, so the club keeps the periods it had.
- For the membership period journey, a rule set bound for people without a membership type that
  carries `NO_COURT_BOOKING`, and a first disposable member who holds one membership period running
  today that lasts past the tenth day after the window and none scheduled. The first court has to
  be free at opening on that tenth day. On desktop-chrome the journey records the member's periods
  in the ledger, and the admin moves the running period's start to tomorrow on the person page. The
  member's booking of that court is then refused with `booking.rule.noCourtBooking`. A period
  overlapping the scheduled one is refused with `membership-periods-overlap`. After the start is
  moved to today, the same booking is accepted and the member cancels it. The journey puts every
  period back in the same test and the postflight does so again from the ledger. A scheduled
  period in the preflight is what an interrupted run whose postflight also failed leaves; the
  preflight names it, and the board corrects its start on the person page.
- The guardian journey needs nothing beyond the membership period journey, after which it books the
  same court at the same hour, and no relationship between `memberA` and the first disposable
  member. On desktop-chrome the admin lets `memberA` act for that member on the person page with
  every action except account tasks. `memberA` books for the member through the booking dialog's
  choice of whom to book for, with `memberB` as partner, and the journey expects the booking among
  the member's own bookings and not among `memberA`'s. `memberA` reads the member's booking
  confirmation, which stays unread for the member, and cancels the booking. A request for new
  credentials is refused with `guardian-action-not-granted` naming the action, and once the admin
  ends the relationship today the member's bookings answer `dependant-not-found`. The journey
  removes the relationship in the same test and the postflight removes every relationship the
  ledger holds. A relationship between the two that an earlier run left stops the journey; the
  board removes it on the person page.
- For the welcome, `welcomeAccounts`. The journey creates one account on desktop-chrome to read
  its welcome and deactivates it again. Courtside has no erasure path yet, so with `erasure` the
  postflight removes that account and its person in the database: over `ssh` it runs `psql` in the
  named container, in one transaction, and only for persons this run recorded with an
  `acceptance-welcome-` address whose `acceptance-welcome-` account is deactivated or was never
  created, and who hold no booking, membership, participation, queue or import reference. A person
  whose account creation failed therefore leaves nothing behind either. Without `erasure` the run
  writes the statement to `erase-welcome-accounts.sql` and the person stays on the roster.
- For the headerless import journey, an active membership type and no import source whose key
  starts with `acceptance-headerless-`. On desktop-chrome the admin describes a source of its own
  by column position from a generated headerless file, previews that file and then a copy with one
  column fewer. The first preview has to read every row as a new member, the second has to be
  refused with `import.snapshot.columns.countChanged` and both counts. No preview is ever executed,
  so the roster stays untouched. The journey removes the source, which takes its previews with it,
  and the postflight removes it again from the ledger after an aborted run. The preflight names
  every leftover source from an earlier run, because the run deletes only the one it recorded.

The member journeys also walk what members hear. The contention journey queues the refused member
on the waitlist, cancels the holder's booking and takes the offer from the notification centre;
the singles journey tells the partner of a cancellation. A queue a journey leaves behind is left
as its member, because only that member sees it, and the postflight requires none to remain. Every
closed entry still counts toward a member's waitlist limit until its slot ends, so with `erasure`
the preflight, once the instance runs the expected version, and the postflight delete the closed waitlist entries of `memberA`, `memberB` and
`memberC` in the database. Without it the run writes the statements to
`erase-waitlist-entries-before.sql` and `erase-waitlist-entries.sql`.

Every run also leaves the personas what it delivered and cancelled: notifications, logged messages,
cancelled bookings and the series those belonged to. With `erasure` the postflight waits until every
event published since `run-started` has reached its listeners, then deletes, for the personas only,
the notifications and message log rows written since then and the cancelled bookings they hold that
were created since then, with their series once no occurrence remains. A booking that still holds a
court is never touched. The postflight fails when any of these rows is left, and the report's
cleanup section names the counts. Without `erasure` the run writes the statement to
`erase-persona-residue.sql`.

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
| `erasure.ssh`, `erasure.container` | SSH host and database container through which the preflight and the postflight erase the members' closed waitlist entries and the postflight the welcome accounts the run created and what it delivered to and cancelled for the personas | no |

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

The harness keeps its passwords out of what Playwright records. It types one through `fillSecret`,
so no action, log line or error carries it, and sends every API request that holds one through
Node's own `fetch`, which nothing traces. Browser sign-ins still leave the password in a trace's
request bodies and DOM snapshots, so after the journeys the runner strips, by structure, every
request body with a password field and every password input's value from each `trace.zip`, and
then masks the password in its plain, escaped, form-encoded and base64 forms across the run
directory. After the postflight and before the report a separate check decodes every text file and
trace entry up to three layers deep and fails the run if it still holds the shared password or half
of it, or if a trace cannot be read.

- `--phase matrix` runs only the journeys; `--project <profile>` narrows them.
- `--phase postflight --run <dir>` cleans up after an interrupted run.
- `--phase report --run <dir>` renders the report again, for example after the review.
- `--previous <dir>` with the report phase compares native image evidence with that run after
  bounded masking of recognized run data. Proven unchanged sheets inherit only previous clean
  verdicts. Repeat this argument when regenerating a report that uses inheritance.

Discovery writes `lanes.json`: the window, and for each profile and journey its day, court and
hour. Preflight then proves every lane slot free before a journey starts.

The harness cancels only bookings, removes only opening weeks, holidays and court closures and
resets only message wordings and retention periods it recorded in its ledger. A booking or week of
the club in its way stops the preflight or the journey that needs it and is never touched; choose
another `window.start` or other `courts`. Each opening week a journey schedules is followed the next
day by a copy of the hours in force, so the change governs one day. The availability and
closure-notice journeys remove their holidays, court closures and bookings themselves; the
postflight removes any the ledger still holds, a booking beyond the window included, and fails when
a holiday, season or court closure of the run is left.

The harness starts no log or tunnel process. To attribute server log lines to journey steps, follow
the instance's logs into the files `logs.app` and `logs.proxy` name for the duration of the run,
for example with `docker logs -f --timestamps --since <start> <container> >> <file>` on the host
that runs the instance. The report reads only lines that start with the timestamp `--timestamps`
writes. It names a file without such lines as not read, among the harness gaps, instead of counting
it. The level of an ECS JSON line comes from its `log.level`.

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

A capture is a viewport shot plus a full-page shot. A journey that captures a state lower on the
page names its element with `capture(page, label, { subject })`; the harness centres that element
before the viewport shot and fails the step when its top edge is still outside the viewport, so the
contact sheet shows what the label promises on every profile.

Contact sheets preserve every screenshot's native pixel dimensions, including device pixel density.
They separate desktop, tablet, portrait phone, landscape phone and unknown profiles. Desktop,
tablet, landscape and unknown sheets contain at most two tiles in one column. Portrait sheets
contain at most four tiles in two columns. Names end in the device class and a two-digit chunk
number, for example `--desktop--01`. Regeneration removes obsolete sheets. Existing verdicts for
older sheet names do not review the new chunks.

A view captured on all ten profiles therefore yields six sheets: two desktop, one tablet, one
landscape and two portrait. A full catalogue run produces about three sheets per captured view,
and each one needs its own verdict. A first reading opens every tile at native size. An inherited
verdict requires the native evidence checks below. A reduced montage never substitutes for either.

The report lists each sheet as an expandable grid of native-size tiles. Scroll horizontally to
read a tile wider than the report. Clicking a tile opens its original viewport PNG. Each tile
also has explicit full-size viewport and full-page links. A missing full-page capture is marked
unavailable. These originals are copied into the report without resizing or JPEG conversion.

Every finding in the report carries a stable key: `axe:<rule>`, `console:<digest>`,
`http:<status>:<path>` or `failure:<file>:<title>:<profile>`. Identifiers, dates and hosts are
removed before a key is formed, so the same problem keeps its key from run to run.

Browser console errors and page errors also retain `consoleEvents` with the receipt time,
the operation running when the event arrived, and the stack or source location the browser
supplied. Capture operations distinguish settling, subject placement, viewport and full-page
screenshots, comparison geometry probes, scroll restoration, layout measurement and axe. Events outside capture work use
`journey`. The phase returns to its previous value even when an operation fails.

`browser-events.jsonl` records each event immediately, including events from a capture that fails
before writing metrics. Source locations omit URL credentials, query strings and fragments;
inline source bodies are not retained. The harness reads no request bodies or console arguments
for these diagnostics. Existing run redaction still protects the resulting artifacts. The report
shows each event's context alongside its finding, without changing the finding key or dismissing
an error because it occurred during a capture operation. Receipt phase is an observation, not
proof that the operation caused the error.

The acceptance package's `npm test` runs its Chromium helper tests and the focused WebKit console
regressions. Run `npm test -- console-context.spec.ts --project chromium` or
`npm test -- console-context.spec.ts --project webkit-console` for targeted checks.
The native ResizeObserver-warning case specifically runs in WebKit; Chromium's
Playwright protocol does not expose that warning as a page error. This distinction changes no
error filter in the capture helper.

For a bounded WebKit investigation, use the existing private acceptance configuration and password
environment with a new private run directory, then run from `acceptance/`:

```sh
node node_modules/@playwright/test/cli.js test --config diagnostics/playwright.config.ts
```

The probe uses the desktop Safari operator-health view and the iPad appointments view. It repeats
navigation, viewport screenshot, full-page screenshot, layout measurement and axe three times
each in isolation. It writes operation boundaries and browser observations to
`resize-observer-probe.jsonl`. It uses the existing administrator and changes no booking or club
configuration. Redact the run with the harness's `secureRun` before sharing it. An empty result
establishes bounded non-reproduction, not the cause of a historical error.

`review.json` in the run directory holds an assessment for each key:

```json
{
  "assessments": {
    "axe:heading-order": { "assessment": "known-issue", "issue": 1243, "reason": "The series form skips a heading level.", "followUp": "Planned for the next minor release." }
  },
  "manual": [
    { "key": "manual:update-notice", "severity": "major", "kind": "PWA", "title": "Update notice without a deployment", "detail": "", "where": [{ "project": "desktop-firefox" }] }
  ],
  "sheets": {
    "admin--the-admin-visits-every-administration-pa--overview": { "verdict": "clean", "by": "reviewer" },
    "memberA--a-member-when-the-preferences-menu-is-op--preferences-open": { "verdict": ["manual:update-notice"], "by": "reviewer" }
  }
}
```

An assessment is one of `product-defect`, `known-issue` (with `issue`), `capture-artefact` or
`harness-gap`, and always has a `reason` and a `followUp`. `manual` holds findings a person made
while reading the captures; their keys start with `manual:`.

`sheets` holds a human verdict for each sheet read, named as its file in `sheets/` without `.png`.
A verdict is `clean` or the keys of the findings it shows, and `by` names who read it. The report
keeps inherited verdicts in generated `sheet-review.json`, with `by` set to
`inherited:<previous run>`. It lists human and inherited judgments separately. Do not copy an
inherited marker into human `review.json`.

Each capture writes a value-free `.comparison.json` beside its viewport and full-page PNGs. It
binds mask geometry and presentation to those exact image bytes. Recognized formatted dates,
times, run-state counts, the version badge and generated acceptance-name suffixes can be masked.
Static labels, numeric configuration limits, raw ISO timestamps and unsupported or clipped regions
remain visible to comparison. Native date/time controls retain their borders and picker area. The journey's value assertions run unchanged.
Fixed or sticky positions that cannot be established for a full-page image remain unmasked.

`sheet-evidence.json` records native image membership, image hashes, comparison-record hashes and
the contact sheet frame. Inheritance requires compatible membership and frame pixels, unchanged
pixels outside compatible bounded masks in both the viewport and full-page image, and a previous
clean verdict bound to its review and evidence. Changed layout, styling, browser language,
timezone or pixel density prevents masking from transferring a verdict. Missing, malformed,
modified or legacy evidence falls back to a fresh reading. Older unchunked sheet names never
approve new chunks. Original PNGs and human verdicts remain unchanged.

A previous finding-bearing verdict always requires reading again, even when the pixels match.
A current explicit human verdict takes precedence. Inherited clean judgments can continue across
candidate runs because each generated review audit remains bound to its own review and evidence.
Every new finding still needs an assessment before the report can be final.

`review-batches.json` lists the pending sheets in batches of at most eight. Give a reviewer one
batch at a time. Open its current native tiles, write the verdicts into `review.json` as soon as
that batch finishes, and merge those writes before assigning another batch. Do not keep dozens
of sheets in one agent context. Load previous-run pictures only when a sheet changed and the
comparison helps explain the change. Previously flagged sheets still receive their own reading.
Regenerate the report with the same `--previous` argument to refresh the pending batches and
resolve inherited verdicts.

A report with any finding left unassessed or any sheet without a verdict is a draft and names what
is open, and so is a run whose sheets could not be made. Assessments for keys and verdicts for
sheets the run did not produce are listed as stale. Findings assessed as capture artefacts
appear under rejected suspicions, harness gaps under their own heading.

## Release summary

Each report also writes `release-summary.md`: the version, the run, the passed, failed and skipped
cells, and every finding with its assessment and issue. It contains no username, email address,
full name of anybody on the roster, instance host or image; a summary that would is refused. Post
it on the release parent or the release pull request.

Full reports and screenshots are never committed. The `report/` directory may be shared
privately. The rest of the run directory stays on the operator's machine: Playwright traces in
`test-results/` hold the shared password as typed, and `state/` holds signed-in sessions.
