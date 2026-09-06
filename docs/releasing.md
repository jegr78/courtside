# Cutting a release

A release is an annotated tag `v<version>` on `main`. Everything after that is automatic, and
almost everything the automation does is a refusal — it would rather not publish than publish
something nobody verified.

This document says what to do in what order. `CLAUDE.md` remains the policy for branches, commits
and pull requests; this is the part that happens after the last one is merged.

## The short version

```sh
git switch main && git pull --ff-only
git tag -a v0.2.0 -m "Courtside 0.2.0"
git push origin v0.2.0
```

The version is the tag without its leading `v`, and the workflow stamps that into the build. There
is no other place a version is written: the `pom.xml` carries a `-SNAPSHOT` between releases and is
never edited to cut one.

## What the release refuses before it builds anything

Three checks run before a single compilation, and each of them fails the run rather than warns.

**The tag has to sit on `main`.** A tag on a branch, or on a commit that never landed, is refused
by name. Move the tag rather than arguing with the check: delete it, merge what is missing, tag
again.

**A nightly must already have verified this commit.** The release looks for a scheduled `build`
run that succeeded on its *first* attempt, whose head commit is an ancestor of the tag, and whose
recorded evidence says `releaseReadiness: complete`. A re-run that went green on the second attempt
does not count, and neither does a nightly that verified something later than the tag. If the check
refuses, the answer is usually to wait for tonight's run rather than to tag again.

**No `nightly` failure issue may be open.** The scheduled-run tracker opens one issue per failing
gate and closes it after seven consecutive green first attempts. While one is open the release
stops — except for `npm audit`, which is excluded by name because its findings arrive from outside
the repository and are tracked on their own.

Together these mean a release is never the first time the full suite runs against the code being
released.

## What runs, and what each part proves

| Job | What it establishes |
|---|---|
| `build` | The version is stamped, the full suite passes, CodeQL analyses the sources, npm audit evidence is captured, and the release-build security policy holds |
| `image` | One multi-architecture image is built and pushed as `release-candidate-<sha>` |
| `qualify` | That exact digest is brought up through the reference deployment on `amd64` and `arm64`, and its vulnerabilities are checked against the candidate-image policy |
| `active-security` | The running candidate is exercised by the authenticated scanner |
| `upgrade` | The database upgrade path from every supported origin is executed against the candidate |
| `restore` | A backup taken from the candidate is restored into it |
| `security-record` | The evidence from the passes above is sealed |
| `publish` | The qualified manifest is tagged, signed with cosign, given an SBOM and a provenance attestation, and the GitHub release is written |

`publish` retags the manifest that `qualify` proved. Nothing is rebuilt between qualification and
publication, so the digest a club pulls is the digest that was brought up twice.

## When a release fails

It stops at the job that refused, and nothing is published. What exists afterwards is the
`release-candidate-<sha>` image in the registry — a candidate, not a release, and no club will
resolve a version tag to it.

**The tag stays where it is.** Do not delete and re-push a tag to retry: a tag that once named a
commit and later names another is the one thing consumers cannot detect. Fix the cause on `main`
through the usual pull request, then cut the next patch version. A `v0.2.0` that failed is followed
by `v0.2.1`, not by a second `v0.2.0`.

The exception is a tag that never started a run at all — a typo in the name, a push that raced a
branch protection — where nothing observed it and re-tagging costs nobody anything.

## When the change is breaking

The compatibility contract in `docs/design.md` says what counts: the REST API and the environment
variables a club sets are the published surface, and a change in the shape of either is breaking. A
pull request that makes one carries `!` in its Conventional Commit title or a `BREAKING CHANGE:`
footer, which is what the title lint reads and what the version bump follows.

**The upgrade note writes itself from your commit messages.** `build` collects every
`BREAKING CHANGE:` footer and every `!:` subject between the previous tag and this one and puts them
verbatim into the release body under *Upgrade notes*; with none it says that no published surface
changed and a club may raise `COURTSIDE_VERSION` and restart. So the footer is not paperwork — it is
the text a club reads before pulling the image, and "BREAKING CHANGE: renamed a variable" is a
sentence that helps nobody at 22:00.

What no automation covers is the upgrade path: a supported origin has to still reach the new schema.
The `upgrade` job executes every origin the repository declares, so a release that breaks one is
refused, but only for the origins that are on the list.

## After the release

The image is at `ghcr.io/jegr78/courtside:<version>`, signed, and the GitHub release carries two
files: the `openapi.yaml` this version answers to, and `security-record.json`, the sealed evidence
of the passes above. A tag with a hyphen in it —
`v0.3.0-rc1` — is published as a prerelease, which is how a candidate reaches a club that wants to
try it without being offered to everyone.

`deploy/.env.example` names `COURTSIDE_VERSION`, and a club moves by editing that one line and
recreating the container — the deployment reference in `deploy/README.md` is what they follow, not
this file.
