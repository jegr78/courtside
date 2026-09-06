# Cutting a release

A release is a tag `v<version>` on this repository. Nobody types it: release-please keeps a release
pull request open, and merging it writes the version, the changelog and the tag. Everything after
that is automatic, and almost everything the automation does is a refusal — it would rather not
publish than publish something nobody verified.

This document says what to do in what order, and what the release does *not* guarantee, which is the
half a workflow file cannot tell you. `CLAUDE.md` remains the policy for branches, commits and pull
requests; this is the part that happens after the last one is merged.

**Merging the release pull request is signing a release.** `publish` signs the image with cosign
under this repository's own identity, keyless, and attests its provenance and SBOM. No human
approves anything in between. Whoever may merge that pull request — or push a `v*` tag by hand —
may publish under this project's name.

## The short version

There is nothing to type. A release pull request titled `chore(main): release <version>` stands
open on `main` and grows with every merge; it shows the version it would cut and the changelog it
would write. Merge it when a nightly has verified the commit it sits on, and the rest happens.

A second pull request follows each release and moves `pom.xml` on to the next `-SNAPSHOT`. It
carries no release and no tag; merge it and forget it.

**What the merge writes.** Merging the release pull request writes the tag and a *draft* GitHub
release. A draft is visible to whoever may write to this repository and to nobody else, and `publish`
is what turns it into the release a club sees — after every gate above it has passed. A run that
stops earlier leaves the draft standing, which is why a failed release is invisible from the outside
rather than merely unsigned.

**Where the version lives.** `pom.xml` carries it between releases: release-please writes it, Maven
writes `build-info.properties` from it, and `GET /api/source` reports that to the browser — so the
version a member reads in the footer is the one that was released, and between releases it is the
`-SNAPSHOT` that says which release it follows. `frontend/package.json` is kept in step by the same
pull request, so nothing there can drift. The release build itself does not trust any of that: it
takes the version from the tag and stamps it in with `versions:set`, so what is published is what
the tag says even if the pom were to disagree.

## Cutting a candidate

Candidates are opened and closed with one line of configuration, not with a hand-typed version.

1. Set `"prerelease": true` in `release-please-config.json` and merge that. The next release pull
   request proposes `v0.3.0-rc.1`, and every merge after it raises `rc.2`, `rc.3`.
2. To open an `alpha` line instead, land a commit carrying a `Release-As:` footer naming
   `0.3.0-alpha.1`; the strategy counts that suffix onwards by itself. That footer names the version
   outright and overrides everything else, `bump-minor-pre-major` included — it is the one way to
   reach 1.0 without a decision, so read the version in the release pull request's own title before
   merging it.
3. Set `"prerelease": false` again to graduate. The suffix is stripped and the next release pull
   request proposes `v0.3.0`.

Nothing else changes: a candidate travels the same pipeline, and section 10 of `docs/design.md` says
what that means.

## What the release refuses before it builds anything

Three checks run before a single compilation, and each fails the run rather than warning.

**The tag has to sit on `main`.** A tag on a branch, or on a commit that never landed, is refused by
name. The tag is spent at that point — *When a release fails* below applies to this refusal like any
other.

**A nightly must already have verified an ancestor of this commit.** The release looks for a
scheduled `build` run that succeeded on its *first* attempt, whose head commit is an ancestor of
the tag, and whose recorded evidence says `releaseReadiness: complete`. A run that went green on its
second attempt does not count. Note what this does and does not establish: some ancestor was
verified in full, not the tagged commit. What verifies the tagged commit is the release's own
`build` job.

**No tracker-written `nightly` failure issue may be open.** The check counts open issues carrying
the `nightly` label whose title starts with `[nightly] ` and whose body holds the tracker's
fingerprint — the issues the scheduled-run tracker wrote. An issue a human opened about a failing
night does not stop a release. Issues reporting `npm audit` are excluded by name, because those
findings arrive from outside the repository and are tracked on their own.

**The tracker never closes one of those issues itself.** After seven consecutive green first
attempts it comments that the issue is ready for closure review and says, in as many words, that it
remains open. Somebody has to close it. A release that seems blocked for no reason is usually
waiting on exactly that.

## What runs, and what each part proves

| Job | What it establishes |
|---|---|
| `build` | The version is stamped, the full suite passes on the tagged commit, CodeQL analyses the sources, npm audit evidence is captured, and the release-build security policy holds |
| `image` | One multi-architecture image is built and pushed as `release-candidate-<sha>` |
| `qualify` | That exact digest is brought up through the reference deployment on `amd64` and `arm64`, and its vulnerabilities are checked against the candidate-image policy |
| `active-security` | The running candidate is exercised by the scanners of the `active` profile. The `destructive` profile — resource abuse — does not run here |
| `upgrade` | The database upgrade path from each resolved origin is executed against the candidate |
| `restore` | A backup taken from the candidate is restored into it |
| `security-record` | The build, image, qualify and active-security evidence is collected into one file. `upgrade` and `restore` are not in it |
| `publish` | The qualified manifest is tagged, signed with cosign, given an SBOM and a provenance attestation, and the GitHub release is written |

`publish` retags the manifest that `qualify` proved. Nothing is rebuilt between qualification and
publication, so the digest a club pulls is the digest that was brought up twice.

## When a release fails

It stops at the job that refused, and nothing is published under a version tag: the release the
merge created is still a draft and stays one. What stays behind is the `release-candidate-<sha>`
image, unsigned and unqualified, in a public registry — nothing removes those, and no version tag
resolves to one.

**The tag stays where it is.** A tag that once named a commit and later names another is the one
thing a consumer cannot detect, and by the time a run has started, the tag has been observed. Fix
the cause on `main` through the usual pull request; the next release pull request then proposes the
patch after it, so a `v0.2.0` that failed is followed by `v0.2.1`. The version that failed is
skipped rather than retried, and the manifest already names it — worth knowing before somebody
looks for a `v0.2.0` that never appeared.

Only a tag no run ever saw is free to move, and under a `v*` trigger that is rarer than it sounds —
a misspelling that keeps the leading `v` still starts a run.

A failed tag costs the next release nothing. Both things the release reads from its history — the
supported upgrade origins and the range the upgrade notes cover — come from the releases this
repository has **published**, not from the tags that exist. A tag whose run stopped before `publish`
therefore names a draft and no published release, is no origin, and shortens no range. It stays
where it is, and nothing has to be deleted to move on.

## When the change is breaking

The compatibility contract in `docs/design.md` says what counts: the REST API and the environment
variables a club sets are the published surface, and a change in the shape of either is breaking. A
pull request that makes one carries `!` in its Conventional Commit title or a `BREAKING CHANGE:`
footer, which is what the title lint reads and what the version bump follows.

**The upgrade note is your commit message.** `build` collects every `BREAKING CHANGE:` footer and
every `!:` subject between the previous tag and this one and puts them verbatim into the release
body under *Upgrade notes*; with none it writes that no published surface changed and a club may
raise `COURTSIDE_VERSION` and restart. The footer is not paperwork, then — it is the text a club
reads before pulling the image, and `BREAKING CHANGE: renamed a variable` is a sentence that helps
nobody at 22:00.

What no automation covers is the upgrade path itself. `upgrade` executes the origins it resolved
from the tag history, so a release that breaks one of those is refused — but only those.

## Candidates

A tag may carry a prerelease suffix — `v0.3.0-alpha.1`, `v0.3.0-rc.1` — and it travels the same
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
origin either — it named no image, and the release reads its history from what was published rather
than from the tags that happen to exist.

A version is read as semantic versioning defines it. Build metadata (`v0.3.0+build.1`) is refused
rather than interpreted, because nothing here has a use for it and a release that guessed would be
worse than one that stops.

Ordering follows semantic versioning, so `v0.3.0-rc` precedes `v0.3.0-rc.2`, which precedes
`v0.3.0-rc.10`, and all of them precede `v0.3.0`.

## After the release

The image is at `ghcr.io/jegr78/courtside`, signed. A release is published under four tags:
`<version>`, `<major>.<minor>`, `<major>` and `latest`. A club pinning `0.2.0` stays where it is;
one pinning `0.2`, `0` or `latest` moves with every matching release — worth knowing before
recommending a tag to anybody.

**A candidate is published under its own version and nothing else.** No floating tag follows it, and
the GitHub release is marked as a prerelease, so a club that pinned `latest` or `0.2` never receives
one by accident. Reaching a candidate is a deliberate act: pinning its exact version.

The GitHub release carries two files: the `openapi.yaml` this version answers to, and
`security-record.json`. That record is an ordinary release asset — neither signed nor attested,
unlike the image itself — so it reports what the passes found rather than proving it.

`deploy/.env.example` names `COURTSIDE_VERSION`, and a club moves by editing that one line and
recreating the container — the deployment reference in `deploy/README.md` is what they follow, not
this file.
