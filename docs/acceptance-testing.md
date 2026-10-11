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
  and an active participant card for the participant journey.
- At least two active courts. Weekday lanes use the first two courts of `courts`; the weekend
  journey uses up to three.
- Opening hours that leave fifteen hours from opening on each weekday of the window, and two hours
  on its Saturday. A lane day that is closed or too short stops the run before it books anything,
  naming the profile and the day.
- No opening week scheduled after today.
- A mail catcher with the Mailpit API for the journeys that read mail. Without `mail.url` those
  journeys are reported as not checkable, never as passed.

## Configuration

`ACCEPTANCE_CONFIG` names a JSON file outside the repository. `ACCEPTANCE_PASSWORD` carries the
shared password of the test accounts; it never appears in the file. `acceptance/config.example.json`
shows the shape with placeholder accounts.

| Field | Meaning | Required |
| --- | --- | --- |
| `baseUrl` | Instance under test | yes |
| `expectedVersion` | Version the preflight must read from the instance | yes |
| `personas` | Username per journey actor: `admin`, `trainer`, `youth`, `sport`, `grounds`, `treasurer`, `memberA`, `memberB`, `memberC`; `disposable` takes one username or a list | yes |
| `timeZone` | Club time zone; default the zone the instance reports | no |
| `window.start` | Monday of the booking window; default the first Monday after the run starts | no |
| `courts` | Court numbers the journeys use; default the first three active courts | no |
| `mail.url` | Mailpit API | no |
| `logs.app`, `logs.proxy` | Log files the operator writes alongside the run | no |
| `metrics.url` | Prometheus query endpoint for request latency around failures | no |
| `browsers.firefox.wsEndpoint` | Remote Firefox launch server; default a local Firefox | no |
| `loadLimit` | One-minute load average the run waits to fall below before it starts; default 5.5 | no |
| `resetCodesPerHour` | Password-reset codes the instance mails per account and hour; default 5, the instance's own default | no |

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

The harness cancels only bookings it recorded in its ledger. A booking of the club in a reserved
slot stops the preflight or the journey that needs the slot and is never cancelled; choose another
`window.start` or other `courts`.

The harness starts no log or tunnel process. To attribute server log lines to journey steps, follow
the instance's logs into the files `logs.app` and `logs.proxy` name for the duration of the run,
for example with `docker logs -f --timestamps --since <start> <container> >> <file>` on the host
that runs the instance.

Contact sheets and report images need ImageMagick on `PATH`; without it the run skips the sheets
and the report embeds the original screenshots.

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
person's name, instance host or image; a summary that would is refused. Post it on the release
parent or the release pull request.

Full reports and screenshots are never committed. They stay in the run directory and may be
shared privately.
