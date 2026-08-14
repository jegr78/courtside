import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localRequest, newBootstrapPassword } from "./courtside.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const composeFile = join(root, "deploy", "compose.upgrade.yaml");

function parseVersion(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return match && { tag, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function selectUpgradeOrigins(candidateTag, tags) {
  const candidate = parseVersion(candidateTag);
  if (!candidate) throw new Error(`Candidate tag is not stable semantic version: ${candidateTag}`);
  const versions = tags.map(parseVersion).filter(Boolean)
    .filter((version) => version.major === candidate.major)
    .filter((version) => version.minor < candidate.minor
      || (version.minor === candidate.minor && version.patch < candidate.patch))
    .sort((left, right) => right.minor - left.minor || right.patch - left.patch);
  if (versions.length === 0) return ["pre-release-v17"];
  const patch = versions.find((version) => version.minor === candidate.minor);
  const minor = versions.find((version) => version.minor < candidate.minor);
  return [...new Set([patch?.tag, minor?.tag].filter(Boolean))];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: options.environment ?? process.env,
    input: options.input,
    stdio: options.inherit ? "inherit" : "pipe"
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} exited with status ${result.status}: ${result.stderr ?? ""}`);
  }
  return result;
}

function compose(project, environment, args, options = {}) {
  return run("docker", ["compose", "-p", project, "-f", composeFile, ...args], {
    ...options, environment: { ...process.env, ...environment }
  });
}

function psql(project, environment, args, options = {}) {
  return compose(project, environment,
    ["exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "courtside", "-d", "courtside", ...args], options);
}

function scalar(project, environment, sql) {
  return psql(project, environment, ["-Atc", sql]).stdout.trim();
}

async function waitForDatabase(project, environment, sql, expected, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (scalar(project, environment, sql) === expected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Database did not expose ${label}`);
}

async function proveInterruptedStartup(project, originEnvironment, candidateEnvironment, before, originVersion, build) {
  compose(project, originEnvironment, ["stop", "app"]);
  const lockHolder = spawn("docker", ["compose", "-p", project, "-f", composeFile,
    "exec", "-T", "-e", "PGAPPNAME=upgrade-lock-holder", "db", "psql", "-v", "ON_ERROR_STOP=1",
    "-U", "courtside", "-d", "courtside", "-c",
    "BEGIN; LOCK TABLE flyway_schema_history IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(300)"],
  { cwd: root, env: { ...process.env, ...originEnvironment }, stdio: "ignore" });
  try {
    await waitForDatabase(project, originEnvironment,
      "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'upgrade-lock-holder' AND state = 'active'",
      "1", "the migration lock holder");
    compose(project, candidateEnvironment, ["up", "-d", "--force-recreate", "app"]);
    await waitForDatabase(project, candidateEnvironment,
      "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND application_name <> 'upgrade-lock-holder'",
      "1", "the candidate waiting for Flyway's history lock");
    await assert.rejects(localRequest({ secure: false, port: 8084, path: "/api/session" }));
    compose(project, candidateEnvironment, ["stop", "app"]);
    psql(project, candidateEnvironment,
      ["-Atc", "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'upgrade-lock-holder'"]);
    const version = scalar(project, candidateEnvironment,
      "SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1");
    const afterInterruption = psql(project, candidateEnvironment, ["-At", "-f", "/dev/stdin"], {
      input: readFileSync(join(root, "upgrade", "verify.sql"), "utf8")
    }).stdout.trim();
    assert.equal(version, originVersion, "interrupted startup changed the schema version");
    assert.equal(afterInterruption, before, "interrupted startup changed fixture data");
    writeFileSync(join(build, "interrupted-startup.json"),
      `${JSON.stringify({ status: "passed", schemaVersion: version, trafficAccepted: false }, null, 2)}\n`);
  } finally {
    if (!lockHolder.killed) lockHolder.kill("SIGTERM");
  }
}

function cookiesFrom(response, jar) {
  for (const cookie of response.headers["set-cookie"] ?? []) {
    const [pair] = cookie.split(";", 1);
    const separator = pair.indexOf("=");
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function request(jar, options) {
  const headers = { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "), ...options.headers };
  const response = await localRequest({ secure: false, port: 8084, ...options, headers });
  cookiesFrom(response, jar);
  return response;
}

async function verifyApplication(password) {
  const jar = new Map();
  const session = await request(jar, { path: "/api/session" });
  assert.equal(session.statusCode, 200, session.body);
  const token = decodeURIComponent(jar.get("XSRF-TOKEN"));
  const login = await request(jar, {
    path: "/api/session", method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-XSRF-TOKEN": token },
    body: `username=upgrade-member&password=${encodeURIComponent(password)}`
  });
  assert.equal(login.statusCode, 200, login.body);
  const courts = await request(jar, { path: "/api/public/courts" });
  assert.equal(courts.statusCode, 200, courts.body);
  assert.ok(JSON.parse(courts.body).some((court) => court.name === "Upgrade court"));
  const bookings = await request(jar, { path: "/api/my/bookings" });
  assert.equal(bookings.statusCode, 200, bookings.body);
  assert.match(bookings.body, /77000000-0000-0000-0000-000000000001/);

  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 2);
  startsAt.setUTCHours(10, 0, 0, 0);
  const created = await request(jar, {
    path: "/api/bookings", method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "upgrade-verification-write",
      "X-XSRF-TOKEN": decodeURIComponent(jar.get("XSRF-TOKEN"))
    },
    body: JSON.stringify({
      courtIds: ["70000000-0000-0000-0000-000000000001"],
      cardId: "11111111-1111-1111-1111-111111111111",
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      participants: [{ guestName: "Richard Miles" }]
    })
  });
  assert.equal(created.statusCode, 201, created.body);
}

function fixtureFor(origin, build) {
  const destination = join(build, "fixture.sql");
  if (origin === "pre-release-v17") {
    writeFileSync(destination, readFileSync(join(root, "upgrade", "fixtures", "pre-release-v17.sql")));
  } else {
    const fixture = run("git", ["show", `${origin}:upgrade/fixtures/pre-release-v17.sql`]);
    if (fixture.status !== 0) throw new Error(`Release ${origin} does not own an upgrade fixture`);
    writeFileSync(destination, fixture.stdout);
  }
  return destination;
}

async function executeUpgrade() {
  const args = process.argv.slice(2);
  if (args.join(" ") !== "--confirm courtside-upgrade") {
    throw new Error("Upgrade testing is destructive; pass --confirm courtside-upgrade");
  }
  const candidate = process.env.COURTSIDE_UPGRADE_CANDIDATE_IMAGE;
  const origin = process.env.COURTSIDE_UPGRADE_ORIGIN;
  if (!candidate || !origin) throw new Error("Candidate image and upgrade origin are required");

  const suffix = origin.replaceAll(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  const project = `courtside-upgrade-${suffix}`;
  const build = join(root, "build", "database-upgrade", suffix);
  const password = newBootstrapPassword();
  mkdirSync(build, { recursive: true });
  const fixture = fixtureFor(origin, build);
  const baseEnvironment = { COURTSIDE_UPGRADE_ADMIN_PASSWORD: password };
  let originImage = candidate;
  if (origin !== "pre-release-v17") {
    const originTag = `ghcr.io/${process.env.GITHUB_REPOSITORY}:${origin.slice(1)}`;
    run("docker", ["pull", originTag], { inherit: true });
    originImage = run("docker", ["image", "inspect", "--format", "{{index .RepoDigests 0}}", originTag]).stdout.trim();
    if (!originImage.includes("@sha256:")) throw new Error(`Release ${origin} did not resolve to an image digest`);
  }
  writeFileSync(join(build, "origin-image.txt"), `${originImage}\n`);
  const originEnvironment = {
    ...baseEnvironment,
    COURTSIDE_UPGRADE_IMAGE: originImage,
    COURTSIDE_UPGRADE_FLYWAY_TARGET: origin === "pre-release-v17" ? "17" : "latest",
    COURTSIDE_UPGRADE_DDL_MODE: origin === "pre-release-v17" ? "none" : "validate"
  };
  const candidateEnvironment = {
    ...baseEnvironment, COURTSIDE_UPGRADE_IMAGE: candidate, COURTSIDE_UPGRADE_FLYWAY_TARGET: "latest",
    COURTSIDE_UPGRADE_DDL_MODE: "validate"
  };

  try {
    compose(project, originEnvironment, ["down", "--volumes", "--remove-orphans"], { allowFailure: true });
    compose(project, originEnvironment, ["up", "-d", "--wait"]);
    psql(project, originEnvironment, ["-f", "/dev/stdin"], {
      environment: originEnvironment,
      input: readFileSync(fixture, "utf8")
    });
    const before = psql(project, originEnvironment, ["-At", "-f", "/dev/stdin"], {
      input: readFileSync(join(root, "upgrade", "verify.sql"), "utf8")
    }).stdout.trim();
    writeFileSync(join(build, "before.json"), `${before}\n`);
    const originVersion = scalar(project, originEnvironment,
      "SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1");

    await proveInterruptedStartup(project, originEnvironment, candidateEnvironment, before, originVersion, build);
    compose(project, candidateEnvironment, ["up", "-d", "--wait", "--force-recreate", "app"]);
    const after = psql(project, candidateEnvironment, ["-At", "-f", "/dev/stdin"], {
      input: readFileSync(join(root, "upgrade", "verify.sql"), "utf8")
    }).stdout.trim();
    writeFileSync(join(build, "after.json"), `${after}\n`);
    assert.equal(after, before, "unexplained data or count change after migration");
    const version = psql(project, candidateEnvironment,
      ["-Atc", "SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1"]).stdout.trim();
    writeFileSync(join(build, "migration-version.txt"), `${version}\n`);
    const transformation = scalar(project, candidateEnvironment, `SELECT count(*) FROM (
      ((SELECT booking_card_id, role FROM booking_card_managing_role)
       EXCEPT
       (SELECT booking_card_id, role FROM booking_card_allowed_role WHERE role <> 'MEMBER'))
      UNION ALL
      ((SELECT booking_card_id, role FROM booking_card_allowed_role WHERE role <> 'MEMBER')
       EXCEPT
       (SELECT booking_card_id, role FROM booking_card_managing_role))
    ) unexpected`);
    assert.equal(transformation, "0", "booking-card managing roles differ from the explicit migration transform");
    writeFileSync(join(build, "expected-transformations.json"),
      `${JSON.stringify({ bookingCardManagingRolesDerivedFromAllowedNonMemberRoles: true }, null, 2)}\n`);
    await verifyApplication(password);

    const overlap = psql(project, candidateEnvironment, ["-c", `INSERT INTO court_allocation
      (id, booking_id, court_id, starts_at, ends_at, status) VALUES
      ('78000000-0000-0000-0000-000000000099', '77000000-0000-0000-0000-000000000001',
       '70000000-0000-0000-0000-000000000001', '2025-01-05T09:30:00Z', '2025-01-05T10:30:00Z', 'CONFIRMED')`],
    { allowFailure: true });
    assert.notEqual(overlap.status, 0, "court overlap constraint accepted conflicting data");
    const logs = compose(project, candidateEnvironment, ["logs", "--no-color"]);
    writeFileSync(join(build, "migration-logs.txt"), `${logs.stdout}${logs.stderr}`);
    writeFileSync(join(build, "result.json"), `${JSON.stringify({ origin, candidate, version, status: "passed" }, null, 2)}\n`);
  } catch (error) {
    const logs = compose(project, candidateEnvironment, ["logs", "--no-color"], { allowFailure: true });
    writeFileSync(join(build, "container-logs.txt"), `${logs.stdout}${logs.stderr}`);
    writeFileSync(join(build, "recovery.txt"), "Restore the pre-upgrade backup; Flyway downgrade is not supported.\n");
    throw error;
  } finally {
    compose(project, candidateEnvironment, ["down", "--volumes", "--remove-orphans"], { allowFailure: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--origins") {
    const tags = run("git", ["tag", "--list", "v*"]).stdout.trim().split("\n").filter(Boolean);
    process.stdout.write(`${JSON.stringify(selectUpgradeOrigins(process.argv[3], tags))}\n`);
  } else {
    await executeUpgrade();
  }
}
