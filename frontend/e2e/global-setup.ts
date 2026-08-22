import { spawn, type ChildProcess } from "node:child_process";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { GenericContainer, Network, Wait,
  type StartedNetwork, type StartedTestContainer } from "testcontainers";
import type { FullConfig } from "@playwright/test";
import { requireBuiltAfterItsSources } from "./build-freshness";
import { collectBrowserDiagnostics, retainBrowserDiagnostics, type BrowserDiagnostics } from "./browser-diagnostics";
import { startJourneyControl } from "./journey-control";

const PINNED_BROWSER_IMAGE =
  "mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e";
const PINNED_PROXY_IMAGE =
  "caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648";
// The name the certificate is issued for, so browsers reach the proxy the way a member reaches a club.
const CLUB_HOST = "courtside.test";

// Qualifying against a database a club does not run proves nothing about the one it does, so the
// reference is read from the deployment rather than repeated beside it.
function deployedPostgresImage(): string {
  const compose = resolve("../deploy/compose.yaml");
  const found = /postgres:[\w.-]+@sha256:[a-f0-9]{64}/.exec(readFileSync(compose, "utf8"));
  if (!found) throw new Error(`${compose} names no PostgreSQL image pinned by digest`);
  return found[0];
}
const CLUB_PLAIN_PORT = 8081;
const CADDY_LOCAL_AUTHORITY = "/data/caddy/pki/authorities/local";
const CADDY_ISSUED_CERTIFICATES = "/data/caddy/certificates";

async function readProxyCertificates(proxy: StartedTestContainer, where: string): Promise<string> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await proxy.exec(["sh", "-c", `find ${where} -name '*.crt' -exec cat {} +`]);
    if (result.exitCode === 0 && result.stdout.includes("BEGIN CERTIFICATE")) {
      return result.stdout;
    }
    await new Promise((wait) => setTimeout(wait, 250));
  }
  throw new Error(`The club proxy issued no certificate under ${where}`);
}

function clubProxyConfiguration(applicationPort: number): string {
  return `{
	admin off
	local_certs
}

https://${CLUB_HOST} {
	reverse_proxy host.docker.internal:${applicationPort}
}

http://${CLUB_HOST}:${CLUB_PLAIN_PORT} {
	reverse_proxy host.docker.internal:${applicationPort}
}
`;
}

// Chromium reads NSS rather than the system store, and the image carries no certutil to write it.
// Naming the keys this proxy actually serves beats disabling certificate validation for the browser.
function publicKeyFingerprints(certificates: string): string[] {
  return [...certificates.matchAll(/-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g)]
    .map((match) => new X509Certificate(match[0]).publicKey.export({ type: "spki", format: "der" }))
    .map((key) => createHash("sha256").update(key).digest("base64"));
}

async function waitForApplication(application: ChildProcess, baseURL: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (application.exitCode !== null) {
      throw new Error(`Courtside stopped with exit code ${application.exitCode} while starting`
        + ` on ${baseURL}. Its own output says why, above this line.`);
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
      ('00000000-0000-0000-0000-000000000113', 'GROUNDSKEEPER'),
      ('00000000-0000-0000-0000-000000000113', 'MEMBER');
    INSERT INTO member (id, person_id, membership_type_id, started_on)
    VALUES ('00000000-0000-0000-0000-000000000105',
      '00000000-0000-0000-0000-000000000101', 'cccccccc-0000-0000-0000-000000000001', DATE '2026-01-01');
    INSERT INTO person (id, first_name, last_name, email)
    VALUES ('00000000-0000-0000-0000-000000000103', 'Mary', 'Major', 'mary.major@example.org');
    INSERT INTO member (id, person_id, membership_type_id, started_on)
    VALUES ('00000000-0000-0000-0000-000000000104',
      '00000000-0000-0000-0000-000000000103', 'cccccccc-0000-0000-0000-000000000001', DATE '2026-01-01');
    INSERT INTO member (id, person_id, membership_type_id, started_on)
    VALUES ('00000000-0000-0000-0000-000000000114',
      '00000000-0000-0000-0000-000000000112', 'cccccccc-0000-0000-0000-000000000001', DATE '2026-01-01');
    INSERT INTO person (id, first_name, last_name, email)
    VALUES ('00000000-0000-0000-0000-000000000115', 'Jane', 'Roe', 'jane.roe@example.org');
    INSERT INTO user_account
      (id, person_id, username, password_hash, locale, enabled, password_change_required)
    SELECT '00000000-0000-0000-0000-000000000116',
      '00000000-0000-0000-0000-000000000115', 'roe.jane', password_hash, 'en', true, false
    FROM user_account WHERE username = 'bootstrap-admin';
    INSERT INTO user_account_role (user_account_id, role)
    VALUES ('00000000-0000-0000-0000-000000000116', 'MEMBER');
    INSERT INTO member (id, person_id, membership_type_id, started_on)
    VALUES ('00000000-0000-0000-0000-000000000117',
      '00000000-0000-0000-0000-000000000115', 'cccccccc-0000-0000-0000-000000000001', DATE '2026-01-01');

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
      ('70000000-0000-0000-0000-000000000006', '33333333-3333-3333-3333-333333333333', 'CONFIRMED', (SELECT id FROM user_account WHERE username = 'bootstrap-admin'), 'Cancellation journey'),
      ('70000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'CONFIRMED', (SELECT id FROM user_account WHERE username = 'bootstrap-admin'), 'Withdrawal journey');
    UPDATE booking SET series_id = '73000000-0000-0000-0000-000000000001'
    WHERE id = '70000000-0000-0000-0000-000000000001';

    INSERT INTO booking_participant (id, booking_id, kind, person_id, position) VALUES
      ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'MEMBER', '00000000-0000-0000-0000-000000000101', 0),
      ('71000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'MEMBER', '00000000-0000-0000-0000-000000000103', 1),
      ('71000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 'MEMBER', '00000000-0000-0000-0000-000000000101', 0),
      ('71000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000002', 'MEMBER', '00000000-0000-0000-0000-000000000103', 1),
      ('71000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-000000000007', 'MEMBER', '00000000-0000-0000-0000-000000000101', 0);

    INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status) VALUES
      ('72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', (DATE '${visualDate}' + TIME '09:00') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + TIME '10:00') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED'),
      ('72000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000002', (DATE '${visualDate}' + TIME '09:00') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + TIME '10:00') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED'),
      ('72000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000003', (DATE '${visualDate}' + TIME '08:30') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + TIME '10:00') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED'),
      ('72000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000004', (DATE '${visualDate}' + TIME '10:00') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + TIME '12:00') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED'),
      ('72000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-000000000005', 'dddddddd-0000-0000-0000-000000000001', (DATE '${visualDate}' + TIME '10:30') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + TIME '11:30') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED'),
      ('72000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000006', 'dddddddd-0000-0000-0000-000000000004', (DATE '${visualDate}' + 1 + TIME '10:00') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + 1 + TIME '12:00') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED'),
      ('72000000-0000-0000-0000-000000000007', '70000000-0000-0000-0000-000000000007', 'dddddddd-0000-0000-0000-000000000002', (DATE '${visualDate}' + 2 + TIME '09:00') AT TIME ZONE 'Europe/Berlin', (DATE '${visualDate}' + 2 + TIME '10:00') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED');
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


export const journeyInstant = "2026-05-12T10:00:00Z";

function dayAfterInBerlin(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 1)).toISOString().slice(0, 10);
}

export const journeyDate = dayAfterInBerlin(journeyInstant);

export interface JourneyService {
  baseURL: string;
  plainBaseURL: string;
  visualDate: string;
  pinnedBrowser(browserName: string): Promise<string>;
  releasePinnedBrowser(browserName: string): Promise<void>;
  browserDiagnostics(browserName: string, reason: string): Promise<BrowserDiagnostics>;
  executeSql(sql: string): Promise<string>;
  holdDatabaseLock(sql: string): Promise<DatabaseLock>;
  publishServiceWorkerUpdate(): Promise<void>;
  reset(): Promise<void>;
  restart(): Promise<void>;
}

interface StartedJourneyService extends JourneyService {
  stop(): Promise<void>;
}

export interface DatabaseLock {
  waitForWaiters(count: number): Promise<string>;
  release(): Promise<void>;
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

export async function startJourneyService(): Promise<StartedJourneyService> {
  let postgres: StartedTestContainer | undefined;
  let application: ChildProcess | undefined;
  let staticDirectory: string | undefined;
  const browserServers = new Map<string, { container: StartedTestContainer; endpoint: string }>();
  let clubNetwork: StartedNetwork | undefined;
  let clubProxy: StartedTestContainer | undefined;
  const stopContainers = async () => {
    await Promise.all([...browserServers.values()].map((server) => server.container.stop()));
    browserServers.clear();
    await clubProxy?.stop();
    await postgres?.stop();
    await clubNetwork?.stop();
  };
  try {
    const visualDate = journeyDate;
    postgres = await new GenericContainer(deployedPostgresImage())
      .withEnvironment({
        POSTGRES_DB: "courtside",
        POSTGRES_USER: "courtside",
        POSTGRES_PASSWORD: "courtside"
      })
      .withExposedPorts(5432)
      .start();
    const java = process.env.JAVA_HOME ? `${process.env.JAVA_HOME}/bin/java` : "java";
    requireBuiltAfterItsSources(resolve("dist"), resolve("src"), "npm run build");
    requireBuiltAfterItsSources(applicationJar(), resolve("../src/main"), "./mvnw package -DskipTests");
    staticDirectory = mkdtempSync(resolve(tmpdir(), "courtside-pwa-"));
    cpSync(resolve("dist"), staticDirectory, { recursive: true });
    const resetStaticAssets = () => {
      rmSync(staticDirectory!, { recursive: true, force: true });
      cpSync(resolve("dist"), staticDirectory!, { recursive: true });
    };
    // Last, because a reserved port is only reserved until it is closed: anything started in
    // between can be handed the same number before Tomcat ever binds it.
    const port = await availableLoopbackPort();
    const baseURL = `http://127.0.0.1:${port}`;
    const applicationEnvironment = {
      ...process.env,
      SERVER_PORT: String(port),
      SPRING_DATASOURCE_URL: `jdbc:postgresql://${postgres.getHost()}:${postgres.getMappedPort(5432)}/courtside`,
      SPRING_DATASOURCE_USERNAME: "courtside",
      SPRING_DATASOURCE_PASSWORD: "courtside",
      LOGGING_LEVEL_ORG_HIBERNATE_ORM_JDBC_ERROR: "ERROR",
      COURTSIDE_ENVIRONMENT: "DEVELOPMENT",
      COURTSIDE_CLOCK_FIXED_INSTANT: journeyInstant,
      COURTSIDE_COOKIE_SECURE: "false",
      COURTSIDE_BOOTSTRAP_ADMIN_USERNAME: "bootstrap-admin",
      COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD: "temporary-password",
      COURTSIDE_BOOTSTRAP_ADMIN_DISPLAY_NAME: "Bootstrap Administrator",
      COURTSIDE_MAIL_RELAY_HOST: "mail.invalid",
      COURTSIDE_MAIL_FROM: "no-reply@example.org",
      COURTSIDE_MAIL_REPLY_TO: "board@example.org",
      SPRING_WEB_RESOURCES_STATIC_LOCATIONS: `file:${staticDirectory}/,classpath:/static/`
    };
    const startApplication = async () => {
      application = spawn(java, ["-jar", applicationJar()], {
        env: applicationEnvironment,
        stdio: "inherit"
      });
      await waitForApplication(application, baseURL);
    };
    const stopApplication = async () => {
      if (!application || application.exitCode !== null) return;
      const stopped = once(application, "exit");
      application.kill();
      await stopped;
    };
    const executeSql = async (sql: string) => {
      const result = await postgres!.exec([
        "psql", "-U", "courtside", "-d", "courtside", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql
      ]);
      if (result.exitCode !== 0) throw new Error(`Journey SQL failed: ${result.stderr}`);
      return result.stdout.trim();
    };
    const heldLocks = new Set<DatabaseLock>();
    const holdDatabaseLock = async (sql: string): Promise<DatabaseLock> => {
      const client = spawn("docker", [
        "exec", "-i", postgres!.getId(), "psql", "-U", "courtside", "-d", "courtside",
        "-v", "ON_ERROR_STOP=1", "-At"
      ], { stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      let errors = "";
      client.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      client.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
      client.stdin.write(`BEGIN;\n${sql};\nSELECT 'COURTSIDE_LOCK_READY';\n`);
      for (let attempt = 0; attempt < 100 && !output.includes("COURTSIDE_LOCK_READY"); attempt += 1) {
        if (client.exitCode !== null) throw new Error(`Database lock client stopped: ${errors}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!output.includes("COURTSIDE_LOCK_READY")) {
        client.kill();
        throw new Error(`Database lock was not acquired: ${errors}`);
      }
      let released = false;
      const lock: DatabaseLock = {
        waitForWaiters: async (count) => {
          let diagnostics = "";
          for (let attempt = 0; attempt < 100; attempt += 1) {
            diagnostics = await executeSql(`
              SELECT pid, wait_event_type, wait_event, state, query
              FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid()
                AND wait_event_type = 'Lock'
              ORDER BY pid
            `);
            if (diagnostics.split("\n").filter(Boolean).length >= count) return diagnostics;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          throw new Error(`Expected ${count} database lock waiters, observed:\n${diagnostics}`);
        },
        release: async () => {
          if (released) return;
          released = true;
          client.stdin.end("COMMIT;\n\\q\n");
          const [code] = await once(client, "exit") as [number | null];
          heldLocks.delete(lock);
          if (code !== 0) throw new Error(`Database lock client failed: ${errors}`);
        }
      };
      heldLocks.add(lock);
      return lock;
    };
    await startApplication();
    await seedJourneyData(postgres, visualDate);
    const tables = await snapshotJourneyData(postgres);
    clubNetwork = await new Network().start();
    clubProxy = await new GenericContainer(PINNED_PROXY_IMAGE)
      .withNetwork(clubNetwork)
      .withNetworkAliases(CLUB_HOST)
      .withCopyContentToContainer([
        { content: clubProxyConfiguration(port), target: "/etc/caddy/Caddyfile" }
      ])
      // Reaching the host the way deploy/Caddyfile.dev does. The Testcontainers host tunnel runs
      // inside this process, and its socket errors are uncaught when the application restarts.
      .withExtraHosts([{ host: "host.docker.internal", ipAddress: "host-gateway" }])
      .withWaitStrategy(Wait.forLogMessage(/serving initial configuration/))
      .start();
    const rootCertificate = await readProxyCertificates(clubProxy, CADDY_LOCAL_AUTHORITY);
    const servedKeys = publicKeyFingerprints(
      rootCertificate + await readProxyCertificates(clubProxy, CADDY_ISSUED_CERTIFICATES));
    const startPinnedBrowser = async (browserName: string): Promise<string> => {
      const running = browserServers.get(browserName);
      if (running) {
        return running.endpoint;
      }
      // Docker publishes the mapped port on every interface and the server has no authentication,
      // so the unguessable endpoint path is what keeps a reachable port from being a browser.
      const wsPath = `/${randomUUID()}`;
      const options = {
        port: 3000, host: "0.0.0.0", wsPath,
        args: browserName === "chromium"
          ? [`--ignore-certificate-errors-spki-list=${servedKeys.join(",")}`] : []
      };
      const container = await new GenericContainer(PINNED_BROWSER_IMAGE)
        .withNetwork(clubNetwork!)
        .withCopyDirectoriesToContainer([
          { source: resolve("node_modules/playwright"), target: "/opt/courtside/node_modules/playwright" },
          { source: resolve("node_modules/playwright-core"), target: "/opt/courtside/node_modules/playwright-core" }
        ])
        .withCopyContentToContainer([
          { content: rootCertificate, target: "/usr/local/share/ca-certificates/courtside-club.crt" },
          { content: JSON.stringify(options), target: "/tmp/launch-options.json" }
        ])
        // Baking the arguments into the server keeps the mode out of the picture under which a
        // connecting client may set launch options, an executable path among them.
        .withCommand(["bash", "-c", "update-ca-certificates >/dev/null"
          + ` && node /opt/courtside/node_modules/playwright/cli.js launch-server --browser ${browserName}`
          + " --config /tmp/launch-options.json"])
        .withExposedPorts(3000)
        .withWaitStrategy(Wait.forLogMessage(/ws:\/\//))
        .start();
      const endpoint = `ws://${container.getHost()}:${container.getMappedPort(3000)}${wsPath}`;
      browserServers.set(browserName, { container, endpoint });
      return endpoint;
    };
    const releasePinnedBrowser = async (browserName: string): Promise<void> => {
      const browser = browserServers.get(browserName);
      if (!browser) return;
      await browser.container.stop();
      browserServers.delete(browserName);
    };
    return {
      baseURL: `https://${CLUB_HOST}`,
      plainBaseURL: `http://${CLUB_HOST}:${CLUB_PLAIN_PORT}`,
      visualDate,
      pinnedBrowser: startPinnedBrowser,
      releasePinnedBrowser,
      browserDiagnostics: async (browserName, reason) => {
        const browser = browserServers.get(browserName);
        if (!browser) throw new Error(`No pinned ${browserName} browser exists`);
        const diagnostics = await collectBrowserDiagnostics(browser.container.getId(), browserName, reason);
        retainBrowserDiagnostics(diagnostics);
        return diagnostics;
      },
      executeSql,
      holdDatabaseLock,
      publishServiceWorkerUpdate: () => {
        appendFileSync(resolve(staticDirectory!, "sw.js"), `\nself.addEventListener("message",event=>{if(event.data==="COURTSIDE_TEST_VERSION")event.source.postMessage({courtsideVersion:2})});\n`);
        return Promise.resolve();
      },
      reset: async () => {
        await Promise.all([...heldLocks].map((lock) => lock.release()));
        resetStaticAssets();
        await resetJourneyData(postgres!, tables);
      },
      restart: async () => {
        // The same port again, not a new one: the club proxy is already configured against it.
        await stopApplication();
        await startApplication();
      },
      stop: async () => {
        await Promise.all([...heldLocks].map((lock) => lock.release()));
        await stopApplication();
        await stopContainers();
        rmSync(staticDirectory!, { recursive: true, force: true });
      }
    };
  } catch (error) {
    application?.kill();
    await stopContainers();
    if (staticDirectory) rmSync(staticDirectory, { recursive: true, force: true });
    throw error;
  }
}

export default async function globalSetup(config: FullConfig): Promise<() => Promise<void>> {
  if (config.workers !== 1) throw new Error("The shared journey world requires exactly one Playwright worker");
  rmSync(resolve("test-results", "visual-journeys"), { recursive: true, force: true });
  const service = await startJourneyService();
  try {
    const control = await startJourneyControl(service);
    process.env.COURTSIDE_JOURNEY_CONTROL = JSON.stringify(control.reference);
    return async () => {
      try {
        await control.close();
      } finally {
        await service.stop();
      }
    };
  } catch (error) {
    await service.stop();
    throw error;
  }
}
