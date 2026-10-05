import assert from "node:assert/strict";
import { test } from "node:test";
import { gatePlans, qualifiedCandidate, qualifyCandidate, runGatePlans } from "./local-release-gates.mjs";

const image = `sha256:${"a".repeat(64)}`;

test("given the local candidate image, when the restore gate is planned, then it restores into that image", () => {
  // given
  const context = { image, repository: "jegr78/courtside" };

  // when
  const [plan] = gatePlans("restore", context);

  // then
  assert.deepEqual(plan.arguments, ["tools/courtside.restore-smoke.mjs", "--confirm", "courtside-restore"]);
  assert.equal(plan.environment.COURTSIDE_RESTORE_IMAGE, image);
});

test("given retained nightlies, when the upgrade gate is planned, then every resolved origin runs once", () => {
  // given
  const context = { image, repository: "jegr78/courtside",
    origins: [{ ref: "b194064", image: "ghcr.io/jegr78/courtside:nightly-20261003-b194064" }] };

  // when
  const plans = gatePlans("upgrade", context);

  // then
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].arguments, ["tools/courtside.upgrade-smoke.mjs", "--confirm", "courtside-upgrade"]);
  assert.equal(plans[0].environment.COURTSIDE_UPGRADE_CANDIDATE_IMAGE, image);
  assert.equal(plans[0].environment.COURTSIDE_UPGRADE_ORIGIN, "b194064");
  assert.equal(plans[0].environment.COURTSIDE_UPGRADE_ORIGIN_IMAGE, "ghcr.io/jegr78/courtside:nightly-20261003-b194064");
  assert.equal(plans[0].environment.GITHUB_REPOSITORY, "jegr78/courtside");
});

test("given no upgrade origin, when the upgrade gate is planned, then it fails instead of passing empty", () => {
  // when / then
  assert.throws(() => gatePlans("upgrade", { image, repository: "a/b", origins: [] }), /no upgrade origin/);
});

test("given no origin and a change that corrects a migration, when the upgrade gate is planned, then it passes with a notice", () => {
  // given
  const notice = "no comparable upgrade origin: this change modifies upgrade/verify.sql; the next nightly covers the upgrade";

  // when
  const plans = gatePlans("upgrade", { image, repository: "a/b", origins: [], originNotice: notice });

  // then
  assert.deepEqual(plans, [{ label: "upgrade-notice", notice }]);
});

test("when an unknown gate is requested, then it is refused by name", () => {
  // when / then
  assert.throws(() => gatePlans("npm-audit", {}), /unknown gate npm-audit/);
});

test("given a run-scoped instance, when the qualification is planned, then it never touches the developer's UAT", () => {
  // given
  const instance = { project: "courtside-uat-gate-17", image: "courtside:uat-gate-17", httpPort: 41001,
    httpsPort: 41002, sharedPort: 41003, logPort: 41004 };

  // when
  const [uat] = gatePlans("uat", { instance });

  // then
  assert.deepEqual(uat.arguments, ["tools/courtside.uat-smoke.mjs", "--confirm", "courtside-uat-gate-17"]);
  assert.deepEqual(uat.environment, { COURTSIDE_UAT_PROJECT: "courtside-uat-gate-17",
    COURTSIDE_UAT_LOCAL_IMAGE: "courtside:uat-gate-17", COURTSIDE_UAT_HTTP_PORT: "41001",
    COURTSIDE_UAT_HTTPS_PORT: "41002", COURTSIDE_UAT_SHARED_PORT: "41003", COURTSIDE_OPERATIONAL_LOG_PORT: "41004" });
  assert.throws(() => gatePlans("uat", { instance: { ...instance, project: "courtside-uat" } }),
    /run-scoped/, "the developer's own UAT project is never a gate target");
  assert.throws(() => gatePlans("uat", { instance: { ...instance, image: "courtside:uat-local" } }), /run-scoped/);
});

test("given the mail gate, when it is planned, then it runs the Stalwart journey", () => {
  // when
  const [mail] = gatePlans("mail", {});

  // then
  assert.deepEqual(mail.arguments, ["tools/courtside.mail-smoke.mjs"]);
  assert.equal(mail.environment.COURTSIDE_MAIL_SMOKE_LOGS, "build/deployment-mail/server-logs");
});

test("given the active gate, when it is planned, then the target is removed even after a failure", () => {
  // when
  const plans = gatePlans("active-security", { image, runId: "local-1", commit: "c".repeat(40) });

  // then
  assert.deepEqual(plans.map((plan) => plan.label),
    ["security-images", "security-start", "security-run", "security-report", "security-gate", "security-cleanup"]);
  assert.deepEqual(plans.filter((plan) => plan.always).map((plan) => plan.label),
    ["security-report", "security-gate", "security-cleanup"], "the evidence and the cleanup follow any failure");
  assert.equal(plans[0].pull, true, "the profile's pinned images are pulled before the offline target starts");
  assert.deepEqual(plans[1].arguments, ["tools/courtside.mjs", "security", "local-1", image]);
  assert.ok(plans[2].arguments.includes("authorize-active-local-1"));
  assert.equal(plans[3].output, "build/security-gate/local-1/manifest.json");
  const gate = plans[4].arguments;
  assert.equal(gate[gate.indexOf("--subject") + 1], image, "the gate binds the assessed image ID");
  assert.equal(gate[gate.indexOf("--source-commit") + 1], "c".repeat(40));
});

test("given a qualification of another image, when a gate needs the candidate, then it refuses to run", () => {
  // given
  const commit = "c".repeat(40);
  const passed = { status: "passed", manifestDigest: image };
  const recorded = { image, commit, tag: "courtside:uat-gate-1" };

  // when / then
  assert.deepEqual(qualifiedCandidate(image, passed, recorded), { image, commit, tag: "courtside:uat-gate-1" },
    "the gates assess the commit the image was built from, not whatever HEAD is now");
  assert.throws(() => qualifiedCandidate(image, undefined, recorded), /run the uat gate first/);
  assert.throws(() => qualifiedCandidate(image, { status: "passed", manifestDigest: `sha256:${"b".repeat(64)}` },
    recorded), /qualified another image/);
  assert.throws(() => qualifiedCandidate(image, { status: "failed", manifestDigest: image }, recorded),
    /run the uat gate first/);
  assert.throws(() => qualifiedCandidate("", { status: "passed", manifestDigest: "" }, recorded),
    /run the uat gate first/);
  assert.throws(() => qualifiedCandidate(image, passed, undefined), /run the uat gate first/);
  assert.throws(() => qualifiedCandidate(image, passed, { ...recorded, image: `sha256:${"b".repeat(64)}` }),
    /recorded another image/);
  assert.throws(() => qualifiedCandidate(image, passed, { ...recorded, commit: "main" }), /run the uat gate first/);
  assert.throws(() => qualifiedCandidate(image, passed, { ...recorded, tag: "courtside:uat-local" }), /run the uat gate first/);
});

test("given a failing step, when the plans run, then only the always steps follow and the gate fails by label", () => {
  // given
  const ran = [];
  const plans = [{ label: "start" }, { label: "run" }, { label: "skipped" }, { label: "cleanup", always: true }];

  // when / then
  assert.throws(() => runGatePlans(plans, (plan) => {
    ran.push(plan.label);
    return plan.label === "run" ? 1 : 0;
  }), /run failed/);
  assert.deepEqual(ran, ["start", "run", "cleanup"]);
});

test("given only passing steps, when the plans run, then every step runs once", () => {
  // given
  const ran = [];

  // when
  runGatePlans([{ label: "a" }, { label: "b", always: true }], (plan) => {
    ran.push(plan.label);
    return 0;
  });

  // then
  assert.deepEqual(ran, ["a", "b"]);
});

test("given a qualification that fails, when the uat gate ends, then its run-scoped image is removed", () => {
  // given
  const removed = [];

  // when / then
  assert.throws(() => qualifyCandidate([{ label: "uat" }], "courtside:uat-gate-9", () => 1, (tag) => removed.push(tag)),
    /uat failed/);
  assert.deepEqual(removed, ["courtside:uat-gate-9"], "a failed run leaves no image only it could have used");
  qualifyCandidate([{ label: "uat" }], "courtside:uat-gate-10", () => 0, (tag) => removed.push(tag));
  assert.deepEqual(removed, ["courtside:uat-gate-9"], "a qualified image stays for the gates after it");
});
