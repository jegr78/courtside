import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localRequest, newBootstrapPassword, uatImageReference } from "./courtside.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const confirmation = process.argv.slice(2);
const compose = ["compose", "-p", "courtside-uat", "-f", join(root, "deploy", "compose.uat.yaml")];
const build = join(root, "build", "uat-smoke");

if (confirmation.join(" ") !== "--confirm courtside-uat") {
  throw new Error("UAT smoke testing is destructive; pass --confirm courtside-uat");
}

mkdirSync(build, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: options.binary ? undefined : "utf8", env: options.environment ?? process.env,
    stdio: options.inherit ? "inherit" : "pipe"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}: ${result.stderr ?? ""}`);
  return result.stdout?.toString().trim() ?? "";
}

function cli(args, environment = process.env) {
  run(process.execPath, [join(root, "tools", "courtside.mjs"), ...args], { inherit: true, environment });
}

function composeRun(...args) {
  return run("docker", [...compose, ...args]);
}

function rememberCookies(jar, response) {
  for (const cookie of response.headers["set-cookie"] ?? []) {
    const [pair] = cookie.split(";", 1);
    const separator = pair.indexOf("=");
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function sessionHeaders(jar, headers = {}) {
  return {
    Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
    ...headers
  };
}

function mutationHeaders(jar, headers = {}) {
  return sessionHeaders(jar, { "X-XSRF-TOKEN": decodeURIComponent(jar.get("XSRF-TOKEN")), ...headers });
}

async function requestWithCookies(jar, options) {
  const response = await localRequest({ secure: false, port: 8083, ...options,
    headers: sessionHeaders(jar, options.headers) });
  rememberCookies(jar, response);
  return response;
}

async function logIn(jar, password) {
  const setup = await requestWithCookies(jar, { path: "/api/session" });
  assert.equal(setup.statusCode, 200);
  const response = await requestWithCookies(jar, {
    path: "/api/session", method: "POST",
    headers: mutationHeaders(jar, { "Content-Type": "application/x-www-form-urlencoded" }),
    body: `username=admin&password=${encodeURIComponent(password)}`
  });
  assert.equal(response.statusCode, 200);
  return response;
}

function futureBookingSlot() {
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 2);
  startsAt.setUTCHours(10, 0, 0, 0);
  return { startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString() };
}

try {
  const password = newBootstrapPassword();
  const permanentPassword = newBootstrapPassword();
  const version = process.env.COURTSIDE_UAT_VERSION;
  const startArguments = ["uat", "--no-credential-output", ...(version ? ["--version", version] : ["--skip-verify"])];
  cli(startArguments, { ...process.env, COURTSIDE_UAT_BOOTSTRAP_PASSWORD: password });
  const appBefore = composeRun("ps", "-q", "app");
  const appStartedBefore = JSON.parse(run("docker", ["inspect", appBefore]))[0].State.StartedAt;
  const image = composeRun("images", "app", "--format", "json");
  const accountCount = composeRun("exec", "-T", "db", "psql", "-U", "courtside", "-d", "courtside", "-tAc", "select count(*) from user_account");
  const localCa = composeRun("exec", "-T", "proxy", "cat", "/data/caddy/pki/authorities/local/root.crt");
  const redirect = await localRequest({ secure: false, port: 8081, path: "/api/session" });
  const session = await localRequest({ secure: true, port: 8443, path: "/api/session", ca: localCa });
  const frontend = await localRequest({ secure: true, port: 8443, path: "/", ca: localCa });
  const apiUi = await localRequest({ secure: true, port: 8443, path: "/api-ui/", ca: localCa });
  const apiDocument = await localRequest({ secure: true, port: 8443, path: "/api/openapi.yaml", ca: localCa });
  const sharedSession = await localRequest({ secure: false, port: 8083, path: "/api/session" });
  const sharedApiUi = await localRequest({ secure: false, port: 8083, path: "/api-ui/" });
  const sharedApiDocument = await localRequest({ secure: false, port: 8083, path: "/api/openapi.yaml" });
  const sharedActuator = await localRequest({ secure: false, port: 8083, path: "/actuator/health" });
  const csrfCookie = sharedSession.headers["set-cookie"].find((cookie) => cookie.startsWith("XSRF-TOKEN="));
  const csrfToken = csrfCookie.match(/^XSRF-TOKEN=([^;]+)/)[1];
  const login = await localRequest({
    secure: false,
    port: 8083,
    path: "/api/session",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": `XSRF-TOKEN=${csrfToken}`,
      "X-XSRF-TOKEN": csrfToken
    },
    body: `username=admin&password=${password}`
  });

  assert.equal(redirect.statusCode, 301);
  assert.equal(redirect.headers.location, "https://localhost:8443/api/session");
  assert.equal(session.statusCode, 200);
  assert.equal(frontend.statusCode, 200);
  assert.match(frontend.body, /<div id="root"><\/div>/);
  assert.equal(apiUi.statusCode, 200);
  assert.match(apiUi.body, /Swagger UI/);
  assert.equal(apiDocument.statusCode, 200);
  assert.match(apiDocument.body, /^openapi: 3\.1\.0/m);
  assert.equal(sharedSession.statusCode, 200);
  assert.equal(sharedApiUi.statusCode, 404);
  assert.equal(sharedApiDocument.statusCode, 404);
  assert.equal(sharedActuator.statusCode, 404);
  assert.equal(sharedSession.headers["strict-transport-security"], "max-age=31536000");
  assert.equal(sharedSession.headers["x-robots-tag"], "noindex, nofollow");
  assert.equal(sharedSession.headers.via, undefined);
  assert.match(sharedSession.headers["content-security-policy"], /img-src 'self' https:;/);
  assert.doesNotMatch(sharedSession.headers["content-security-policy"], /(?:http:|data:)/);
  assert.match(csrfCookie, /; Secure/i);
  assert.equal(login.statusCode, 200);
  assert.match(login.headers["set-cookie"].find((cookie) => cookie.startsWith("SESSION=")), /; Secure; HttpOnly/i);
  assert.notEqual(accountCount, "0");

  const cookies = new Map();
  await logIn(cookies, password);
  const passwordChange = await requestWithCookies(cookies, {
    path: "/api/account/initial-password", method: "PUT",
    headers: mutationHeaders(cookies, { "Content-Type": "application/json" }),
    body: JSON.stringify({ password: permanentPassword })
  });
  assert.equal(passwordChange.statusCode, 204);
  cookies.clear();
  await logIn(cookies, permanentPassword);

  const courts = await requestWithCookies(cookies, { path: "/api/public/courts" });
  const cards = await requestWithCookies(cookies, { path: "/api/public/booking-cards" });
  assert.equal(courts.statusCode, 200);
  assert.equal(cards.statusCode, 200);
  const unsupportedMethod = await requestWithCookies(cookies, {
    path: "/api/public/courts", method: "QUERY", headers: mutationHeaders(cookies)
  });
  assert.equal(unsupportedMethod.statusCode, 405, unsupportedMethod.body);
  assert.match(unsupportedMethod.headers["content-type"], /^application\/problem\+json/);
  assert.equal(unsupportedMethod.headers.allow, "GET");
  assert.equal(JSON.parse(unsupportedMethod.body).type, "urn:courtside:error:method-not-supported");
  assert.equal(JSON.parse(unsupportedMethod.body).title, "Method not allowed");
  const booking = await requestWithCookies(cookies, {
    path: "/api/bookings", method: "POST",
    headers: mutationHeaders(cookies, { "Content-Type": "application/json", "Idempotency-Key": "uat-image-smoke" }),
    body: JSON.stringify({
      courtIds: [JSON.parse(courts.body)[0].id],
      cardId: JSON.parse(cards.body).find((card) => card.id === "11111111-1111-1111-1111-111111111111").id,
      ...futureBookingSlot(),
      participants: [{ guestName: "John Roe" }]
    })
  });
  assert.equal(booking.statusCode, 201, booking.body);
  const bookingId = JSON.parse(booking.body).id;
  const oversizedRequest = await requestWithCookies(cookies, {
    path: "/api/bookings", method: "POST",
    headers: mutationHeaders(cookies, { "Content-Type": "application/json", "Idempotency-Key": "uat-oversized-request" }),
    body: JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024) })
  });
  assert.equal(oversizedRequest.statusCode, 413);
  const sessionsBeforeRestart = composeRun("exec", "-T", "db", "psql", "-U", "courtside", "-d", "courtside", "-tAc", "select count(*) from spring_session");

  composeRun("restart", "app");
  composeRun("up", "-d", "--wait", "app", "proxy");
  assert.equal(composeRun("ps", "-q", "app"), appBefore);
  assert.notEqual(JSON.parse(run("docker", ["inspect", appBefore]))[0].State.StartedAt, appStartedBefore);
  assert.equal(composeRun("exec", "-T", "db", "psql", "-U", "courtside", "-d", "courtside", "-tAc", "select count(*) from user_account"), accountCount);
  const sessionsAfterRestart = composeRun("exec", "-T", "db", "psql", "-U", "courtside", "-d", "courtside", "-tAc", "select count(*) from spring_session");
  const persistedSession = await requestWithCookies(cookies, { path: "/api/session" });
  assert.equal(JSON.parse(persistedSession.body).authenticated, true,
    JSON.stringify({ sessionsBeforeRestart, sessionsAfterRestart, cookies: [...cookies.keys()], body: persistedSession.body }));
  const personalBookings = await requestWithCookies(cookies, { path: "/api/my/bookings" });
  assert.equal(personalBookings.statusCode, 200);
  assert.match(personalBookings.body, new RegExp(bookingId));

  const hostileHeaders = await localRequest({
    secure: false, port: 8083, path: "/api/session",
    headers: { Host: "attacker.example", Forwarded: "host=attacker.example;proto=http", "X-Forwarded-Proto": "http" }
  });
  assert.equal(hostileHeaders.statusCode, 200);
  assert.equal(hostileHeaders.headers["strict-transport-security"], "max-age=31536000");
  assert.doesNotMatch(hostileHeaders.body, /attacker\.example/);

  const logout = await requestWithCookies(cookies, {
    path: "/api/session/logout", method: "POST", headers: mutationHeaders(cookies)
  });
  assert.equal(logout.statusCode, 204);
  const loggedOutSession = await requestWithCookies(cookies, { path: "/api/session" });
  assert.equal(JSON.parse(loggedOutSession.body).authenticated, false);

  const appInspection = JSON.parse(run("docker", ["inspect", composeRun("ps", "-q", "app")]))[0];
  assert.equal(appInspection.Config.User, "10001:10001");
  assert.equal(appInspection.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(appInspection.HostConfig.CapDrop, ["ALL"]);
  assert.ok(appInspection.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert.ok(Object.hasOwn(appInspection.HostConfig.Tmpfs, "/tmp"));
  assert.equal(appInspection.NetworkSettings.Ports["8080/tcp"], null);

  if (version) {
    const imageReference = uatImageReference(version);
    const repoDigests = JSON.parse(run("docker", ["image", "inspect", imageReference]))[0].RepoDigests;
    assert.ok(repoDigests.some((digest) => digest.endsWith(`@${version.split("@")[1]}`)));
  }

  const logs = composeRun("logs", "--no-color", "app", "proxy");
  assert.match(logs, /Graceful shutdown complete/);
  assert.doesNotMatch(logs, new RegExp(`${password}|${permanentPassword}`));
  writeFileSync(join(build, "qualification.json"), `${JSON.stringify({
    schemaVersion: 1,
    status: "passed",
    image: JSON.parse(image),
    manifestDigest: version?.split("@")[1] ?? appInspection.Image,
    architecture: process.arch === "x64" ? "amd64" : process.arch,
    checks: { deployment: true, authentication: true, bookingPersistence: true, hardening: true }
  }, null, 2)}\n`);

  composeRun("cp", "proxy:/data/caddy/pki/authorities/local/root.crt", join(build, "root-before.crt"));
  cli(["uat-reset", "courtside-uat"]);
  assert.equal(existsSync(join(build, "root-before.crt")), true);
  assert.equal(run("docker", ["volume", "ls", "--quiet", "--filter", "name=^courtside-uat_db$"]), "");
  assert.equal(run("docker", ["volume", "ls", "--quiet", "--filter", "name=^courtside-uat_caddy-data$"]), "courtside-uat_caddy-data");

  process.env.COURTSIDE_UAT_ADMIN_PASSWORD = newBootstrapPassword();
  composeRun("up", "-d", "--wait", "app", "proxy");
  composeRun("cp", "proxy:/data/caddy/pki/authorities/local/root.crt", join(build, "root-after.crt"));
  assert.deepEqual(readFileSync(join(build, "root-after.crt")), readFileSync(join(build, "root-before.crt")));
} finally {
  cli(["uat-reset", "courtside-uat", "--all"]);
}
