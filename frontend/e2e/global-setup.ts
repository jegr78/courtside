import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readdirSync, rmSync, statSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";

async function waitForApplication(application: ChildProcess, baseURL: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (application.exitCode !== null) {
      throw new Error(`Courtside stopped with exit code ${application.exitCode}`);
    }
    try {
      const response = await fetch(`${baseURL}/actuator/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Courtside did not become ready");
}

async function seedJourneyData(postgres: StartedTestContainer, visualDate: string): Promise<void> {
  const sql = `
    INSERT INTO person (id, first_name, last_name, email)
    VALUES ('00000000-0000-0000-0000-000000000101', 'Jane', 'Doe', 'jane.doe@example.org');
    INSERT INTO user_account
      (id, person_id, username, password_hash, locale, enabled, password_change_required)
    SELECT '00000000-0000-0000-0000-000000000102',
      '00000000-0000-0000-0000-000000000101', 'doe.jane', password_hash, 'en', true, false
    FROM user_account WHERE username = 'bootstrap-admin';
    INSERT INTO user_account_role (user_account_id, role)
    VALUES ('00000000-0000-0000-0000-000000000102', 'MEMBER');
    INSERT INTO person (id, first_name, last_name, email)
    VALUES ('00000000-0000-0000-0000-000000000106', 'Richard', 'Miles', 'richard.miles@example.org');
    INSERT INTO user_account
      (id, person_id, username, password_hash, locale, enabled, password_change_required)
    SELECT '00000000-0000-0000-0000-000000000107',
      '00000000-0000-0000-0000-000000000106', 'configuration-admin', password_hash, 'en', true, false
    FROM user_account WHERE username = 'bootstrap-admin';
    INSERT INTO user_account_role (user_account_id, role)
    VALUES ('00000000-0000-0000-0000-000000000107', 'ADMIN');
    INSERT INTO person (id, first_name, last_name, email) VALUES
      ('00000000-0000-0000-0000-000000000108', 'Mary', 'Major', 'sport.major@example.org'),
      ('00000000-0000-0000-0000-000000000109', 'Richard', 'Miles', 'youth.miles@example.org');
    INSERT INTO user_account
      (id, person_id, username, password_hash, locale, enabled, password_change_required)
    SELECT '00000000-0000-0000-0000-000000000110',
      '00000000-0000-0000-0000-000000000108', 'sport.major', password_hash, 'en', true, false
    FROM user_account WHERE username = 'bootstrap-admin';
    INSERT INTO user_account
      (id, person_id, username, password_hash, locale, enabled, password_change_required)
    SELECT '00000000-0000-0000-0000-000000000111',
      '00000000-0000-0000-0000-000000000109', 'youth.miles', password_hash, 'en', true, false
    FROM user_account WHERE username = 'bootstrap-admin';
    INSERT INTO person (id, first_name, last_name, email)
    VALUES ('00000000-0000-0000-0000-000000000112', 'John', 'Roe', 'keeper.roe@example.org');
    INSERT INTO user_account
      (id, person_id, username, password_hash, locale, enabled, password_change_required)
    SELECT '00000000-0000-0000-0000-000000000113',
      '00000000-0000-0000-0000-000000000112', 'keeper.roe', password_hash, 'en', true, false
    FROM user_account WHERE username = 'bootstrap-admin';
    INSERT INTO user_account_role (user_account_id, role) VALUES
      ('00000000-0000-0000-0000-000000000110', 'SPORT_DIRECTOR'),
      ('00000000-0000-0000-0000-000000000111', 'YOUTH_DIRECTOR'),
      ('00000000-0000-0000-0000-000000000113', 'GROUNDSKEEPER');
    INSERT INTO member (id, person_id, membership_type_id)
    VALUES ('00000000-0000-0000-0000-000000000105',
      '00000000-0000-0000-0000-000000000101', 'cccccccc-0000-0000-0000-000000000001');
    INSERT INTO person (id, first_name, last_name, email)
    VALUES ('00000000-0000-0000-0000-000000000103', 'Mary', 'Major', 'mary.major@example.org');
    INSERT INTO member (id, person_id, membership_type_id)
    VALUES ('00000000-0000-0000-0000-000000000104',
      '00000000-0000-0000-0000-000000000103', 'cccccccc-0000-0000-0000-000000000001');

    INSERT INTO court (id, number, name) VALUES
      ('dddddddd-0000-0000-0000-000000000002', 2, NULL),
      ('dddddddd-0000-0000-0000-000000000003', 3, NULL),
      ('dddddddd-0000-0000-0000-000000000004', 4, NULL);

    INSERT INTO booking_series (id, card_id, starts_on, start_time, duration_minutes, interval_weeks,
      weekdays, occurrence_count, created_by)
    VALUES ('73000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
      DATE '${visualDate}', TIME '09:00', 60, 1, ARRAY[1], 2, '00000000-0000-0000-0000-000000000102');
    INSERT INTO booking_series_court (booking_series_id, court_id, position)
    VALUES ('73000000-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 0);

    INSERT INTO booking (id, card_id, status, booked_by, note) VALUES
      ('70000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'CONFIRMED', '00000000-0000-0000-0000-000000000102', NULL),
      ('70000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'CONFIRMED', (SELECT id FROM user_account WHERE username = 'bootstrap-admin'), NULL),
      ('70000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'CONFIRMED', (SELECT id FROM user_account WHERE username = 'bootstrap-admin'), NULL),
      ('70000000-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333', 'CONFIRMED', (SELECT id FROM user_account WHERE username = 'bootstrap-admin'), 'Prepare score sheets'),
      ('70000000-0000-0000-0000-000000000005', '44444444-4444-4444-4444-444444444444', 'CONFIRMED', (SELECT id FROM user_account WHERE username = 'bootstrap-admin'), NULL),
      ('70000000-0000-0000-0000-000000000006', '33333333-3333-3333-3333-333333333333', 'CONFIRMED', (SELECT id FROM user_account WHERE username = 'bootstrap-admin'), 'Cancellation journey');
    UPDATE booking SET series_id = '73000000-0000-0000-0000-000000000001'
    WHERE id = '70000000-0000-0000-0000-000000000001';

    INSERT INTO booking_participant (id, booking_id, kind, person_id, position) VALUES
      ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'MEMBER', '00000000-0000-0000-0000-000000000101', 0),
      ('71000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'MEMBER', '00000000-0000-0000-0000-000000000103', 1),
      ('71000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 'MEMBER', '00000000-0000-0000-0000-000000000101', 0),
      ('71000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000002', 'MEMBER', '00000000-0000-0000-0000-000000000103', 1);

    INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status) VALUES
      ('72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', (DATE '${visualDate}' + TIME '09:00') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + TIME '10:00') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED'),
      ('72000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000002', (DATE '${visualDate}' + TIME '09:00') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + TIME '10:00') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED'),
      ('72000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000003', (DATE '${visualDate}' + TIME '08:30') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + TIME '10:00') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED'),
      ('72000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000004', (DATE '${visualDate}' + TIME '10:00') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + TIME '12:00') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED'),
      ('72000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-000000000005', 'dddddddd-0000-0000-0000-000000000001', (DATE '${visualDate}' + TIME '10:30') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + TIME '11:30') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED'),
      ('72000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000006', 'dddddddd-0000-0000-0000-000000000004', (DATE '${visualDate}' + 1 + TIME '10:00') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + 1 + TIME '12:00') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED');
  `;
  const result = await postgres.exec([
    "psql", "-U", "courtside", "-d", "courtside", "-v", "ON_ERROR_STOP=1", "-c", sql
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`Could not seed the journey data: ${result.stderr}`);
  }
}

function applicationJar(): string {
  const target = resolve("../target");
  const candidates = readdirSync(target)
    .filter((name) => /^courtside-.+\.jar$/.test(name) && !name.endsWith(".jar.original"))
    .map((name) => ({ path: resolve(target, name), modified: statSync(resolve(target, name)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified);
  if (!candidates[0]) {
    throw new Error("No packaged Courtside application was found");
  }
  return candidates[0].path;
}

export function tomorrowInBerlin(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 1)).toISOString().slice(0, 10);
}

export interface JourneyService {
  baseURL: string;
  visualDate: string;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolveClose, rejectClose) =>
    server.close((error) => error ? rejectClose(error) : resolveClose()));
  return port;
}

async function snapshotJourneyData(postgres: StartedTestContainer): Promise<string[]> {
  const tablesResult = await postgres.exec([
    "psql", "-U", "courtside", "-d", "courtside", "-At", "-c",
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'flyway_schema_history' ORDER BY tablename"
  ]);
  if (tablesResult.exitCode !== 0) {
    throw new Error(`Could not inspect the journey schema: ${tablesResult.stderr}`);
  }
  const tables = tablesResult.stdout.trim().split("\n").filter(Boolean);
  const snapshot = `CREATE SCHEMA journey_baseline; ${tables.map((table) =>
    `CREATE TABLE journey_baseline.${table} AS TABLE public.${table};`).join(" ")}`;
  const snapshotResult = await postgres.exec([
    "psql", "-U", "courtside", "-d", "courtside", "-v", "ON_ERROR_STOP=1", "-c", snapshot
  ]);
  if (snapshotResult.exitCode !== 0) {
    throw new Error(`Could not capture the journey baseline: ${snapshotResult.stderr}`);
  }
  return tables;
}

async function resetJourneyData(postgres: StartedTestContainer, tables: string[]): Promise<void> {
  const sql = `
    TRUNCATE TABLE ${tables.map((table) => `public.${table}`).join(", ")} RESTART IDENTITY CASCADE;
    SET session_replication_role = replica;
    ${tables.map((table) => `INSERT INTO public.${table} SELECT * FROM journey_baseline.${table};`).join(" ")}
    SET session_replication_role = origin;
  `;
  const result = await postgres.exec([
    "psql", "-U", "courtside", "-d", "courtside", "-v", "ON_ERROR_STOP=1", "-c", sql
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`Could not restore the journey baseline: ${result.stderr}`);
  }
}

export async function startJourneyService(): Promise<JourneyService> {
  let postgres: StartedTestContainer | undefined;
  let application: ChildProcess | undefined;
  try {
    const visualDate = tomorrowInBerlin();
    const port = await availableLoopbackPort();
    const baseURL = `http://127.0.0.1:${port}`;
    postgres = await new GenericContainer(
      "postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193")
      .withEnvironment({
        POSTGRES_DB: "courtside",
        POSTGRES_USER: "courtside",
        POSTGRES_PASSWORD: "courtside"
      })
      .withExposedPorts(5432)
      .start();
    const java = process.env.JAVA_HOME ? `${process.env.JAVA_HOME}/bin/java` : "java";
    application = spawn(java, ["-jar", applicationJar()], {
      env: {
        ...process.env,
        SERVER_PORT: String(port),
        SPRING_DATASOURCE_URL: `jdbc:postgresql://${postgres.getHost()}:${postgres.getMappedPort(5432)}/courtside`,
        SPRING_DATASOURCE_USERNAME: "courtside",
        SPRING_DATASOURCE_PASSWORD: "courtside",
        COURTSIDE_COOKIE_SECURE: "false",
        COURTSIDE_BOOTSTRAP_ADMIN_USERNAME: "bootstrap-admin",
        COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD: "temporary-password",
        COURTSIDE_BOOTSTRAP_ADMIN_DISPLAY_NAME: "Bootstrap Administrator"
      },
      stdio: "inherit"
    });
    await waitForApplication(application, baseURL);
    await seedJourneyData(postgres, visualDate);
    const tables = await snapshotJourneyData(postgres);
    return {
      baseURL,
      visualDate,
      reset: () => resetJourneyData(postgres!, tables),
      stop: async () => {
        application?.kill();
        await postgres?.stop();
      }
    };
  } catch (error) {
    application?.kill();
    await postgres?.stop();
    throw error;
  }
}

export default function globalSetup(): void {
  rmSync(resolve("test-results", "visual-journeys"), { recursive: true, force: true });
}
