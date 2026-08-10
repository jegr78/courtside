import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  executableNames, frontendInstallPlan, lifecyclePlan, listenerOutputMatches, parseArguments,
  newBootstrapPassword, processPlans, requiredPorts, restoreDatabase, startProcesses, terminate,
  uatComposeArgs, uatResetPlans
} from "./courtside.mjs";

test("given Windows, when resolving executables, then wrapper commands use cmd launchers", () => {
  // when / then
  assert.deepEqual(executableNames("win32"), { maven: "mvnw.cmd", npm: "npm.cmd" });
});

test("given macOS or Linux, when resolving executables, then the POSIX Maven wrapper is used", () => {
  // when / then
  assert.deepEqual(executableNames("darwin"), { maven: "./mvnw", npm: "npm" });
  assert.deepEqual(executableNames("linux"), { maven: "./mvnw", npm: "npm" });
});

test("given a frontend spawn failure, when starting development, then the backend is terminated", async () => {
  // given
  const backend = childProcess(101);
  const frontend = childProcess();
  const terminated = [];
  let invocation = 0;

  // when
  const started = startProcesses(processPlans(parseArguments(["dev"])), {}, {
    spawn: () => invocation++ === 0 ? backend : frontend,
    terminate: (child) => terminated.push(child.pid)
  });
  backend.emit("spawn");
  await new Promise((resolve) => setImmediate(resolve));
  frontend.emit("error", new Error("npm missing"));

  // then
  await assert.rejects(started, /frontend failed to start: npm missing/);
  assert.deepEqual(terminated, [101]);
});

test("given the backend exits while the frontend starts, when supervising development, then its exit is retained", async () => {
  // given
  const backend = childProcess(101);
  const frontend = childProcess(102);
  let invocation = 0;

  // when
  const started = startProcesses(processPlans(parseArguments(["dev"])), {}, {
    spawn: () => invocation++ === 0 ? backend : frontend,
    terminate: () => {}
  });
  backend.emit("spawn");
  await new Promise((resolve) => setImmediate(resolve));
  backend.emit("exit", 7);
  frontend.emit("spawn");
  const processes = await started;

  // then
  assert.equal(await processes.exit, 7);
});

test("given a POSIX process already ended, when terminating its group, then cleanup tolerates ESRCH", () => {
  // given
  const child = { exitCode: null, pid: 101 };
  const kill = () => {
    const failure = new Error("No such process");
    failure.code = "ESRCH";
    throw failure;
  };

  // when / then
  assert.doesNotThrow(() => terminate(child, "linux", kill));
});

test("given lifecycle commands, when planning them, then only the isolated Dev project is targeted", () => {
  // when
  const stop = lifecyclePlan("dev-stop");
  const reset = lifecyclePlan("dev-reset");

  // then
  assert.deepEqual(stop.args.slice(-1), ["stop"]);
  assert.deepEqual(reset.args.slice(-3), ["down", "--volumes", "--remove-orphans"]);
  assert.ok(stop.args.includes("courtside-dev"));
  assert.ok(reset.args.some((argument) => argument.endsWith("compose.dev.yaml")));
});

test("given a fresh checkout, when installing frontend dependencies, then npm ci is platform safe", () => {
  // when
  const windows = frontendInstallPlan("win32");
  const linux = frontendInstallPlan("linux");

  // then
  assert.equal(windows.command, "cmd.exe");
  assert.equal(windows.args.at(-1), "npm.cmd --prefix frontend ci");
  assert.deepEqual(linux.args, ["--prefix", "frontend", "ci"]);
});

test("given platform listener output, when checking JDWP, then only loopback listeners match", () => {
  // when / then
  assert.equal(listenerOutputMatches("TCP 127.0.0.1:5005 0.0.0.0:0 LISTENING", 5005), true);
  assert.equal(listenerOutputMatches("LISTEN 0 1 127.0.0.1:5005 0.0.0.0:*", 5005), true);
  assert.equal(listenerOutputMatches("TCP 0.0.0.0:5005 0.0.0.0:0 LISTENING", 5005), false);
});

test("given Windows development, when planning processes, then both platform launchers are used", () => {
  // when
  const plans = processPlans(parseArguments(["dev"]), "win32");

  // then
  assert.equal(plans.backend.command, "cmd.exe");
  assert.match(plans.backend.args.at(-1), /^mvnw\.cmd spring-boot:run/);
  assert.equal(plans.frontend.command, "cmd.exe");
  assert.match(plans.frontend.args.at(-1), /^npm\.cmd --prefix frontend/);
  assert.equal(plans.backend.detached, false);
  assert.equal(plans.frontend.detached, false);
});

test("given POSIX development, when planning processes, then no command shell is introduced", () => {
  // when
  const plans = processPlans(parseArguments(["dev"]), "linux");

  // then
  assert.equal(plans.backend.command, "./mvnw");
  assert.equal(plans.frontend.command, "npm");
  assert.equal(plans.backend.detached, true);
  assert.equal(plans.frontend.detached, true);
});

function childProcess(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

test("given dev debug with suspend, when planning processes, then JDWP waits on loopback", () => {
  // when
  const options = parseArguments(["dev-debug", "--suspend"]);
  const plans = processPlans(options, "linux");

  // then
  assert.match(plans.backend.args.join(" "), /address=127\.0\.0\.1:5005/);
  assert.match(plans.backend.args.join(" "), /suspend=y/);
  assert.deepEqual(plans.frontend.args,
    ["--prefix", "frontend", "run", "dev", "--", "--host", "127.0.0.1"]);
});

test("given build and verify, when planning commands, then Maven remains the build entry point", () => {
  // when / then
  assert.deepEqual(processPlans(parseArguments(["build"]), "linux").single.args,
    ["package", "-DskipTests"]);
  assert.deepEqual(processPlans(parseArguments(["verify"]), "linux").single.args,
    ["clean", "verify"]);
});

test("given an unsupported argument, when parsing it, then it is rejected", () => {
  // when / then
  assert.throws(() => parseArguments(["dev", "--force"]), /Unknown option/);
});

test("given development modes, when validating ports, then debug adds only its listener", () => {
  // when / then
  assert.deepEqual(requiredPorts(parseArguments(["dev"])), [5432, 8080, 5173]);
  assert.deepEqual(requiredPorts(parseArguments(["dev-debug"])), [5432, 8080, 5173, 5005]);
});

test("given UAT source options, when parsing them, then verification and database exposure are explicit", () => {
  // when
  const options = parseArguments(["uat", "--skip-verify", "--db-port"]);

  // then
  assert.equal(options.skipVerify, true);
  assert.equal(options.dbPort, true);
  assert.equal(options.version, undefined);
});

test("given a published UAT version, when parsing it, then only an image-safe tag is accepted", () => {
  // when / then
  assert.equal(parseArguments(["uat", "--version", "1.2.3"]).version, "1.2.3");
  assert.throws(() => parseArguments(["uat", "--version", "latest;whoami"]), /Invalid image version/);
});

test("given UAT status, when parsing output options, then the environment is retained", () => {
  // when
  const options = parseArguments(["status", "uat", "--json"]);

  // then
  assert.equal(options.environment, "uat");
  assert.equal(options.json, true);
});

test("given destructive UAT commands, when confirmation differs, then they are rejected", () => {
  // when / then
  assert.throws(() => parseArguments(["uat-reset", "uat"]), /exact project name/);
  assert.throws(() => parseArguments(["uat-restore", "backup.dump", "--confirm", "uat"]), /requires a file/);
  assert.equal(parseArguments(["uat-reset", "courtside-uat", "--all"]).all, true);
});

test("given optional UAT database access, when composing the project, then the port override is opt in", () => {
  // when
  const privateArgs = uatComposeArgs();
  const exposedArgs = uatComposeArgs(true);

  // then
  assert.equal(privateArgs.some((argument) => argument.endsWith("compose.uat-db.yaml")), false);
  assert.equal(exposedArgs.some((argument) => argument.endsWith("compose.uat-db.yaml")), true);
  assert.ok(exposedArgs.includes("courtside-uat"));
});

test("given UAT lifecycle commands, when planning them, then they target only the UAT project", () => {
  // when
  const stop = lifecyclePlan("uat-stop");
  const shell = lifecyclePlan("uat-db-shell");

  // then
  assert.ok(stop.args.includes("courtside-uat"));
  assert.deepEqual(stop.args.slice(-1), ["stop"]);
  assert.deepEqual(shell.args.slice(-6), ["exec", "db", "psql", "-U", "courtside", "courtside"]);
});

test("given UAT persistence, when reading its Compose contract, then data, CA, TLS, and database exposure are separated", () => {
  // given
  const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.uat.yaml", import.meta.url)), "utf8");
  const databaseOverride = readFileSync(fileURLToPath(new URL("../deploy/compose.uat-db.yaml", import.meta.url)), "utf8");
  const caddy = readFileSync(fileURLToPath(new URL("../deploy/Caddyfile.uat", import.meta.url)), "utf8");

  // when / then
  assert.match(compose, /COURTSIDE_COOKIE_SECURE: "true"/);
  assert.match(compose, /postgres:17-alpine@sha256:[a-f0-9]{64}/);
  assert.match(compose, /caddy:2-alpine@sha256:[a-f0-9]{64}/);
  assert.match(compose, /COURTSIDE_UAT_ADMIN_PASSWORD/);
  assert.doesNotMatch(compose, /courtside-admin/);
  assert.doesNotMatch(compose, /5433:5432/);
  assert.match(databaseOverride, /127\.0\.0\.1:5433:5432/);
  assert.match(compose, /caddy-data:\/data/);
  assert.match(compose, /db:\/var\/lib\/postgresql\/data/);
  assert.match(caddy, /redir https:\/\/localhost:8443\{uri\} permanent/);
  assert.doesNotMatch(caddy, /Strict-Transport-Security/);
  assert.doesNotMatch(compose, /demo/);
});

test("given a fresh UAT database, when creating its bootstrap password, then it is unpredictable and strong", () => {
  // when
  const first = newBootstrapPassword();
  const second = newBootstrapPassword();

  // then
  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9_-]{24}$/);
});

test("given a restore failure, when restoring UAT, then changes are atomic and the application restarts", () => {
  // given
  const calls = [];
  const execute = (plan) => {
    calls.push(plan.args);
    if (plan.args.includes("pg_restore")) throw new Error("invalid archive");
  };

  // when / then
  assert.throws(() => restoreDatabase(42, uatComposeArgs(), {}, execute), /invalid archive/);
  const restore = calls.find((args) => args.includes("pg_restore"));
  assert.ok(restore.includes("--single-transaction"));
  assert.ok(restore.includes("--exit-on-error"));
  assert.deepEqual(calls.at(-1).slice(-5), ["up", "-d", "--wait", "app", "proxy"]);
});

test("given UAT reset modes, when planning cleanup, then the CA is removed only by all", () => {
  // when
  const databaseOnly = uatResetPlans(false);
  const all = uatResetPlans(true);

  // then
  assert.deepEqual(databaseOnly[1].args, ["volume", "rm", "courtside-uat_db"]);
  assert.equal(databaseOnly.flatMap((plan) => plan.args).includes("--volumes"), false);
  assert.equal(all[0].args.includes("--volumes"), true);
});
