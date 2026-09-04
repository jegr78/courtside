import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localRequest, newBootstrapPassword } from "./courtside.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const columnsAddedSinceTheFixture = [
  { table: "member", column: "started_on", value: "DATE '2026-01-01'" }
];
export const applicationStateTables = [
  "booking", "booking_card", "club_config", "court", "court_allocation", "domain_event", "event_publication",
  "message_record", "opening_hours", "person", "spring_session", "user_account", "user_account_role"
];

function seedWithLaterColumns(fixture) {
  const lend = columnsAddedSinceTheFixture
    .map(({ table, column, value }) => `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${value};`);
  const withdraw = columnsAddedSinceTheFixture
    .map(({ table, column }) => `ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT;`);
  return [...lend, fixture, ...withdraw].join("\n");
}

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

function createMailCertificate(directory) {
  const key = join(directory, "key.pem");
  run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=mail", "-addext", "subjectAltName=DNS:mail",
    "-keyout", key, "-out", join(directory, "cert.pem")]);
  chmodSync(key, 0o644);
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

function mutationHeaders(jar, headers = {}) {
  return { "X-XSRF-TOKEN": decodeURIComponent(jar.get("XSRF-TOKEN")), ...headers };
}

async function expectJson(jar, port, options, expectedStatus) {
  const response = await request(jar, port, options);
  assert.equal(response.statusCode, expectedStatus, response.body);
  return JSON.parse(response.body);
}

async function logIn(jar, port, password) {
  const session = await request(jar, port, { path: "/api/session" });
  assert.equal(session.statusCode, 200, session.body);
  const login = await request(jar, port, {
    path: "/api/session", method: "POST",
    headers: mutationHeaders(jar, { "Content-Type": "application/x-www-form-urlencoded" }),
    body: `username=admin&password=${encodeURIComponent(password)}`
  });
  assert.equal(login.statusCode, 200, login.body);
}

function logoUpload(jar) {
  const boundary = `courtside-${randomBytes(8).toString("hex")}`;
  const logo = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="club.png"\r\n`
      + "Content-Type: image/png\r\n\r\n"),
    logo,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  return {
    body,
    headers: mutationHeaders(jar, {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length)
    })
  };
}

async function populateThroughApplication(password, permanentPassword, port) {
  const jar = new Map();
  await logIn(jar, port, password);
  const changed = await request(jar, port, {
    path: "/api/account/initial-password", method: "PUT",
    headers: mutationHeaders(jar, { "Content-Type": "application/json" }),
    body: JSON.stringify({ password: permanentPassword })
  });
  assert.equal(changed.statusCode, 204, changed.body);
  jar.clear();
  await logIn(jar, port, permanentPassword);

  const court = await expectJson(jar, port, {
    path: "/api/admin/courts", method: "POST",
    headers: mutationHeaders(jar, { "Content-Type": "application/json" }),
    body: JSON.stringify({ number: 2, name: "Application court" })
  }, 201);
  const card = await expectJson(jar, port, {
    path: "/api/admin/booking-cards", method: "POST",
    headers: mutationHeaders(jar, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      label: "Application booking", color: "#34584A", allowedRoles: ["ADMIN"], managingRoles: ["ADMIN"],
      allowedPlayerCounts: [], countsAgainstLimits: false, guestAllowed: false, showGenericOccupancy: false
    })
  }, 201);
  await expectJson(jar, port, {
    path: "/api/admin/opening-hours", method: "PUT",
    headers: mutationHeaders(jar, { "Content-Type": "application/json" }),
    body: JSON.stringify({ days: [
      "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"
    ].map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "23:30" })) })
  }, 200);
  const upload = logoUpload(jar);
  const configuration = await expectJson(jar, port, {
    path: "/api/admin/config/logo", method: "PUT", headers: upload.headers, body: upload.body
  }, 200);

  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 2);
  startsAt.setUTCHours(12, 0, 0, 0);
  const booking = await expectJson(jar, port, {
    path: "/api/bookings", method: "POST",
    headers: mutationHeaders(jar, {
      "Content-Type": "application/json", "Idempotency-Key": "application-restore-write"
    }),
    body: JSON.stringify({
      courtIds: [court.id], cardId: card.id, startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(), participants: []
    })
  }, 201);
  return { bookingId: booking.id, logoDigest: configuration.logoUrl.split("v=")[1] };
}

function applicationEvidence(project, environment) {
  const output = psql(project, environment, ["-Atc", `SELECT jsonb_build_object(
    'tables', jsonb_build_object(
      'booking', jsonb_build_object('rows', (SELECT count(*) FROM booking)),
      'booking_card', jsonb_build_object('rows', (SELECT count(*) FROM booking_card)),
      'club_config', jsonb_build_object('rows', (SELECT count(*) FROM club_config),
        'logoBytes', (SELECT octet_length(logo_content) FROM club_config),
        'logoDigest', (SELECT logo_digest FROM club_config)),
      'court', jsonb_build_object('rows', (SELECT count(*) FROM court)),
      'court_allocation', jsonb_build_object('rows', (SELECT count(*) FROM court_allocation)),
      'domain_event', jsonb_build_object('rows', (SELECT count(*) FROM domain_event)),
      'event_publication', jsonb_build_object('rows', (SELECT count(*) FROM event_publication)),
      'message_record', jsonb_build_object('rows', (SELECT count(*) FROM message_record),
        'highestSequence', (SELECT max(queued_seq) FROM message_record)),
      'opening_hours', jsonb_build_object('rows', (SELECT count(*) FROM opening_hours)),
      'person', jsonb_build_object('rows', (SELECT count(*) FROM person)),
      'spring_session', jsonb_build_object('rows', (SELECT count(*) FROM spring_session),
        'principals', (SELECT jsonb_agg(principal_name ORDER BY principal_name) FROM spring_session)),
      'user_account', jsonb_build_object('rows', (SELECT count(*) FROM user_account)),
      'user_account_role', jsonb_build_object('rows', (SELECT count(*) FROM user_account_role))
    ),
    'sequences', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', sequencename, 'lastValue', last_value) ORDER BY sequencename), '[]'::jsonb)
      FROM pg_sequences WHERE schemaname = 'public'))`]).stdout.trim();
  return JSON.parse(output);
}

async function waitForApplicationWrites(project, environment) {
  let observed;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    observed = JSON.parse(psql(project, environment, ["-Atc", `SELECT jsonb_build_object(
      'booking', (SELECT count(*) FROM booking),
      'domainEvent', (SELECT count(*) FROM domain_event),
      'eventPublication', (SELECT count(*) FROM event_publication),
      'settledMessage', (SELECT count(*) FROM message_record WHERE state <> 'QUEUED'),
      'session', (SELECT count(*) FROM spring_session),
      'storedLogo', (SELECT count(*) FROM club_config WHERE logo_content IS NOT NULL))`]).stdout.trim());
    const written = Object.entries(observed)
      .filter(([name]) => name !== "eventPublication")
      .every(([, count]) => count > 0);
    if (written) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Application writes did not settle: ${JSON.stringify(observed)}`);
}

async function verifyRestoredApplication(password, port, { bookingId, logoDigest }) {
  const logo = await request(new Map(), port, { path: `/api/public/config/logo?v=${logoDigest}` });
  assert.equal(logo.statusCode, 200, logo.body);
  assert.equal(logo.headers["content-type"], "image/png");
  const jar = new Map();
  await logIn(jar, port, password);
  const bookings = await request(jar, port, { path: "/api/my/bookings" });
  assert.equal(bookings.statusCode, 200, bookings.body);
  assert.match(bookings.body, new RegExp(bookingId));
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

async function proveInterruptedRestore(project, environment, dump, before, evidence = databaseEvidence) {
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
    assert.deepEqual(evidence(project, environment), before,
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
  const privateDirectory = mkdtempSync(join(tmpdir(), "courtside-restore-"));
  const mailCertificateDirectory = mkdtempSync(join(tmpdir(), "courtside-restore-mail-"));
  const applicationDumpPath = join(privateDirectory, "application.dump");
  const legacyDumpPath = join(privateDirectory, "legacy.dump");
  const password = newBootstrapPassword();
  const permanentPassword = newBootstrapPassword();
  createMailCertificate(mailCertificateDirectory);
  const environment = {
    COURTSIDE_RESTORE_IMAGE: image,
    COURTSIDE_RESTORE_ADMIN_PASSWORD: password,
    COURTSIDE_RESTORE_MAIL_CERT_DIR: mailCertificateDirectory
  };
  const startedAt = Date.now();
  mkdirSync(build, { recursive: true });

  try {
    compose(project, environment, ["down", "--volumes", "--remove-orphans"], { allowFailure: true });
    compose(project, environment, ["up", "-d", "--wait"]);
    const applicationIdentity = await populateThroughApplication(
      password, permanentPassword, publishedPort(project, environment));
    await waitForApplicationWrites(project, environment);
    compose(project, environment, ["stop", "app"]);
    const applicationBefore = applicationEvidence(project, environment);
    assert.deepEqual(Object.keys(applicationBefore.tables).sort(), applicationStateTables,
      "application evidence does not name the required tables");
    writeFileSync(join(build, "application-before.json"), `${JSON.stringify(applicationBefore, null, 2)}\n`);
    const applicationDump = compose(project, environment,
      ["exec", "-T", "db", "pg_dump", "-Fc", "--no-owner", "-U", "courtside", "courtside"],
    { binary: true }).stdout;
    writeFileSync(applicationDumpPath, applicationDump, { mode: 0o600 });
    const imageId = run("docker", ["image", "inspect", "--format", "{{.Id}}", image]).stdout.trim();

    compose(project, environment, ["down", "--volumes", "--remove-orphans"]);
    compose(project, environment, ["up", "-d", "--wait", "db"]);
    const corrupt = applicationDump.subarray(0, Math.max(1, Math.floor(applicationDump.length / 2)));
    const rejected = restore(project, environment, corrupt, true);
    assert.notEqual(rejected.status, 0, "corrupt archive unexpectedly restored");
    const objects = psql(project, environment,
      ["-Atc", "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"]).stdout.trim();
    assert.equal(objects, "0", "corrupt restore left database objects behind");

    restore(project, environment, applicationDump);
    const applicationAfter = applicationEvidence(project, environment);
    writeFileSync(join(build, "application-after.json"), `${JSON.stringify(applicationAfter, null, 2)}\n`);
    assert.deepEqual(applicationAfter, applicationBefore,
      "restored application database differs from its backup source");
    await proveInterruptedRestore(
      project, environment, applicationDump, applicationAfter, applicationEvidence);
    compose(project, environment, ["up", "-d", "--wait", "app"]);
    await verifyRestoredApplication(
      permanentPassword, publishedPort(project, environment), applicationIdentity);

    compose(project, environment, ["down", "--volumes", "--remove-orphans"]);
    compose(project, environment, ["up", "-d", "--wait"]);
    psql(project, environment, ["-f", "/dev/stdin"], {
      input: seedWithLaterColumns(
        readFileSync(join(root, "upgrade", "fixtures", "pre-release-v17.sql"), "utf8"))
    });
    const before = databaseEvidence(project, environment);
    writeFileSync(join(build, "before.json"), `${JSON.stringify(before, null, 2)}\n`);
    const dump = compose(project, environment,
      ["exec", "-T", "db", "pg_dump", "-Fc", "--no-owner", "-U", "courtside", "courtside"], { binary: true }).stdout;
    writeFileSync(legacyDumpPath, dump, { mode: 0o600 });

    compose(project, environment, ["down", "--volumes", "--remove-orphans"]);
    compose(project, environment, ["up", "-d", "--wait", "db"]);
    restore(project, environment, dump);
    const after = databaseEvidence(project, environment);
    writeFileSync(join(build, "after.json"), `${JSON.stringify(after, null, 2)}\n`);
    assert.deepEqual(after, before, "restored database differs from its backup source");
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
      applicationStateTables,
      applicationBackupBytes: statSync(applicationDumpPath).size,
      legacyBackupBytes: statSync(legacyDumpPath).size,
      durationMillis: Date.now() - startedAt
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
    rmSync(privateDirectory, { recursive: true, force: true });
    rmSync(mailCertificateDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await execute();
