import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = (name) => yaml.load(read(`.github/workflows/${name}`));
const triggersOf = (loaded) => loaded.on ?? loaded[true];

const releaseDispatch = "(github.event_name == 'workflow_dispatch' && startsWith(github.ref, 'refs/heads/release/'))";

test("given a push to a release branch, when the build triggers are read, then no build starts beside the dispatched one",
  () => {
    // given
    const build = workflow("build.yml");

    // when / then
    assert.deepEqual(triggersOf(build).push, { branches: ["main"] },
      "a patch is proven by one dispatched build, so a merge into release/* must not start another full build");
    for (const name of ["post-merge-smoke.yml", "pages.yml"]) {
      assert.deepEqual(triggersOf(workflow(name)).push.branches, ["main"], `${name} stays on main`);
    }
  });

test("given a build dispatched on a release branch, when it finishes, then it runs the nightly image and the gates without publishing",
  () => {
    // given
    const jobs = workflow("build.yml").jobs;

    // when / then
    assert.equal(jobs["nightly-image"].if, "${{ always() && needs.build.result == 'success' && "
      + "(github.event_name == 'schedule' || ((github.event_name == 'workflow_dispatch' || github.event_name == 'push') "
      + `&& github.ref == 'refs/heads/main') || ${releaseDispatch}) }}`);
    assert.equal(jobs["nightly-image"].with.publish, "${{ github.ref == 'refs/heads/main' }}",
      "only main moves the nightly tags");
    assert.equal(jobs["nightly-image"].with.rebuild, "${{ github.event_name != 'push' }}");
    assert.equal(jobs["release-gates"].if, "${{ always() && needs.nightly-image.result == 'success' && "
      + "(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') }}");
    assert.equal(jobs["release-gates"].with["upgrade-origins"],
      "${{ startsWith(github.ref, 'refs/heads/release/') && 'line' || 'nightly' }}",
      "main's nightlies carry migrations a release branch lacks, so a patch upgrades from its line's releases");
    assert.equal(jobs["nightly-release-evidence"].if, "${{ always() && (github.event_name == 'schedule' || "
      + "((github.event_name == 'workflow_dispatch' || github.event_name == 'push') && github.ref == 'refs/heads/main') || "
      + `${releaseDispatch}) }}`, "the release-branch build records the same evidence contract");
  });

test("given a verified build on a release branch, when the nightly image selects its revision, then it checks that branch",
  () => {
    // given
    const selection = workflow("nightly-image.yml").jobs.select.steps.find((step) => step.id === "selection").run;

    // when / then
    assert.match(selection, /if \[\[ "\$GITHUB_REF" =~ \^refs\/heads\/release\/\[0-9\]\+\\\.\[0-9\]\+\$ \]\]; then\n\s+branch="\$\{GITHUB_REF#refs\/heads\/\}"/);
    assert.match(selection, /elif \[\[ "\$GITHUB_REF" == refs\/heads\/release\/\* \]\]; then\n\s+echo "::error::[^"]+"\n\s+exit 1/,
      "a branch that only looks like a release line is refused rather than checked against main");
    assert.match(selection, /git fetch --no-tags origin "\+refs\/heads\/\$branch:refs\/remotes\/origin\/\$branch"\n\s+git cat-file -e "\$\{commit\}\^\{commit\}"\n\s+git merge-base --is-ancestor "\$commit" "refs\/remotes\/origin\/\$branch"/);
    assert.doesNotMatch(selection, /origin\/\$DEFAULT_BRANCH/, "a patch commit is not on main and never will be");
    assert.match(selection, /if \[\[ "\$publish" = true && "\$GITHUB_REF" != 'refs\/heads\/main' \]\]/,
      "publication still requires main");
  });

test("given release gates for a release branch, when upgrade origins resolve, then the line's published releases are used",
  () => {
    // given
    const resolve = workflow("release-gates.yml").jobs["upgrade-origins"].steps.find((step) => step.id === "resolve").run;

    // when / then
    assert.match(resolve, /elif \[ "\$REQUESTED" = line \]; then\n\s+published=\$\(node tools\/published-release-tags\.mjs\)\n\s+origins=\$\(node tools\/courtside\.upgrade-smoke\.mjs --line-origins "\$GITHUB_REPOSITORY" "\$published"\)/);
    assert.ok(resolve.indexOf('"$REQUESTED" = nightly') < resolve.indexOf('"$REQUESTED" = line'),
      "the nightly path is unchanged and checked first");
  });

test("given the release jobs that read a branch or a dispatch input, when their scripts are read, then values arrive through env",
  () => {
    // given
    const candidate = workflow("release-candidate.yml").jobs;
    const scripts = [
      ...candidate.select.steps, ...candidate.preconditions.steps
    ].filter((step) => step.run).map((step) => [step.name ?? step.id, step.run]);

    // when / then
    for (const [name, run] of scripts) {
      assert.doesNotMatch(run, /\$\{\{/, `${name} interpolates an expression into its shell instead of reading env`);
    }
    assert.deepEqual(candidate.preconditions.permissions, { actions: "read", contents: "read", issues: "read" });
  });

test("given a pull request into main or a release branch, when the release line workflow runs, then the base's tool judges it",
  () => {
    // given
    const loaded = workflow("release-line.yml");
    const triggers = triggersOf(loaded);
    const job = loaded.jobs["release-line"];
    const checkout = job.steps.find((step) => String(step.uses).startsWith("actions/checkout@"));
    const fetch = job.steps.find((step) => step.name === "Fetch the pull request head");
    const check = job.steps.find((step) => step.name === "Check the release line and its forward ports");

    // when / then
    assert.deepEqual(triggers.pull_request, { branches: ["main", "release/*"] },
      "every pull request reports the check, so it can be required without blocking ordinary ones");
    assert.equal(triggers.pull_request_target, undefined, "the check reads code, so it never runs with base-repo authority");
    assert.deepEqual(Object.keys(triggers.workflow_dispatch.inputs), ["head"],
      "a dispatch on a real branch checks a head against it, which is how a refusal is exercised without a release");
    assert.equal(job.name, "release line");
    assert.deepEqual(loaded.permissions, {});
    assert.deepEqual(job.permissions, { contents: "read" });
    assert.equal(checkout.with.ref, "${{ github.event.pull_request.base.sha || github.sha }}",
      "the pull request under review must not be able to rewrite the tool that judges it");
    assert.equal(checkout.with["fetch-depth"], 0);
    assert.equal(checkout.with["persist-credentials"], false);
    assert.equal(fetch.if, "github.event_name == 'pull_request'");
    assert.equal(fetch.env.NUMBER, "${{ github.event.pull_request.number }}");
    assert.match(fetch.run, /git fetch --no-tags origin "\+refs\/pull\/\$NUMBER\/head:refs\/remotes\/pull\/head"/);
    assert.deepEqual(check.env, {
      BASE: "${{ github.event_name == 'pull_request' && github.base_ref || github.ref_name }}",
      HEAD: "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || inputs.head }}",
      PULL_REQUEST_BODY: "${{ github.event.pull_request.body }}"
    });
    assert.equal(check.run.trim().split("\n").at(-1),
      'node tools/release-line.mjs pull-request --base "$BASE" --head "$HEAD" --summary "$GITHUB_STEP_SUMMARY"');
    assert.match(check.run, /^if \[ ! -f tools\/release-line\.mjs \]; then\n\s+echo "::notice::[^"]+"\n\s+exit 0\nfi\n/,
      "only a base that does not carry the tool yet, as on the pull request adding it, passes without it");
    for (const step of job.steps.filter((candidate) => candidate.run)) {
      assert.doesNotMatch(step.run, /\$\{\{/, `${step.name} reads its values through env`);
    }
  });

test("given the release workflow, when its triggers are read, then only a pushed tag starts it", () => {
  // when / then
  assert.deepEqual(triggersOf(workflow("release.yml")), { push: { tags: ["v*"] } },
    "a dispatch of release.yml would reach publish; the checks are dispatched through release-admission.yml instead");
});

test("given a tag name and a commit, when the admission is dispatched, then it runs the release's own checks and publishes nothing",
  () => {
    // given
    const loaded = workflow("release-admission.yml");
    const source = read(".github/workflows/release-admission.yml");
    const job = loaded.jobs.admission;
    const admit = job.steps.find((step) => step.id === "admit");
    const evidence = job.steps.find((step) => step.name === "Find the nightly evidence on that branch");

    // when / then
    assert.deepEqual(Object.keys(triggersOf(loaded)), ["workflow_dispatch"]);
    assert.deepEqual(Object.keys(triggersOf(loaded).workflow_dispatch.inputs), ["tag", "commit"],
      "the tag is named, never pushed, so the commit it would point at is named beside it");
    assert.deepEqual(loaded.permissions, {});
    assert.deepEqual(job.permissions, { actions: "read", contents: "read" });
    assert.deepEqual(Object.keys(loaded.jobs), ["admission"]);
    assert.doesNotMatch(source, /secrets\.|cosign|gh release|docker\/login-action|imagetools|git push|packages: write|contents: write/,
      "the admission only reads");
    assert.deepEqual(admit.env, { TAG: "${{ inputs.tag }}", COMMIT: "${{ inputs.commit }}", GH_TOKEN: "${{ github.token }}" });
    assert.equal(admit.run.trim(), [
      "published=$(node tools/published-release-tags.mjs)",
      'node tools/release-line.mjs admit-tag --tag "$TAG" --commit "$COMMIT" --published-tags "$published" '
        + '--summary "$GITHUB_STEP_SUMMARY" --github-output "$GITHUB_OUTPUT"'
    ].join("\n"), "the same command release.yml runs for a pushed tag");
    assert.equal(admit["continue-on-error"], true, "every verdict is reported, not only the first refusal");
    assert.equal(evidence.run.trim(), 'node tools/nightly-release-evidence.mjs --find --branch "$BRANCH" --commit "$COMMIT"',
      "the same lookup the candidate's preconditions run");
    assert.deepEqual(evidence.env, { BRANCH: "${{ steps.admit.outputs.branch }}", COMMIT: "${{ inputs.commit }}",
      GH_TOKEN: "${{ github.token }}" });
    const verdict = job.steps.at(-1);
    assert.equal(verdict.if, "always()");
    assert.equal(evidence.if, "always() && steps.admit.outputs.branch != ''",
      "the evidence is looked up even when the manifest refused the tag, as long as the tag named a line");
    assert.equal(evidence["continue-on-error"], true);
    assert.deepEqual(verdict.env, { ADMISSION: "${{ steps.admit.outcome }}", EVIDENCE: "${{ steps.evidence.outcome }}" });
    assert.match(verdict.run, /test "\$ADMISSION" = success\ntest "\$EVIDENCE" = success/,
      "a refused tag or missing evidence turns the run red after every check reported");
    assert.match(verdict.run, /case "\$EVIDENCE" in\n\s+skipped\) evidence="not looked up, because the tag names no release line" ;;/,
      "a skipped lookup is reported as skipped, not as an empty outcome");
    for (const step of job.steps.filter((candidate) => candidate.run)) {
      assert.doesNotMatch(step.run, /\$\{\{/, `${step.name} reads its values through env`);
    }
  });

test("given a pushed tag, when the release admits it, then published releases decide the line and whether it becomes latest",
  () => {
    // given
    const release = workflow("release.yml");
    const candidate = release.jobs.candidate;
    const admit = candidate.steps.find((step) => step.id === "admit");
    const publishSteps = release.jobs.publish.steps;
    const draft = publishSteps.find((step) => String(step.uses).startsWith("softprops/action-gh-release@"));
    const visible = publishSteps.find((step) => step.name === "Publish the GitHub release");

    // when / then
    assert.equal(admit.name, "Refuse a tag outside the branch its version belongs to");
    assert.deepEqual(admit.env, { GH_TOKEN: "${{ github.token }}" });
    assert.equal(admit.run.trim(), [
      "published=$(node tools/published-release-tags.mjs)",
      'node tools/release-line.mjs admit-tag --tag "$GITHUB_REF_NAME" --commit "$GITHUB_SHA" '
        + '--published-tags "$published" --github-output "$GITHUB_OUTPUT"'
    ].join("\n"));
    assert.equal(candidate.outputs.latest, "${{ steps.admit.outputs.latest }}");
    assert.equal(candidate.steps.find((step) => step.name === "Refuse a tag the repository does not record as its release"),
      undefined, "the admission's manifest verdict reads the same file at the same commit");
    assert.equal(draft.with.make_latest, "false", "a draft cannot be latest, so the release decides it when it turns visible");
    assert.deepEqual(visible.env, { GH_TOKEN: "${{ github.token }}", LATEST: "${{ needs.candidate.outputs.latest }}" });
    assert.equal(visible.run.trim(),
      'gh release edit "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" --draft=false --latest="$LATEST"');
  });

test("given a push to a branch named like a release line, when release-please starts, then only release/<major>.<minor> passes",
  () => {
    // given
    const loaded = workflow("release-please.yml");
    const guard = loaded.jobs["release-please"].steps.find((step) => step.name === "Refuse a branch that is no release line");

    // when / then
    assert.deepEqual(triggersOf(loaded).push.branches, ["main", "release/[0-9]*.[0-9]*"]);
    assert.deepEqual(guard.env, { BRANCH: "${{ github.ref_name }}" });
    const passes = (branch) => spawnSync("bash", ["-c", guard.run], { env: { ...process.env, BRANCH: branch } }).status === 0;
    assert.deepEqual(["main", "release/0.1", "release/10.12"].filter(passes), ["main", "release/0.1", "release/10.12"]);
    assert.deepEqual(["release/0.1.1", "release/01.1", "release/0.1-evil", "release/x"].filter(passes), [],
      "the trigger glob also matches these, so the guard is what keeps the token away from them");
    assert.ok(loaded.jobs["release-please"].steps.indexOf(guard) < loaded.jobs["release-please"].steps.findIndex(
      (step) => step.id === "release"), "the token is not used for a branch the guard refuses");
  });

test("given a release pull request's body, when the release line runs, then the tool reads it from the event", () => {
  // given
  const check = workflow("release-line.yml").jobs["release-line"].steps
    .find((step) => step.name === "Check the release line and its forward ports");

  // when / then
  assert.equal(check.env.PULL_REQUEST_BODY, "${{ github.event.pull_request.body }}",
    "a commit override in the body is refused, because release-please would read it and git does not carry it");
});

test("given a patch candidate, when its preconditions run, then main's nightly failures do not hold it", () => {
  // given
  const failures = workflow("release-candidate.yml").jobs.preconditions.steps
    .find((step) => step.name === "Refuse unresolved nightly failures");

  // when / then
  assert.equal(failures.if, "needs.select.outputs.branch == 'main'",
    "the tracker files scheduled failures of main; a patch is held by its own branch's complete evidence instead");
});

test("given a build dispatched on a release branch, when the nightly image runs, then it plans no registry retention", () => {
  // when / then
  assert.equal(workflow("nightly-image.yml").jobs["retention-plan"].if,
    "github.event_name == 'workflow_dispatch' && inputs.publish != true && !startsWith(github.ref, 'refs/heads/release/')",
    "retention belongs to main's nightly tags; a patch build only qualifies its image");
});
