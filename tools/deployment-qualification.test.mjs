import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildArchive } from "./deployment-archive.mjs";
import {
  changedRecipes,
  collectRuntimeIdentity,
  createQualificationEvidence,
  inspectDeploymentArchive,
  qualificationPlan,
  renderDeploymentRecipes,
} from "./deployment-qualification.mjs";

const deploy = fileURLToPath(new URL("../deploy", import.meta.url));

const manifest = {
  schema: 1,
  version: "0.1.0-rc.2",
  revision: "a".repeat(40),
  image: `ghcr.io/jegr78/courtside@sha256:${"b".repeat(64)}`,
  recipes: ["existing-infrastructure", "full-self-hosted", "funnel", "standard"],
  files: { "courtside": "c".repeat(64) },
  archiveSha256: "d".repeat(64),
};

test("given a clean standard target, when qualification is planned, then every required lifecycle transition uses the archive namespace", () => {
  // given
  const input = {
    recipe: "standard",
    namespace: "courtside-qualification-standard",
    archiveRoot: "/tmp/courtside-deployment-0.1.0-rc.2",
    installationRoot: "/srv/courtside-qualification-standard",
    manifest,
  };

  // when
  const plan = qualificationPlan(input);

  // then
  assert.deepEqual(plan.map(({ id }) => id), [
    "clean-target", "archive-integrity", "compose-render", "install", "bootstrap", "mail-handover",
    "restart", "backup", "restore", "update", "repeat", "failure-recovery",
  ]);
  assert.ok(plan.every(({ command }) => command.includes(input.namespace)
    || command.includes(input.archiveRoot) || command.includes(input.installationRoot)));
  assert.ok(plan.every(({ command }) => !/docker\s+(?:system|volume|image|container)\s+prune/.test(command)));
});

test("given locally controllable and operator-owned results, when evidence is created, then uncertainty is kept distinct from success", () => {
  // given
  const results = [
    { id: "install", ownership: "courtside", outcome: "passed", durationMs: 1200 },
    { id: "public-dns", ownership: "operator", outcome: "unknown", detail: "not-observed", durationMs: 10 },
    { id: "mail-reputation", ownership: "operator", outcome: "warning", detail: "provider-owned", durationMs: 10 },
  ];

  // when
  const evidence = createQualificationEvidence({
    manifest,
    recipe: "funnel",
    namespace: "courtside-qualification-funnel",
    platform: { os: "Ubuntu 24.04", architecture: "amd64" },
    dockerVersion: "28.4.0",
    composeVersion: "2.39.4",
    results,
  });

  // then
  assert.equal(evidence.outcome, "passed-with-unknowns");
  assert.equal(evidence.results[1].outcome, "unknown");
  assert.equal(evidence.results[2].outcome, "warning");
  assert.equal(JSON.stringify(evidence).includes("targetAddress"), false);
});

test("given evidence metadata, when it lacks an archive digest or carries free-form target detail, then publication is refused", () => {
  const input = {
    manifest,
    recipe: "funnel",
    namespace: "courtside-qualification-funnel",
    platform: { os: "Ubuntu 24.04", architecture: "amd64" },
    dockerVersion: "28.4.0",
    composeVersion: "2.39.4",
    results: [{ id: "public-dns", ownership: "operator", outcome: "unknown",
      detail: "target qualification-box.local", durationMs: 1 }],
  };

  assert.throws(() => createQualificationEvidence(input), /detail/);
  assert.throws(() => createQualificationEvidence({ ...input,
    manifest: { ...manifest, archiveSha256: undefined },
    results: [{ ...input.results[0], detail: "not-observed" }] }), /archive digest/);
});

test("given a secret or an incomplete software result, when evidence is created, then publication is refused", () => {
  // given
  const common = {
    manifest,
    recipe: "standard",
    namespace: "courtside-qualification-standard",
    platform: { os: "Ubuntu 24.04", architecture: "amd64" },
    dockerVersion: "28.4.0",
    composeVersion: "2.39.4",
  };

  // when / then
  assert.throws(() => createQualificationEvidence({ ...common,
    results: [{ id: "install", ownership: "courtside", outcome: "unknown", durationMs: 1 }] }),
  /Courtside-owned result.*unknown/);
  assert.throws(() => createQualificationEvidence({ ...common,
    results: [{ id: "install", ownership: "courtside", outcome: "passed", durationMs: 1,
      detail: "password=hunter2" }] }), /sensitive value/);
});

test("given changed deployment files, when PR qualification is selected, then shared and component changes choose the affected recipes", () => {
  // given
  const catalog = [
    { name: "standard", files: ["compose.yaml", "compose.smtp-relay.yaml"] },
    { name: "full-self-hosted", files: ["compose.yaml", "compose.stalwart.yaml"] },
    { name: "existing-infrastructure", files: ["compose.yaml", "compose.external-database.yaml"] },
    { name: "funnel", files: ["compose.yaml", "compose.caddy-forwarded.yaml"] },
  ];

  // when / then
  assert.deepEqual(changedRecipes(["deploy/compose.stalwart.yaml"], catalog), ["full-self-hosted"]);
  assert.deepEqual(changedRecipes(["deploy/recipes/funnel.recipe"], catalog), ["funnel"]);
  assert.deepEqual(changedRecipes(["deploy/courtside"], catalog),
    ["existing-infrastructure", "full-self-hosted", "funnel", "standard"]);
});

test("given the candidate archive, when qualification inspects it, then evidence binds the exact archive and image without a checkout", () => {
  const scratch = mkdtempSync(join(tmpdir(), "courtside-qualification-"));
  try {
    // given
    const built = buildArchive({ deploy, version: manifest.version, revision: manifest.revision,
      image: manifest.image, repository: "jegr78/courtside", ref: "refs/tags/v0.1.0-rc.2" });
    const archive = join(scratch, built.name);
    writeFileSync(archive, built.zip);

    // when
    const inspected = inspectDeploymentArchive({ archive, destination: join(scratch, "extracted"),
      expectedImage: manifest.image, selectedRecipes: ["standard", "full-self-hosted"] });

    // then
    assert.equal(inspected.archiveDigest, built.sha256);
    assert.equal(inspected.manifest.image, manifest.image);
    assert.deepEqual(inspected.recipes, ["full-self-hosted", "standard"]);
    assert.doesNotMatch(JSON.stringify(inspected.evidence), new RegExp(scratch));
    assert.throws(() => inspectDeploymentArchive({ archive, destination: join(scratch, "wrong-image"),
      expectedImage: `ghcr.io/jegr78/courtside@sha256:${"d".repeat(64)}`,
      selectedRecipes: ["standard"] }), /does not name the expected image/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("given an archive with a symlinked manifest, when qualification inspects it, then no member is read", () => {
  const scratch = mkdtempSync(join(tmpdir(), "courtside-qualification-link-"));
  try {
    const root = join(scratch, "courtside-deployment-hostile");
    mkdirSync(root);
    symlinkSync("/etc/passwd", join(root, "manifest.json"));
    const archive = join(scratch, "hostile.zip");
    const zipped = spawnSync("zip", ["-q", "-y", "-r", archive, "courtside-deployment-hostile"],
      { cwd: scratch, encoding: "utf8" });
    assert.equal(zipped.status, 0, zipped.stderr);

    assert.throws(() => inspectDeploymentArchive({ archive, destination: join(scratch, "extracted"),
      expectedImage: manifest.image, selectedRecipes: ["standard"] }), /symbolic link/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("given an inspected candidate, when its selected recipes are rendered, then Compose reads only files from that candidate", () => {
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    if (command.endsWith("bash")) return { status: 0, stdout: "compose.yaml\ncompose.smtp-relay.yaml\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };

  const rendered = renderDeploymentRecipes({
    root: "/tmp/courtside-deployment-0.1.0",
    selectedRecipes: ["standard"],
    image: manifest.image,
    execute,
  });

  assert.deepEqual(rendered, ["standard"]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ["/tmp/courtside-deployment-0.1.0/recipe.sh", "files", "standard"]);
  assert.ok(calls[1].args.includes("/tmp/courtside-deployment-0.1.0/compose.yaml"));
  assert.ok(calls[1].args.includes("/tmp/courtside-deployment-0.1.0/compose.smtp-relay.yaml"));
  assert.equal(calls[1].options.env.COURTSIDE_IMAGE_DIGEST, "b".repeat(64));
});

test("given a qualification host, when evidence identifies it, then only OS, architecture and tool versions are retained", () => {
  // given
  const execute = (name) => name === "docker" ? "28.4.0\n" : "2.39.4\n";

  // when
  const identity = collectRuntimeIdentity({
    architecture: "x64",
    readOsRelease: () => 'NAME="Ubuntu"\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.3 LTS"\n',
    execute,
  });

  // then
  assert.deepEqual(identity, {
    platform: { os: "Ubuntu 24.04.3 LTS", architecture: "amd64" },
    tools: { docker: "28.4.0", compose: "2.39.4" },
  });
  assert.equal(JSON.stringify(identity).includes("host"), false);
});
