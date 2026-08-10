import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localRequest, newBootstrapPassword } from "./courtside.mjs";

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

try {
  const password = newBootstrapPassword();
  cli(["uat", "--skip-verify"], { ...process.env, COURTSIDE_UAT_BOOTSTRAP_PASSWORD: password });
  const appBefore = composeRun("ps", "-q", "app");
  const accountCount = composeRun("exec", "-T", "db", "psql", "-U", "courtside", "-d", "courtside", "-tAc", "select count(*) from user_account");
  const redirect = await localRequest({ secure: false, port: 8081, path: "/api/session" });
  const session = await localRequest({ secure: true, port: 8443, path: "/api/session" });
  const csrfCookie = session.headers["set-cookie"].find((cookie) => cookie.startsWith("XSRF-TOKEN="));
  const csrfToken = csrfCookie.match(/^XSRF-TOKEN=([^;]+)/)[1];
  const login = await localRequest({
    secure: true,
    port: 8443,
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
  assert.match(csrfCookie, /; Secure/i);
  assert.equal(login.statusCode, 200);
  assert.match(login.headers["set-cookie"].find((cookie) => cookie.startsWith("JSESSIONID=")), /; Secure; HttpOnly/i);
  assert.notEqual(accountCount, "0");

  cli(["uat", "--skip-verify"]);
  assert.notEqual(composeRun("ps", "-q", "app"), appBefore);
  assert.equal(composeRun("exec", "-T", "db", "psql", "-U", "courtside", "-d", "courtside", "-tAc", "select count(*) from user_account"), accountCount);

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
