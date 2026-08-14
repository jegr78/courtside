import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localRequest, newBootstrapPassword } from "./courtside.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const composeFile = join(root, "deploy", "compose.restore.yaml");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: options.binary ? null : "utf8",
    env: options.environment ?? process.env,
    input: options.input,
    maxBuffer: 128 * 1024 * 1024,
    stdio: options.inherit ? "inherit" : "pipe"
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} exited with status ${result.status}: ${result.stderr?.toString() ?? ""}`);
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

function databaseEvidence(project, environment) {
  const content = psql(project, environment, ["-At", "-f", "/dev/stdin"], {
    input: readFileSync(join(root, "upgrade", "verify.sql"), "utf8")
  }).stdout.trim();
  const structure = psql(project, environment, ["-Atc", `SELECT jsonb_build_object(
    'schemaVersion', (SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1),
    'extensions', (SELECT jsonb_agg(extname ORDER BY extname) FROM pg_extension),
    'tableOwners', (SELECT jsonb_agg(tablename || ':' || tableowner ORDER BY tablename)
                    FROM pg_tables WHERE schemaname = 'public'),
    'constraints', (SELECT count(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace),
    'sequences', (SELECT count(*) FROM pg_sequences WHERE schemaname = 'public'))`]).stdout.trim();
  return { content: JSON.parse(content), structure: JSON.parse(structure) };
}

function publishedPort(project, environment) {
  const output = compose(project, environment, ["port", "app", "8080"]).stdout.trim();
  const match = /:(\d+)$/.exec(output);
  if (!match) throw new Error(`Could not resolve the application port from: ${output}`);
  return Number(match[1]);
}

function cookiesFrom(response, jar) {
  for (const cookie of response.headers["set-cookie"] ?? []) {
    const [pair] = cookie.split(";", 1);
    const separator = pair.indexOf("=");
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function request(jar, port, options) {
  const headers = { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "), ...options.headers };
  const response = await localRequest({ secure: false, port, ...options, headers });
  cookiesFrom(response, jar);
  return response;
}

async function verifyApplication(password, port) {
  const jar = new Map();
  const session = await request(jar, port, { path: "/api/session" });
  assert.equal(session.statusCode, 200, session.body);
  const login = await request(jar, port, {
    path: "/api/session", method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-XSRF-TOKEN": decodeURIComponent(jar.get("XSRF-TOKEN"))
    },
    body: `username=upgrade-member&password=${encodeURIComponent(password)}`
  });
  assert.equal(login.statusCode, 200, login.body);
  const bookings = await request(jar, port, { path: "/api/my/bookings" });
  assert.equal(bookings.statusCode, 200, bookings.body);
  assert.match(bookings.body, /77000000-0000-0000-0000-000000000001/);
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 2);
  startsAt.setUTCHours(12, 0, 0, 0);
  const created = await request(jar, port, {
    path: "/api/bookings", method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "restore-verification-write",
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

function restore(project, environment, archive, allowFailure = false) {
  return compose(project, environment, ["exec", "-T", "db", "pg_restore", "--clean", "--if-exists",
    "--no-owner", "--single-transaction", "--exit-on-error", "-U", "courtside", "-d", "courtside"],
  { input: archive, allowFailure });
}

async function waitForDatabase(project, environment, sql, expected) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (psql(project, environment, ["-Atc", sql]).stdout.trim() === expected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Database did not expose the interrupted restore state");
}

async function proveInterruptedRestore(project, environment, dump, before) {
  const composeArgs = ["compose", "-p", project, "-f", composeFile, "exec", "-T"];
  const childEnvironment = { ...process.env, ...environment };
  const lockHolder = spawn("docker", [...composeArgs, "-e", "PGAPPNAME=restore-lock-holder", "db", "psql",
    "-v", "ON_ERROR_STOP=1", "-U", "courtside", "-d", "courtside", "-c",
    "BEGIN; LOCK TABLE court IN ACCESS SHARE MODE; SELECT pg_sleep(300)"],
  { cwd: root, env: childEnvironment, stdio: "ignore" });
  let interrupted;
  try {
    await waitForDatabase(project, environment,
      "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'restore-lock-holder' AND state = 'active'", "1");
    interrupted = spawn("docker", [...composeArgs, "-e", "PGAPPNAME=interrupted-restore", "db", "pg_restore",
      "--clean", "--if-exists", "--no-owner", "--single-transaction", "--exit-on-error",
      "-U", "courtside", "-d", "courtside"], { cwd: root, env: childEnvironment, stdio: ["pipe", "ignore", "ignore"] });
    interrupted.stdin.end(dump);
    await waitForDatabase(project, environment,
      "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'interrupted-restore' AND wait_event_type = 'Lock'", "1");
    const interruptedExit = once(interrupted, "exit");
    interrupted.kill("SIGTERM");
    psql(project, environment, ["-Atc",
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'interrupted-restore'"]);
    await interruptedExit;
    psql(project, environment, ["-Atc",
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'restore-lock-holder'"]);
    assert.deepEqual(databaseEvidence(project, environment), before,
      "interrupted restore changed the usable database");
  } finally {
    if (interrupted && !interrupted.killed) interrupted.kill("SIGTERM");
    if (!lockHolder.killed) lockHolder.kill("SIGTERM");
  }
}

async function execute() {
  if (process.argv.slice(2).join(" ") !== "--confirm courtside-restore") {
    throw new Error("Restore qualification is destructive; pass --confirm courtside-restore");
  }
  const image = process.env.COURTSIDE_RESTORE_IMAGE;
  if (!image) throw new Error("COURTSIDE_RESTORE_IMAGE is required");
  const runId = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const project = `courtside-restore-${runId}`;
  const build = join(root, "build", "database-restore", runId);
  const password = newBootstrapPassword();
  const environment = { COURTSIDE_RESTORE_IMAGE: image, COURTSIDE_RESTORE_ADMIN_PASSWORD: password };
  const startedAt = Date.now();
  mkdirSync(build, { recursive: true });

  try {
    compose(project, environment, ["down", "--volumes", "--remove-orphans"], { allowFailure: true });
    compose(project, environment, ["up", "-d", "--wait"]);
    psql(project, environment, ["-f", "/dev/stdin"], {
      input: readFileSync(join(root, "upgrade", "fixtures", "pre-release-v17.sql"), "utf8")
    });
    const before = databaseEvidence(project, environment);
    writeFileSync(join(build, "before.json"), `${JSON.stringify(before, null, 2)}\n`);
    const dump = compose(project, environment,
      ["exec", "-T", "db", "pg_dump", "-Fc", "--no-owner", "-U", "courtside", "courtside"], { binary: true }).stdout;
    writeFileSync(join(build, "courtside.dump"), dump, { mode: 0o600 });
    const imageId = run("docker", ["image", "inspect", "--format", "{{.Id}}", image]).stdout.trim();

    compose(project, environment, ["down", "--volumes", "--remove-orphans"]);
    compose(project, environment, ["up", "-d", "--wait", "db"]);
    const corrupt = dump.subarray(0, Math.max(1, Math.floor(dump.length / 2)));
    const rejected = restore(project, environment, corrupt, true);
    assert.notEqual(rejected.status, 0, "corrupt archive unexpectedly restored");
    const objects = psql(project, environment,
      ["-Atc", "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"]).stdout.trim();
    assert.equal(objects, "0", "corrupt restore left database objects behind");

    restore(project, environment, dump);
    const after = databaseEvidence(project, environment);
    writeFileSync(join(build, "after.json"), `${JSON.stringify(after, null, 2)}\n`);
    assert.deepEqual(after, before, "restored database differs from its backup source");
    await proveInterruptedRestore(project, environment, dump, after);
    compose(project, environment, ["up", "-d", "--wait", "app"]);
    await verifyApplication(password, publishedPort(project, environment));
    const overlap = psql(project, environment, ["-c", `INSERT INTO court_allocation
      (id, booking_id, court_id, starts_at, ends_at, status) VALUES
      ('78000000-0000-0000-0000-000000000099', '77000000-0000-0000-0000-000000000001',
       '70000000-0000-0000-0000-000000000001', '2025-01-05T09:30:00Z', '2025-01-05T10:30:00Z', 'CONFIRMED')`],
    { allowFailure: true });
    assert.notEqual(overlap.status, 0, "restored overlap constraint accepted conflicting data");
    const result = {
      status: "passed", image, imageId, schemaVersion: after.structure.schemaVersion,
      backupBytes: statSync(join(build, "courtside.dump")).size, durationMillis: Date.now() - startedAt
    };
    writeFileSync(join(build, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const logs = compose(project, environment, ["logs", "--no-color"], { allowFailure: true });
    writeFileSync(join(build, "container-logs.txt"), `${logs.stdout}${logs.stderr}`);
    writeFileSync(join(build, "recovery.txt"),
      "Keep the application stopped and restore the complete archive with its matching Courtside image and configuration.\n");
    throw error;
  } finally {
    compose(project, environment, ["down", "--volumes", "--remove-orphans"], { allowFailure: true });
    rmSync(join(build, "courtside.dump"), { force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await execute();
