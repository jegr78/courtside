import assert from "node:assert/strict";
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
