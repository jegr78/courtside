import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  executableNames, frontendInstallPlan, lifecyclePlan, listenerOutputMatches, parseArguments,
  processPlans, requiredPorts, startProcesses, terminate
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
