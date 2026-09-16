# Cutting a release

A release is a `v<version>` tag in this repository. Release Please maintains the release pull
request. Merging that pull request updates the version and changelog, creates the tag and starts the
release workflow. Do not create the tag manually.

This document describes the release steps and the guarantees behind their gates. `CLAUDE.md`
defines the policy for branches, commits and pull requests.

**Merging the release pull request is signing a release.** `publish` signs the image with cosign
under this repository's own identity, keyless, and attests its provenance and SBOM. No human
approves anything in between. Whoever may merge that pull request, or push a `v*` tag by hand,
may publish under this project's name.

## The short version

There is nothing to type. A release pull request titled `chore(main): release <version>` stands
open on `main` and grows with every merge; it shows the version it would cut and the changelog it
would write. Release Please initially writes a candidate delta, and the same workflow immediately
folds it into the one changelog section named after the release line, such as `## 0.1.0`. A release
pull request with a separate candidate section is incomplete and must not be merged. Merge the
normalized pull request when a nightly has verified the commit it sits on, and the rest happens.

Release Please does not open a second snapshot pull request. The release pull request moves every
version field together, and the repository keeps that published version until the next release
pull request changes it.

## What the nightly image proves

Every complete first-attempt scheduled `build` calls the reusable `nightly image` workflow with its
own commit and verification run. A manually dispatched full build follows the same path. The image
workflow validates that exact evidence, packages that revision and builds one amd64/arm64 image. It
runs the same reference deployment smoke, Trivy scan and `release-image-amd64` or
`release-image-arm64` policy that the release uses. A red image job predicts a release failure while
there is still no version tag to spend. The scheduled failure tracker records it as part of the
failed scheduled build.

The image workflow also accepts a direct dispatch from a pull-request branch. That dispatch builds
and qualifies the real multi-architecture candidate from the selected branch head, but cannot sign,
publish or apply retention. Its evidence counts only while its commit equals the current pull-request
head; a commit or rebase makes the earlier dispatch obsolete.

This does not replace the release gate. A release stamps its version, runs its complete build,
active assessment, upgrade and restore checks, and publishes a different digest under versioned
tags. The nightly image is an acceptance artifact for the current code. The release workflow still
proves the tagged code and image itself.

If the selected revision already labels the published `nightly` image, the workflow skips package,
image and qualification work and runs retention only. Otherwise it publishes `nightly` and one
dated tag only after SBOM and provenance attestations, signing, and verification have succeeded.
The registry keeps the newest seven dated nightlies, every published version and the complete
manifest closure each retained digest needs. A candidate-only digest follows the 14-day release
evidence window; the daily nightly retention removes it after that window without touching a digest
that also carries a published version.

### Nightly source attestation v1

The nightly workflow's standard provenance identifies the workflow revision that performed the
publication. A separate signed predicate binds the image digest to the repository commit and the
build verification run that called it. Its JSON object contains `schemaVersion` 1, the HTTPS
`repository`, the 40-character `commit`, and the numeric `verificationRunId`. Publication verifies
both that claim and the workflow identity before moving either nightly tag. The custom source
attestation is read directly from the image registry because GitHub's API filter rejects the
fragment-bearing predicate identifier; its signature and exact predicate type remain mandatory.

**What the merge writes.** Merging the release pull request writes the tag and a *draft* GitHub
release. A draft is visible to whoever may write to this repository and to nobody else, and `publish`
is what turns it into the release a club sees, after every gate above it has passed. A run that
stops earlier leaves the draft standing, which is why a failed release is invisible from the outside
rather than merely unsigned.

**Where the version lives.** `pom.xml` carries it between releases: release-please writes it, Maven
writes `build-info.properties` from it, and `GET /api/source` reports that to the browser, so the
version a member reads in the footer is the one that was released. `frontend/package.json` and both
root-package version fields in `frontend/package-lock.json` move in the same pull request. There is
no snapshot transition between releases: a snapshot pull request writes `0.1.0-rc.2-SNAPSHOT` into
the JSON files and the release after it cannot take that back, because the updater replaces only
the version its pattern matches and that pattern stops at the hyphen before `SNAPSHOT`. So the
files carry the released version between releases, and the manifest agrees with them. The release
build itself does not trust repository metadata: it takes the version from the tag and stamps it in with
`versions:set`, so what is published is what the tag says even if the pom were to disagree.

## Cutting a candidate

Candidates are opened and closed with one line of configuration, not with a hand-typed version.

1. Set `"prerelease": true` in `release-please-config.json` and merge that. The next release pull
   request proposes `v0.3.0-rc`, and every merge after it raises `rc.1`, `rc.2`.
2. To open an `alpha` line instead, land a commit carrying a `Release-As:` footer naming
   `0.3.0-alpha.1`; the strategy counts that suffix onwards by itself. That footer names the version
   outright and overrides everything else, `bump-minor-pre-major` included, it is the one way to
   reach 1.0 without a decision, so read the version in the release pull request's own title before
   merging it.
3. Set `"prerelease": false` again to graduate. The suffix is stripped and the next release pull
   request proposes `v0.3.0`.

Every candidate is a checkpoint on the same release line. Release Please proposes the changes
since the preceding candidate; the release-please workflow then folds those entries into the single
`## <major>.<minor>.<patch>` section on its pull-request branch. The normalizer refuses multiple
candidate deltas, a missing cumulative heading and duplicate sections instead of guessing. The
release workflow independently rejects a missing or split section and uses that complete section
for both candidate and stable GitHub release notes.

None of that applies to the very first release, because there is nothing to bump from: with no
release in the history release-please never asks the versioning strategy at all and takes
`initial-version` verbatim, which is `1.0.0` unless the configuration says otherwise, whatever the
manifest holds and however many breaking changes the history carries. A candidate for the first
release is therefore opened by writing it there, as `0.1.0-rc.1`, and `"prerelease": true` belongs
in the same change: without it the release after that candidate strips the suffix and graduates.
The three steps above take over from the second release onwards.

The first public release has no older published contract to break. Its cumulative `0.1.0`
changelog therefore moves release-please's upgrade-oriented notes under `Notable changes` instead
of deleting their operating or migration details, and has no `Breaking Changes` section. Once
`0.1.0` is published, breaking markers describe real upgrade work and stay in later release notes.

Nothing else changes: a candidate travels the same pipeline described under build and release
security in `docs/design.md`.

## What the release refuses before it builds anything

Four checks run before a single compilation, and each fails the run rather than warning.

**The tag has to sit on `main`.** A tag on a branch, or on a commit that never landed, is refused by
name. The tag is spent at that point, *When a release fails* below applies to this refusal like any
other.

**The tag has to name the release that commit records.** `versions:set` takes the version from the
tag verbatim, so the tag alone decides what the published image calls itself. It is read against
`.release-please-manifest.json` at that commit, which release-please writes in the same pull request
that creates the tag, and `pom.xml`, `frontend/package.json` and both root lockfile versions are
tied to that manifest by `release-please-configuration.test.mjs`. Checking the one value therefore
covers all five. Without this a tag naming a candidate nobody cut, such as `v0.1.0-rc.7` while the
repository records `0.1.0-rc.2`, would build, sign and publish under that name, because its release
line exists and nothing else ever consults the repository's own record.

**A nightly must already have verified an ancestor of this commit.** The release looks for a
scheduled or manually dispatched `build` run on `main` that succeeded on its *first* attempt, whose
head commit is an ancestor of the tag, and whose coupled evidence says both the complete build and
the nightly-image workflow succeeded (`releaseReadiness: complete`). Build-only evidence from
before that coupling does not count, nor does a run that went green on its second attempt. Note what
this does and does not establish:
some ancestor was verified in full and produced or revalidated the nightly image, not necessarily
the tagged commit. What verifies the tagged commit is the release's own `build` job.

**No tracker-written `nightly` failure issue may be open.** The check counts open issues carrying
the `nightly` label whose title starts with `[nightly] ` and whose body holds the tracker's
fingerprint, the issues the scheduled-run tracker wrote. An issue a human opened about a failing
night does not stop a release. Issues reporting `npm audit` are excluded by name, because those
findings arrive from outside the repository and are tracked on their own.

**The tracker never closes one of those issues itself.** Somebody closes it after recording its
cause, its answer and evidence for the affected check. A repository change carries its targeted
test or runtime proof. A correction that only GitHub can exercise, such as job permissions, needs a
real run of that check. An external outage may close once its logs establish that cause. A later,
unrelated failure elsewhere in the workflow does not keep the incident open. If the same failure
class returns, the tracker reopens the issue by itself, so closing on a diagnosis costs nothing and
is the safety net that makes it safe. A release that seems blocked for no reason is usually waiting
on exactly that.

The issue text used to tell its reader to wait for seven consecutive scheduled first attempts, and
the tracker commented once they had passed. That measured elapsed quiet time rather than whether
anybody had found the cause: for a diagnosed failure the landed fix already says more than seven
green nights can, and at two scheduled runs a week a single lost runner pushed the window back by
weeks. It was removed.

## What the release refuses after scanning

**No confirmed dependency finding may be past its remediation deadline.** The build matches the
complete Dependabot alert history against npm and Trivy summaries bound to the tagged commit. The
summaries establish current dependency state; alert history supplies the earliest reliable clock.
An exact, current maintainer exception can keep the release ready. An unavailable alert service
produces explicit skipped evidence and does not block publication by itself. The latest completed
default-branch artifact keeps a still-current overdue finding blocked during that outage.
Permission failures and malformed evidence still stop the build.

## What runs, and what each part proves

| Job | What it establishes |
|---|---|
| `nightly-evidence` | A first-attempt build on `main` and its coupled nightly-image workflow completed for an ancestor of the tag, and no tracker-written nightly failure remains open |
| `build` | Dependency-remediation deadlines hold, the version is stamped, backend, frontend, tooling and artifact tests pass on the tagged commit, CodeQL analyses the sources, npm audit evidence is captured, and the release-build security policy holds |
| `browser` | The packaged tagged source passes the complete Chromium and WebKit browser matrix; it runs beside `build` so browser duration cannot consume the security-analysis budget |
| `image` | One multi-architecture image is built and pushed as `release-candidate-<sha>` |
| `qualify` | That exact digest is brought up through the reference deployment on `amd64` and `arm64`, and its vulnerabilities are checked against the candidate-image policy |
| `active-security` | The running candidate is exercised by the scanners of the `active` profile. The `destructive` profile, resource abuse, does not run here |
| `upgrade` | The database upgrade path from each resolved origin is executed against the candidate |
| `restore` | A backup taken from the candidate is restored into it |
| `security-record` | The build, image, qualify and active-security evidence is collected into one file. `upgrade` and `restore` are not in it |
| `archive` | `tools/deployment-archive.mjs` packs the reference deployment for that digest into `courtside-deployment-<version>.zip` |
| `publish` | The qualified manifest is tagged, signed with cosign, given an SBOM and a provenance attestation, and the GitHub release is written |

`publish` retags the manifest that `qualify` proved. Nothing is rebuilt between qualification and
publication, so the digest a club pulls is the digest that was brought up twice.

The release page carries the OpenAPI document, the security record and the deployment archive with
its checksum. `archive` builds those bytes once and `publish` attaches the artifact it downloads, so
what a club unpacks is what was attested. The archive's contents are derived from what the shipped
recipe resolver can emit rather than listed by hand, and a file the resolver never names is not in
it: `tools/deployment-archive.test.mjs` unpacks the archive into an empty directory and renders a
recipe from there, which fails if anything it binds lives only in this repository.

## When a release fails

It stops at the job that refused, and nothing is published under a version tag: the release the
merge created is still a draft and stays one. What stays behind is the `release-candidate-<sha>`
image, unsigned and unqualified, in a public registry. Nightly retention removes a candidate-only
digest after 14 days; a published version that shares the digest keeps it. No version tag resolves
to a failed candidate.

**The tag stays where it is.** A tag that once named a commit and later names another is the one
thing a consumer cannot detect, and by the time a run has started, the tag has been observed. Fix
the cause on `main` through the usual pull request; the next release pull request then proposes the
patch after it, so a `v0.2.0` that failed is followed by `v0.2.1`. The version that failed is
skipped rather than retried, and the manifest already names it, worth knowing before somebody
looks for a `v0.2.0` that never appeared.

Only a tag no run ever saw is free to move, and under a `v*` trigger that is rarer than it sounds,
a misspelling that keeps the leading `v` still starts a run.

A failed tag costs the next release nothing. Both things the release reads from its history, the
supported upgrade origins and the range the upgrade notes cover, come from the releases this
repository has **published**, not from the tags that exist. A tag whose run stopped before `publish`
therefore names a draft and no published release, is no origin, and shortens no range. It stays
where it is, and nothing has to be deleted to move on.

## When the change is breaking

The compatibility contract in `docs/design.md` says what counts: the REST API, the environment
variables a club sets and the container contract in `deploy/container-contract.md` are the
published surface, and a change in the shape of any of them is breaking. A
pull request that makes one carries `!` in its Conventional Commit title or a `BREAKING CHANGE:`
footer, which is what the title lint reads and what the version bump follows.

**The upgrade note is your commit message.** `build` collects every `BREAKING CHANGE:` footer and
every `!:` subject between the previous published release and this one and puts them verbatim into
the release body under *Upgrade notes*; with none it writes that no published surface changed and a
club may raise `COURTSIDE_VERSION` and restart. The footer is not paperwork, then, it is the text a
club reads before pulling the image, and `BREAKING CHANGE: renamed a variable` is a sentence that
helps nobody at 22:00.

The first public release has no upgrade origin, so its release body says that directly instead of
turning development-time breaking markers into upgrade instructions.

What no automation covers is the upgrade path itself. `upgrade` executes the origins it resolved
from the published release history, so a release that breaks one of those is refused, but only
those.

## Candidates

A tag may carry a prerelease suffix, `v0.3.0-alpha.1`, `v0.3.0-rc.1`, and it travels the same
pipeline as any other release: the same nightly verification, the same qualification, the same
signature. A candidate exists so that a club can *run* it, and a candidate proved less than a
release would be an image whose signature means less than the same signature on a release.

Two stages are used, and each says what it promises. `alpha` is for the first club that agreed to
run one; `rc` says no known defect is open against it. Nothing else is used, because a third stage
nobody can describe in one sentence is a stage that means nothing.

**A published candidate is an upgrade origin.** A club that ran one has migrated its database, so
the release it is a candidate for upgrades from it, and so does every later candidate for that same
release. Candidates of another line are not origins: a club is expected to reach a candidate's
release before following the next one. A candidate whose run never reached `publish` is not an
origin either, it named no image, and the release reads its history from what was published rather
than from the tags that happen to exist.

A version is read as semantic versioning defines it. Build metadata (`v0.3.0+build.1`) is refused
rather than interpreted, because nothing here has a use for it and a release that guessed would be
worse than one that stops.

Ordering follows semantic versioning, so `v0.3.0-rc` precedes `v0.3.0-rc.2`, which precedes
`v0.3.0-rc.10`, and all of them precede `v0.3.0`.

## After the release

The image is at `ghcr.io/jegr78/courtside`, signed. A release is published under up to four tags:
`<version>`, `<major>.<minor>`, `<major>` and `latest`. A `0.x` release does not publish the floating
`0` tag because every minor may break compatibility before 1.0. A club pinning `0.2.0` stays where
it is; one pinning `0.2` or `latest` moves with every matching release. From 1.0 onwards, the
floating major tag moves with every matching release as well.

**A candidate is published under its own version and nothing else.** No floating tag follows it, and
the GitHub release is marked as a prerelease, so a club that pinned `latest` or `0.2` never receives
one by accident. Reaching a candidate is a deliberate act: pinning its exact version.

The GitHub release carries two files: the `openapi.yaml` this version answers to, and
`security-record.json`. That record is an ordinary release asset, neither signed nor attested,
unlike the image itself, so it reports what the passes found rather than proving it.

`deploy/.env.example` names `COURTSIDE_VERSION`, and a club moves by editing that one line and
recreating the container, the deployment reference in `deploy/README.md` is what they follow, not
this file.
