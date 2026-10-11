# Cutting a release

A release is a `v<version>` tag in this repository. Release Please maintains the release pull
request. Merging that pull request updates the version and changelog. The green push build of that
merge starts the `release candidate` workflow, which qualifies the commit and only then writes the
tag. The tag starts the release workflow, which promotes the qualified images and builds nothing.
Do not create the tag manually.

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
normalized pull request when a nightly has verified the commit it sits on, and the rest happens:
the push build, the candidate, about 45 minutes, and the promotion, a few minutes.

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

## What pull requests prove

A pull request whose plan selects the backend, frontend or full profile can change the image, so it
runs the release gates before it merges. The `gates-image` job builds the image from the pull
request's merge commit, runs the amd64 qualification on it with `tools/courtside.uat-smoke.mjs`, adds
the booking seed and writes a deployment archive shaped like a nightly one. It hands both images to
`release-gates.yml` as an artifact of the same run instead of through the registry. No gate job logs
in, pushes or reads a secret; the jobs use `github.token` only to download artifacts of the same
run, read-only. A pull request from a fork or from Dependabot therefore runs the same gates. The
archive records the head branch as its ref, so a fork branch whose name uses characters outside `A-Z`, `a-z`, `0-9`,
`.`, `_`, `/` and `-` fails `gates-image` instead of running the gates.
From that workflow the pull request runs `archive-reproducibility`, `mail`, `active-security`,
`restore` and `upgrade`, the last from the earliest retained nightly whose migrations it still
carries. A pull request that changes a migration or `upgrade/verify.sql` also upgrades from every
published origin the next release will support, so a migration that cannot run over a published
database fails its own pull request rather than the next release. The jobs that run the image load it and refer to it by image ID; `mail` and
`archive-reproducibility` only bind the archive and read the pinned name it records.

npm advisories and the image CVE scan stay out of pull requests because they move without a change:
a new advisory would turn an unrelated pull request red. They run at night and in the release, and
so do `npm-audit` and `security-record`, which assemble release evidence. The arm64 qualification
and the booking-seed preview need a registry digest and stay there as well. The required `build`
check waits for the gates, for the WebKit accessibility shard and, for tooling and full plans, for
the tool suite under a clock shifted by 400 days. A scheduled or dispatched `build` runs that
shifted clock too, and the `build` job waits for it, so a failed shifted-clock run keeps the nightly
image from being published.

The weekly `mail smoke` keeps its schedule and its manual dispatch; a pull request no longer starts
it by path. The build's `mail` gate runs the same Stalwart journey for every change to `deploy/`,
the mail tools and the backend. The Stalwart journey starts no application image, so it proves the
mail stack and its certificate handling, not the notification code that talks to the relay; that
code is covered by the backend tests and by the restore journey, which sends a message.

## What the nightly rehearses

A release confirms what the night before already proved; it does not discover it. A scheduled or
dispatched `build` rebuilds the nightly image even when the revision already carries one, so the
digest the rehearsal binds is qualified in the same run, and then calls `release-gates.yml` with it.
That is the workflow the candidate's `gates` job calls, with the same jobs and commands:
`archive-reproducibility`, `mail`, `active-security`, `security-record`, `restore`, `npm-audit` and
`upgrade`. At night `upgrade` starts from the earliest retained dated nightly whose migrations and
`upgrade/verify.sql` the candidate still carries unchanged, because Flyway refuses a database whose
applied migration was corrected in place; a release passes the published versions it upgrades from
instead.
The scheduled `security` job runs the release-build policy with npm audit evidence and the same
command line as the candidate's `release-build` job. A push to `main` builds and qualifies its image but does not
rehearse the gates.

A change to the gates is rehearsed before it merges. Dispatch `build` on the branch, then dispatch
`nightly image` on the same branch with that build's run id as `security-base-run-id`; the image
workflow rebuilds and qualifies the branch head, even one that already carries a published image, and
calls `release-gates.yml` with it.

Four steps need a real version and therefore run for the first time in a release: signing with
the `release.yml` identity, the version tags on the registry, making the GitHub release visible, and,
from the release after 0.1.0 on, an `upgrade` whose origin is a version tag rather than a nightly. The
nightly `publish` runs the same signing, attestation and verification commands with the same output
options under its own identity, and tags its image with the same `imagetools` command. The release
keeps what `cosign verify` and `gh attestation verify` print as proof digests in the security record
and does not parse it: their exit codes are the verification, so a new output format of either tool
cannot stop a release.

The image workflow also accepts a direct dispatch from a pull-request branch. That dispatch builds
and qualifies the real multi-architecture candidate from the selected branch head, but cannot sign,
publish or apply retention. Its evidence counts only while its commit equals the current pull-request
head; a commit or rebase makes the earlier dispatch obsolete.

For an additional private Linux target, stage the candidate archive and an `answers.conf` in a new
mode-0700 directory whose final path segment is a unique `courtside-*` namespace. Then run the
generic acceptance client with the remote paths, the expected identities and its exact confirmation
phrase:

```sh
node tools/deployment-acceptance-ssh.mjs \
  --host qualification-box \
  --archive /srv/courtside-acceptance/archive.zip \
  --archive-sha256 <archive-sha256> \
  --revision <40-character-revision> \
  --image ghcr.io/jegr78/courtside@sha256:<image-digest> \
  --namespace courtside-acceptance-standard \
  --remote-root /srv/courtside-acceptance-standard \
  --recipe standard \
  --confirm 'qualify courtside-acceptance-standard at /srv/courtside-acceptance-standard'
```

The remote root and `answers.conf` must be owned by the SSH account with modes 0700 and 0600. The
client refuses any other initial entry or a reused installation, snapshots the archive below that
private root, verifies its identity and member paths before extraction and never installs packages,
changes the firewall or prunes Docker globally. It leaves the installation running for inspection;
removal remains an explicit operator action through the installed lifecycle CLI.

This does not replace the release gate. A release stamps its version, runs its complete build,
active assessment, restore check and the upgrade check from every origin it has, and publishes a
different digest under versioned tags. The nightly image is an acceptance artifact for the current code. The release workflow still
proves the tagged code and image itself.

If the selected revision already labels the published `nightly` image, the workflow skips package,
image and qualification work and runs retention only, unless its caller asks it to rebuild, as a
scheduled or dispatched `build` and a rehearsal dispatch do. Otherwise it publishes `nightly` and one
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
4. A graduation whose release run failed before it published may instead reopen the line, the one
   exception *When a release fails* names: set `"prerelease": true` again, return the manifest,
   `pom.xml`, `frontend/package.json` and both root versions in `frontend/package-lock.json` to the
   last published candidate, and restore `CHANGELOG.md` to its state before the graduation. The
   graduation pull request keeps `autorelease: tagged`, because a merged release pull request
   marked `pending` makes release-please recreate its tag and refuse every new release pull
   request. The next release pull request proposes the following candidate, `v0.3.0-rc.<n+1>`.
   Delete the unpublished tag and its draft before the line graduates again, or the new graduation
   finds the old tag and publishes the old commit.

A published candidate is walked on the UAT instance with the acceptance harness described in
[acceptance-testing.md](acceptance-testing.md). Its release summary, with every finding assessed, is
posted on the release parent before the line graduates.

Every candidate is a checkpoint on the same release line. Release Please proposes the changes
since the preceding candidate; the release-please workflow then folds those entries into the single
`## <major>.<minor>.<patch>` section on its pull-request branch. The first candidate of a new line
opens that section, and graduating to the release folds the last delta into it and dates it with the
release. The normalizer refuses multiple candidate deltas and duplicate sections instead of guessing. The
release workflow independently rejects a missing or split section and uses that complete section
for both candidate and stable GitHub release notes. The release body drops each entry's commit link
and keeps its pull request, so the cumulative first line stays within GitHub's release body limit;
`CHANGELOG.md` keeps both.

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

Four checks stop a release before anything is built or promoted, and each fails the run rather than
warning. The candidate's `preconditions` job demands the nightly and the closed nightly issues before
it builds an image; the release's `candidate` job reads the tag before it promotes anything.

**The tag has to sit on `main`.** The candidate writes the tag at the commit it qualified, which is
on `main`. A tag on a branch, or on a commit that never landed, was written by hand and is refused by
name. The tag is spent at that point, *When a release fails* below applies to this refusal like any
other.

**The tag has to name the release that commit records.** The tag decides the version tags the image
is published under. It is read against `.release-please-manifest.json` at that commit, which
release-please writes in the release pull request, and `pom.xml`, `frontend/package.json` and both
root lockfile versions are tied to that manifest by `release-please-configuration.test.mjs`. Checking
the one value therefore covers all five. Without this a tag naming a candidate nobody cut, such as
`v0.1.0-rc.7` while the repository records `0.1.0-rc.2`, would publish under that name, because its
release line exists and nothing else ever consults the repository's own record.

**A nightly must already have rehearsed an ancestor of this commit.** The candidate looks for a
scheduled or manually dispatched `build` run on `main` that succeeded on its *first* attempt, whose
head commit is an ancestor of the release commit, and whose `coupled-nightly-rehearsal-v2` evidence
says the complete build, the nightly-image workflow and the release gates all succeeded
(`releaseReadiness: complete`). Evidence written before the gates were rehearsed does not count, nor
does a run that went green on its second attempt. Note what this does and does not establish: some
ancestor passed every gate, not necessarily the release commit. What verifies the release commit is
its own green push `build`, which ran the test suite and every browser group, and the candidate's own
call of the same gates on its exact digests.

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

**No confirmed dependency finding may be past its remediation deadline.** The candidate's
`release-build` matches the complete Dependabot alert history against npm and Trivy summaries bound
to the release commit. The
summaries establish current dependency state; alert history supplies the earliest reliable clock.
An exact, current maintainer exception can keep the release ready. An unavailable alert service
produces explicit skipped evidence and does not block publication by itself. The latest completed
default-branch artifact keeps a still-current overdue finding blocked during that outage.
Permission failures and malformed evidence still stop the candidate.

## What runs, and what each part proves

A release runs in two workflows. `release-candidate.yml` qualifies the release commit and writes the
tag; `release.yml` answers the tag and publishes exactly what was qualified.

| Job | What it establishes |
|---|---|
| `select` | The green push `build` that finished belongs to a release commit: the manifest changed, exactly one merged `autorelease: pending` pull request is titled for that version, the commit is on `main` and the version is not tagged yet |
| `preconditions` | A first-attempt build on `main`, its nightly-image workflow and its release-gate rehearsal completed for an ancestor of the release commit, and no tracker-written nightly failure remains open |
| `release-build` | Dependency-remediation deadlines hold, CodeQL analyses the sources, npm audit evidence is captured, the release-build security policy holds, and the release notes and upgrade origins are collected. The test suite and the complete browser matrix already ran in the commit's own green push `build`, which `select` requires |
| `image` | One multi-architecture image and its booking-seed image, pushed as `release-candidate-<sha>-<run id>` |
| `archive` | `tools/deployment-archive.mjs` packs the reference deployment for that digest into `courtside-deployment-<version>.zip`, under the identity `release.yml` will attest it with |
| `qualify` | The exact deployment archive is checked against that digest and all four recipes, then the digest is brought up through the reference deployment on `amd64` and `arm64` and checked against the candidate-image policy |
| `gates` | Calls `release-gates.yml` with the candidate digest, the same workflow the nightly rehearses. Its `mail` job exercises the archive's self-hosted-mail recipe against controlled DNS, TLS and SMTP peers. `active-security` runs the scanners of the `active` profile against the running candidate; the `destructive` profile does not run here. `restore` restores a backup taken from the candidate into it. `security-record` collects the build, image, qualify and active-security evidence into one file, without `upgrade` and `restore`. `archive-reproducibility` builds the archive again from the release commit and requires the same bytes. `npm-audit` holds the release npm policy. `upgrade` migrates a database from each resolved origin into the candidate; the first release has none |
| `evidence` | The record `release-candidate-evidence-<sha>`: both digests, the archive checksum, the version, the run and the push build, written only when every job above succeeded |
| `tag` | Writes `v<version>` at the qualified commit through the release token and marks the release pull request `autorelease: tagged`. Creating a tag that exists fails, so a tag never moves |
| `candidate` | In `release.yml`: the tag sits on `main` and names the version the commit records, and the newest release-mode candidate evidence for that commit verifies, including the archive's checksum |
| `publish` | The qualified manifests are signed with cosign and given SBOMs and provenance attestations; the draft release receives the candidate's archive, notes and security record, the version tags are pushed, and only then is the release made visible |
| `plan-sync` | The release plan's status comment is synchronized with the release just published |

`publish` retags the manifest that `qualify` proved, by the digest the evidence names. Nothing is
built between qualification and publication, and no gate runs a second time, so the digest a club
pulls is the digest that was brought up twice.

The release page carries the OpenAPI document, the security record and the deployment archive with
its checksum. `archive` builds those bytes once and `publish` attaches the artifact it downloads, so
what a club unpacks is what was attested. Before anything reaches the registry, `gates` builds
the archive again from the tagged tree and requires the same bytes, and `publish` waits for it. The contents are derived rather
than listed by hand: every Compose file the shipped resolver can emit, every file those Compose
files name, the recipes, the configuration example, the recipe and operations guides and the container
contract, together with the standalone Bash lifecycle launcher. `tools/deployment-archive.test.mjs`
unpacks the archive into an empty directory and renders every recipe with every overlay from there,
which fails if anything they bind lives only in this repository or if the launcher loses its
executable mode.

Both architecture jobs download the archive built by `archive`; they do not reconstruct its
deployment files from the checkout. They verify its complete checksum inventory and require its
manifest to name the candidate digest and every supported recipe. The retained image-qualification
artifact carries that archive identity beside the runtime result. The mail job performs the same
binding before its controlled Stalwart journey. `publish` waits for both.

## When a release fails

**A candidate that fails writes no tag.** The release pull request stays merged with the label
`autorelease: pending`, and Release Please opens no further release pull request until that version
is tagged. What stays behind are the `release-candidate-<sha>-<run id>` images, unsigned and
unqualified, in a public registry. Nightly retention removes them after 14 days.

- A failure outside the commit, such as a runner that died or a registry that timed out: choose
  Re-run failed jobs on the candidate run. `evidence` and `tag` run again once everything is green.
- A defect in the commit: fix it on `main` through the usual pull request. Then dispatch
  `release-candidate.yml` with `rehearsal=false` and `commit` set to the fixed commit on `main`. The
  candidate qualifies that commit under the version the manifest still records and tags it there.

**A publication that fails leaves the tag where it is.** The release the run creates is still a
draft and stays one. `publish` uploads the release assets to the draft before it pushes a version
tag, and makes the release visible last. When a signing or attestation step failed on a network
error from the sigstore transparency log (`rekor.sigstore.dev`), wait until it answers and re-run
only that job with `gh run rerun <run id> --failed`. The failure message names the failed steps.
Nothing is built again; the same evidence is verified and the same digests are promoted.

**The tag stays where it is.** A tag that once named a commit and later names another is the one
thing a consumer cannot detect, and by the time a run has started, the tag has been observed. If a
publication cannot be completed, fix the cause on `main`; the next release pull request then
proposes the version after it, so a `v0.2.0` that failed is followed by `v0.2.1`. The version that
failed is skipped rather than retried, and the manifest already names it, worth knowing before
somebody looks for a `v0.2.0` that never appeared.

Only a tag no run ever saw is free to move, and under a `v*` trigger that is rarer than it sounds,
a misspelling that keeps the leading `v` still starts a run.

One exception exists, and it is a maintainer's decision, not a routine: a graduation that never
published may reopen its candidate line instead of being skipped, as `0.1.0` did when its release run
failed and further changes were still due. No consumer could install that version, so its tag and
draft are deleted and the version is cut again later from the commit the line finally graduates on.
*Cutting a candidate* lists the steps.

A failed tag costs the next release nothing. Both things the release reads from its history, the
supported upgrade origins and the range the upgrade notes cover, come from the releases this
repository has **published**, not from the tags that exist. A tag whose run stopped before `publish`
therefore names a draft and no published release, is no origin, and shortens no range. It stays
where it is, and nothing has to be deleted to move on.

## Rehearsing a release candidate

The `release candidate` workflow starts by itself when a push `build` on `main` succeeds, and
qualifies the commit if it is a release commit. A dispatch qualifies one commit without writing a
tag. Run it with

```bash
gh workflow run release-candidate.yml --ref main -f commit=<sha> -f rehearsal=true
```

`commit` is the full 40-character sha to qualify. `rehearsal` defaults to `true`. A rehearsal may
qualify any commit, a branch head included, and skips the release preconditions: a pending release
pull request, a commit on `main`, an unused tag and a green push build of that commit. With
`rehearsal=false` the workflow refuses to run from anything but `main`, demands all four and writes
the tag like a run the push build started.
GitHub dispatches a workflow only once its file exists on the default branch.

The jobs, in order:

| Job | What it proves |
| --- | --- |
| `select` | The commit, its version and tag, and whether it qualifies at all |
| `preconditions` | A nightly verified an ancestor, and no nightly failure issue is open |
| `release-build` | The release-build security and dependency policy, release notes and upgrade origins, without running the test suite again |
| `image` | The image and booking-seed image of that commit, pushed as `release-candidate-<sha>-<run id>` and `booking-seed-release-candidate-<sha>-<run id>` |
| `archive` | The deployment archive for the `release.yml` identity at `refs/tags/v<version>` |
| `qualify` | The reference deployment and image policy on `amd64` and `arm64` |
| `gates` | Every release gate on those exact digests and that archive |
| `evidence` | The record `release-candidate-evidence-<sha>`, written only when every job above succeeded |
| `tag` | For a release only: the tag at the qualified commit, which starts `release.yml` |

A rehearsal writes no git tag, no GitHub release and no version tag. Its only registry writes are the
two candidate image tags above, which nightly retention removes after 14 days. A rehearsal uploads
no dependency evidence, so later runs cannot read it as their previous evidence.

The evidence, the archive and the release notes are kept for 14 days, and the candidate images for
the same window. The promotion reads them within those 14 days; after that, dispatch a new
candidate. Re-run failed jobs on a red run to finish it: the `evidence` job runs again and uploads
the record. Re-run all jobs on a green run cannot upload the record again, because the run already
holds an artifact of that name. Dispatch a new run instead.

## When the change is breaking

The compatibility contract in `docs/design.md` says what counts: the REST API, the environment
variables a club sets and the container contract in `deploy/container-contract.md` are the
published surface, and a change in the shape of any of them is breaking. A
pull request that makes one carries `!` in its Conventional Commit title or a `BREAKING CHANGE:`
footer, which is what the title lint reads and what the version bump follows.

**The upgrade note is your commit message.** `build` collects every `BREAKING CHANGE:` footer and
every `!:` subject between the previous published release and this one and puts them verbatim into
the release body under *Upgrade notes*; with none it writes that no published surface changed and a
club may replace `COURTSIDE_IMAGE_DIGEST` and restart. The footer is not paperwork, then, it is the text a
club reads before pulling the image, and `BREAKING CHANGE: renamed a variable` is a sentence that
helps nobody at 22:00.

The first public release has no upgrade origin, so its release body says that directly instead of
turning development-time breaking markers into upgrade instructions.

The `upgrade` gate executes the origins the release resolved from the published release history, so
a release that breaks one of those is refused, but only those. The same job runs every night from a
retained dated nightly, so its mechanics are proven before the first release that has an origin needs
them.

`upgrade` reads `upgrade/fixtures/origin.sql` and `upgrade/verify.sql` from the origin's tag or commit, loads
the fixture into the origin and compares what the origin's query saw with what the candidate's query
sees after migrating. Every key `verify.sql` reports is therefore a contract with every later
release: a key may be added, but one renamed, dropped or given a different meaning reads as lost
data and refuses the next release until the change is explained in the upgrade proof.
`UpgradeProofTest` pins the list, so a key change is a deliberate edit rather than a side effect.

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
than from the tags that happen to exist. Candidates of the first release are no origins at all:
until a release exists no schema is frozen, so the release's `upgrade` gate has no origin and is
skipped.

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

The GitHub release carries four files: the `openapi.yaml` this version answers to,
`security-record.json`, `courtside-deployment-<version>.zip` and that archive's `.sha256`. The
archive is attested like the image. The security record is an ordinary release asset, neither
signed nor attested, so it reports what the passes found rather than proving it.

`deploy/.env.example` names `COURTSIDE_IMAGE_DIGEST`; a club copies the 64 hexadecimal characters
after `sha256:` into that line and recreates the container. The deployment reference in
`deploy/README.md` is what they follow, not this file.
