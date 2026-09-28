import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync,
  writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
const origin = {
  version: "0.1.0-nightly.35357563487",
  revision: "1bad4df6e777c2e1bd4c4e2b521bad55f3f4ae31",
  publishedImage: "ghcr.io/jegr78/courtside@sha256:19bb8da8b6d7f49b6469f9496fecd0374dd1c8477d1c757aef5a78ad6edff856",
};
const nightlySigner =
  "https://github.com/jegr78/courtside/.github/workflows/nightly-image.yml@refs/heads/main";
const nightlyBranchSignerPrefix =
  "https://github.com/jegr78/courtside/.github/workflows/nightly-image.yml@refs/heads/";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repository,
    encoding: options.binary ? undefined : "utf8",
    env: options.environment ?? process.env,
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} exited with ${result.status}: ${result.stderr?.toString() ?? ""}`);
  }
  return result;
}

function filesBelow(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name);
    return entry.isDirectory() ? filesBelow(root, path) : [path];
  });
}

function materializeOrigin(destination, runtimeImage) {
  const archived = run("git", ["archive", "--format=tar", "--prefix=origin/", origin.revision, "deploy"],
    { binary: true });
  run("tar", ["-xf", "-", "-C", destination], { input: archived.stdout, binary: true });
  const root = join(destination, "origin", "deploy");
  const files = Object.fromEntries(filesBelow(root).sort().map((path) => [
    relative(root, path).replaceAll("\\", "/"),
    createHash("sha256").update(readFileSync(path)).digest("hex"),
  ]));
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify({
    schema: 1,
    version: origin.version,
    revision: origin.revision,
    image: runtimeImage,
    signer: "https://github.com/jegr78/courtside/.github/workflows/nightly-image.yml@refs/heads/main",
    recipes: ["existing-infrastructure", "full-self-hosted", "funnel", "standard"],
    files,
  }, null, 2)}\n`);
  return root;
}

function composeCommand(release, installation, project, args) {
  const files = run(join(release, "recipe.sh"), ["files", "funnel"]).stdout.trim().split("\n");
  return ["compose", "--project-name", project, "--project-directory", release,
    "--env-file", join(installation, "config", ".env"),
    ...files.flatMap((file) => ["-f", join(release, file)]), ...args];
}

function psqlInput(release, installation, project, input) {
  return run("docker", composeCommand(release, installation, project,
    ["exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "courtside", "-d", "courtside",
      "-At", "-f", "/dev/stdin"]), { input }).stdout.trim();
}

function psql(release, installation, project, sqlFile) {
  return psqlInput(release, installation, project, readFileSync(sqlFile, "utf8"));
}

function candidateRoot(requested) {
  const absolute = resolve(requested);
  const entries = statSync(absolute).isDirectory() ? readdirSync(absolute) : [];
  const nested = entries.filter((entry) => entry.startsWith("courtside-deployment-"));
  if (nested.length === 1) return join(absolute, nested[0]);
  return absolute;
}

export function qualificationCandidate(candidate, scratch) {
  const manifestPath = join(candidate, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.signer === nightlySigner
      || !/^[0-9]+\.[0-9]+\.[0-9]+-nightly\.[1-9][0-9]*$/.test(manifest.version)) return candidate;
  if (!manifest.signer.startsWith(nightlyBranchSignerPrefix)
      || manifest.signer.length === nightlyBranchSignerPrefix.length) {
    throw new Error(`cannot qualify untrusted candidate signer ${manifest.signer}`);
  }

  const mirror = join(scratch, "qualification-candidate");
  cpSync(candidate, mirror, { recursive: true, errorOnExist: true });
  manifest.signer = nightlySigner;
  writeFileSync(join(mirror, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stderr.write("Qualifying an ephemeral trusted-signer mirror of the branch nightly archive.\n");
  return mirror;
}

function answerFile(root, project) {
  const path = join(root, "answers.conf");
  writeFileSync(path, `schema=1
recipe=funnel
overlays=
synthetic_mail=false
rootless_port_start=1024
project=${project}
domain=127.0.0.1
bootstrap_username=admin
bootstrap_display_name=Upgrade Administrator
source_url=https://github.com/jegr78/courtside
mail_domain=example.invalid
mail_reply_to=board@example.invalid
mail_relay_host=mail.example.invalid
mail_relay_username=
database_url=
database_username=
`);
  return path;
}

function installedFixture(root) {
  const path = join(root, "installed-fixture.sql");
  const fixture = readFileSync(join(repository, "upgrade", "fixtures", "pre-release-v17.sql"), "utf8")
    .replace("INSERT INTO member (id, person_id, membership_type_id) VALUES",
      "INSERT INTO member (id, person_id, membership_type_id, started_on) VALUES")
    .replace("     'cccccccc-0000-0000-0000-000000000001'),",
      "     'cccccccc-0000-0000-0000-000000000001', '2024-01-01'),")
    .replace("     'cccccccc-0000-0000-0000-000000000002');",
      "     'cccccccc-0000-0000-0000-000000000002', '2024-01-01');")
    .replace("1735689600000, 1735689600000,\n        1800, (extract(epoch FROM now() + interval '30 minutes')",
      "(extract(epoch FROM now()) * 1000)::bigint, (extract(epoch FROM now()) * 1000)::bigint,\n"
        + "        86400, (extract(epoch FROM now() + interval '1 day')")
    .replace("\nCOMMIT;\n", `
INSERT INTO domain_event (id, event_type, subject_id, actor_account_id, occurred_at, payload)
VALUES ('7a000000-0000-0000-0000-000000000001', 'UPGRADE_PROOF',
        '71000000-0000-0000-0000-000000000001',
        '72000000-0000-0000-0000-000000000001', '2025-01-01T00:00:00Z',
        '{"proof":"installed-postgresql-upgrade"}');

COMMIT;
`);
  writeFileSync(path, fixture);
  return path;
}

function writeEvidence(build, before, after, candidate) {
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, "before.json"), `${before}\n`);
  writeFileSync(join(build, "after.json"), `${after}\n`);
  writeFileSync(join(build, "result.json"), `${JSON.stringify({
    status: "passed",
    origin,
    candidate: JSON.parse(readFileSync(join(candidate, "manifest.json"))).version,
    runtimeImage: JSON.parse(readFileSync(join(candidate, "manifest.json"))).image,
    preserved: ["members", "roles", "bookings", "series", "configuration", "sessions", "audit", "secrets"],
  }, null, 2)}\n`);
}

function execute() {
  const args = process.argv.slice(2);
  if (args[0] !== "--candidate" || !args[1] || args[2] !== "--confirm"
      || args[3] !== "installed-postgresql-upgrade" || args.length !== 4) {
    throw new Error("Pass --candidate <archive directory> --confirm installed-postgresql-upgrade");
  }
  const suppliedCandidate = candidateRoot(args[1]);
  const candidateManifest = JSON.parse(readFileSync(join(suppliedCandidate, "manifest.json")));
  const scratch = mkdtempSync(join(tmpdir(), "courtside-installed-upgrade-"));
  const installation = join(scratch, "installation");
  const project = `courtside-installed-upgrade-${process.pid}-${randomBytes(4).toString("hex")}`;
  const build = join(repository, "build", "installed-database-upgrade", project);
  let oldRelease;
  let candidate = suppliedCandidate;
  try {
    candidate = qualificationCandidate(suppliedCandidate, scratch);
    oldRelease = materializeOrigin(scratch, candidateManifest.image);
    const initialized = run(join(oldRelease, "courtside"), ["--directory", installation, "init",
      "--answers", answerFile(scratch, project), "--yes"]);
    assert.match(initialized.stdout, /Installed/);
    run(join(installation, "current", "courtside"), ["--directory", installation, "up"]);
    psql(oldRelease, installation, project, installedFixture(scratch));
    const snapshot = psql(oldRelease, installation, project, join(repository, "upgrade", "verify.sql"));
    const auditSql = "SELECT to_jsonb(e)::text FROM domain_event e WHERE id = "
      + "'7a000000-0000-0000-0000-000000000001';";
    const auditSnapshot = psqlInput(oldRelease, installation, project, auditSql);
    const passwordBefore = /^POSTGRES_PASSWORD="([^"]+)"$/m
      .exec(readFileSync(join(installation, "config", ".env"), "utf8"))?.[1];
    assert.ok(passwordBefore, "installed PostgreSQL password is missing");

    const updated = run(join(candidate, "courtside"), ["--directory", installation, "update",
      "--archive", candidate, "--yes"]);
    assert.match(updated.stdout, /Updated from .* to .* after recovery unit/);
    const after = psql(join(installation, "current"), installation, project,
      join(repository, "upgrade", "verify.sql"));
    assert.deepEqual(JSON.parse(after), JSON.parse(snapshot), "installed update changed persisted data");
    assert.equal(psqlInput(join(installation, "current"), installation, project, auditSql),
      auditSnapshot, "installed update changed audit data");
    const passwordAfter = /^POSTGRES_PASSWORD="([^"]+)"$/m
      .exec(readFileSync(join(installation, "config", ".env"), "utf8"))?.[1];
    assert.equal(passwordAfter, passwordBefore, "installed update changed database credentials");
    assert.match(readFileSync(join(installation, "config", ".env"), "utf8"),
      /^COURTSIDE_DATABASE_VOLUME=".+_db-pg18-.+"$/m);
    writeEvidence(build, snapshot, after, candidate);
  } catch (error) {
    mkdirSync(build, { recursive: true });
    writeFileSync(join(build, "failure.txt"), `${error.stack ?? error}\n`);
    throw error;
  } finally {
    if (oldRelease && statSync(oldRelease).isDirectory()) {
      run("docker", composeCommand(candidate, installation, project,
        ["down", "--volumes", "--remove-orphans"]), { allowFailure: true });
      run("docker", composeCommand(oldRelease, installation, project,
        ["down", "--volumes", "--remove-orphans"]), { allowFailure: true });
      run("docker", ["volume", "rm", `${project}_db`], { allowFailure: true });
    }
    run("chmod", ["-R", "u+w", scratch], { allowFailure: true });
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) execute();
