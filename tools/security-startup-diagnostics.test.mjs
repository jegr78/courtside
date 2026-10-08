import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { captureSecurityStartupDiagnostics } from "./security-startup-diagnostics.mjs";

function captureSecurityStartupFailure(input) {
  return captureSecurityStartupDiagnostics({ directory: join(input.directory, ".."), attempt: input.attempt,
    identity: { runId: input.runId, seedFingerprint: input.seedFingerprint, instanceFingerprint: input.instanceFingerprint },
    command: input.command });
}

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "courtside-startup-"));
  const runId = "run-example";
  const runDirectory = join(root, runId);
  mkdirSync(runDirectory, { mode: 0o700 });
  const input = { directory: join(runDirectory, "startup-diagnostics-attempt1"), runId, attempt: 1,
    seedFingerprint: `sha256:${"a".repeat(64)}`, instanceFingerprint: `sha256:${"b".repeat(64)}` };
  const project = `courtside-security-${runId}`;
  const id = "c".repeat(64);
  const runtime = { Id: id, Name: `/${project}-seeder-1`, Config: { Labels: {
    "org.courtside.environment": "SECURITY", "org.courtside.security.run-id": runId,
    "org.courtside.security.seed-fingerprint": input.seedFingerprint,
    "org.courtside.security.instance-fingerprint": input.instanceFingerprint,
    "com.docker.compose.project": project, "com.docker.compose.service": "seeder"
  }, Env: ["PASSWORD=ExampleSecret"] }, State: { Status: "exited", Running: false, ExitCode: 1,
    OOMKilled: false, Error: "ExamplePrivateError" } };
  const calls = [];
  const command = (args, options) => {
    calls.push({ args, options });
    if (args[0] === "inspect") return { exitCode: 0, stdout: JSON.stringify([runtime]), stderr: "" };
    return { exitCode: 0, stdout: Buffer.from("ExamplePrivateStdout"), stderr: Buffer.from("ExamplePrivateStderr") };
  };
  return { root, input, runtime, calls, command, id, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("given an owned exited seeder, when startup evidence is captured, then only bounded private logs and filtered state persist", async () => {
  // given
  const f = fixture();
  try {
    // when
    const result = await captureSecurityStartupFailure({ ...f.input, command: f.command });
    // then
    assert.equal(result.outcome, "captured");
    assert.deepEqual(readdirSync(f.input.directory).sort(), ["seeder-state.json", "stderr.bin", "stdout.bin"]);
    assert.equal(statSync(f.input.directory).mode & 0o777, 0o700);
    for (const file of readdirSync(f.input.directory)) assert.equal(statSync(join(f.input.directory, file)).mode & 0o777, 0o600);
    const state = readFileSync(join(f.input.directory, "seeder-state.json"), "utf8");
    assert.equal(state.includes("ExampleSecret"), false);
    assert.equal(state.includes("ExamplePrivateError"), false);
    assert.equal(JSON.parse(state).exitCode, 1);
    assert.equal(JSON.parse(state).oomKilled, false);
    assert.deepEqual(f.calls[1].args, ["logs", "--tail", "200", f.id]);
    assert.equal(f.calls[0].args[1], "--format");
    assert.equal(f.calls[0].args[2].includes(".Config.Env"), false);
    assert.equal(f.calls[0].args[2].includes("json .State}}"), false);
    assert.equal(JSON.stringify(result).includes("ExamplePrivate"), false);
    assert.ok(f.calls.every(call => call.options.outputLimitBytes <= 131072 && call.options.timeoutMilliseconds <= 15000));
  } finally { f.close(); }
});

test("given replacement of the private evidence directory during logs, when capture writes, then replacement inode receives no private bytes", async () => {
  // given
  const f = fixture();
  const command = (args, options) => {
    if (args[0] === "inspect") return f.command(args, options);
    renameSync(f.input.directory, `${f.input.directory}-retained`);
    mkdirSync(f.input.directory, { mode: 0o700 });
    return { status: 0, stdout: "ExamplePrivateStdout", stderr: "ExamplePrivateStderr" };
  };
  try {
    // when
    const result = await captureSecurityStartupFailure({ ...f.input, command });
    // then
    assert.equal(result.outcome, "incomplete");
    assert.deepEqual(readdirSync(f.input.directory), []);
    assert.deepEqual(readdirSync(`${f.input.directory}-retained`), ["seeder-state.json"]);
  } finally { f.close(); }
});

for (const key of ["org.courtside.environment", "org.courtside.security.run-id", "org.courtside.security.seed-fingerprint",
  "org.courtside.security.instance-fingerprint", "com.docker.compose.project", "com.docker.compose.service"]) {
  test(`given a foreign ${key} label, when startup capture runs, then no foreign logs are read`, async () => {
    // given
    const f = fixture();
    f.runtime.Config.Labels[key] = "foreign";
    try {
      // when
      const result = await captureSecurityStartupFailure({ ...f.input, command: f.command });
      // then
      assert.equal(result.outcome, "incomplete");
      assert.equal(f.calls.length, 1);
    } finally { f.close(); }
  });
}

for (const mutation of [runtime => { runtime.Id = "bad"; }, runtime => { runtime.Name = "/foreign"; },
  runtime => { runtime.State.ExitCode = "1"; }, runtime => { runtime.State.OOMKilled = "false"; }]) {
  test("given unsupported native container metadata, when startup capture runs, then it refuses before reading logs", async () => {
    // given
    const f = fixture();
    mutation(f.runtime);
    try {
      // when
      const result = await captureSecurityStartupFailure({ ...f.input, command: f.command });
      // then
      assert.equal(result.outcome, "incomplete");
      assert.equal(f.calls.length, 1);
    } finally { f.close(); }
  });
}

test("given a native harmless output producer, when logs are captured, then actual stdout and stderr bytes persist privately", async () => {
  // given
  const f = fixture();
  const command = (args, options) => args[0] === "inspect" ? f.command(args, options)
    : spawnSync(process.execPath, ["-e", 'process.stdout.write("ExampleNativeOutput");process.stderr.write("ExampleNativeError")'],
      { timeout: options.timeoutMilliseconds, maxBuffer: options.outputLimitBytes });
  try {
    // when
    const result = await captureSecurityStartupFailure({ ...f.input, command });
    // then
    assert.equal(result.outcome, "captured");
    assert.equal(readFileSync(join(f.input.directory, "stdout.bin"), "utf8"), "ExampleNativeOutput");
    assert.equal(readFileSync(join(f.input.directory, "stderr.bin"), "utf8"), "ExampleNativeError");
  } finally { f.close(); }
});

test("given native output over the bound, when capture runs, then it reports incomplete without leaking exception bytes", async () => {
  // given
  const f = fixture();
  const command = (args, options) => args[0] === "inspect" ? f.command(args, options)
    : spawnSync(process.execPath, ["-e", 'process.stdout.write("x".repeat(300000))'],
      { timeout: options.timeoutMilliseconds, maxBuffer: options.outputLimitBytes });
  try {
    // when
    const result = await captureSecurityStartupFailure({ ...f.input, command });
    // then
    assert.equal(result.outcome, "incomplete");
    assert.ok(JSON.stringify(result).length < 200);
  } finally { f.close(); }
});

test("given an existing evidence directory, when capture is repeated, then it never overwrites the first private evidence", async () => {
  // given
  const f = fixture();
  try {
    await captureSecurityStartupFailure({ ...f.input, command: f.command });
    const before = readFileSync(join(f.input.directory, "stdout.bin"));
    // when
    const result = await captureSecurityStartupFailure({ ...f.input, command: f.command });
    // then
    assert.equal(result.outcome, "incomplete");
    assert.deepEqual(readFileSync(join(f.input.directory, "stdout.bin")), before);
  } finally { f.close(); }
});

test("given a symlinked run directory, when capture starts, then no Docker command or private write occurs", async () => {
  // given
  const f = fixture();
  const alternate = join(f.root, "alternate");
  mkdirSync(alternate, { mode: 0o700 });
  const alias = join(alternate, f.input.runId);
  symlinkSync(join(f.root, f.input.runId), alias);
  try {
    // when
    const result = await captureSecurityStartupFailure({ ...f.input, directory: join(alias, "startup-diagnostics-attempt1"), command: f.command });
    // then
    assert.equal(result.outcome, "incomplete");
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test("given a readable run directory, when capture starts, then private logs are not written into public permissions", async () => {
  // given
  const f = fixture();
  chmodSync(join(f.input.directory, ".."), 0o755);
  try {
    // when
    const result = await captureSecurityStartupFailure({ ...f.input, command: f.command });
    // then
    assert.equal(result.outcome, "incomplete");
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test("given failed log collection after ownership validation, when capture is incomplete, then filtered native state remains private", async () => {
  // given
  const f = fixture();
  const command = (args, options) => args[0] === "inspect" ? f.command(args, options)
    : { status: 1, stdout: "ExamplePartial", stderr: "ExampleSecret" };
  try {
    // when
    const result = await captureSecurityStartupFailure({ ...f.input, command });
    // then
    assert.equal(result.outcome, "incomplete");
    assert.deepEqual(readdirSync(f.input.directory).sort(), ["failure-reason.json", "seeder-state.json"]);
    assert.equal(JSON.parse(readFileSync(join(f.input.directory, "seeder-state.json"), "utf8")).exitCode, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(f.input.directory, "failure-reason.json"), "utf8")),
      { name: "Error", message: "command-incomplete" }, "the refused log command is named, not its output");
    assert.equal(JSON.stringify(result).includes("ExampleSecret"), false);
  } finally { f.close(); }
});

test("given a successful bounded native capture, when its retained bytes are counted, then one aggregate evidence budget bounds all three files", async () => {
  // given
  const f = fixture();
  const command = (args, options) => args[0] === "inspect" ? f.command(args, options)
    : { status: 0, stdout: Buffer.alloc(122880, 120), stderr: Buffer.alloc(122880, 121) };
  try {
    // when
    const result = await captureSecurityStartupFailure({ ...f.input, command });
    // then
    assert.equal(result.outcome, "captured");
    assert.ok(readdirSync(f.input.directory).reduce((sum, name) => sum + statSync(join(f.input.directory, name)).size, 0) <= 262144);
  } finally { f.close(); }
});

test("given a capture command failure with private details, when capture fails, then it returns only a fixed incomplete result", async () => {
  // given
  const f = fixture();
  try {
    // when
    const result = await captureSecurityStartupFailure({ ...f.input, command: () => { throw new Error("ExampleSecret"); } });
    // then
    assert.equal(result.outcome, "incomplete");
    assert.equal(JSON.stringify(result).includes("ExampleSecret"), false);
  } finally { f.close(); }
});

for (const refusal of [{ exitCode: 1 }, { status: 1 }, { signal: "SIGKILL" }, { truncated: true },
  { timedOut: true }, { error: new Error("ExampleSecret") }]) {
  test("given a native command refusal, when capture receives partial bytes, then those bytes cannot establish complete evidence", async () => {
    // given
    const f = fixture();
    try {
      // when
      const result = await captureSecurityStartupFailure({ ...f.input,
        command: () => ({ stdout: JSON.stringify([f.runtime]), stderr: "", ...refusal }) });
      // then
      assert.equal(result.outcome, "incomplete");
      assert.equal(JSON.stringify(result).includes("ExampleSecret"), false);
    } finally { f.close(); }
  });
}

test("given a capture command that throws, when capture fails, then the private evidence keeps the reason and the result names only the step", async () => {
  // given
  const f = fixture();
  try {
    // when
    const result = await captureSecurityStartupFailure({ ...f.input, command: () => { throw new Error("ExampleSecret"); } });
    // then
    assert.equal(result.cause, "unexpected-failure", "the shared result names the kind of failure without its text");
    assert.equal(JSON.stringify(result).includes("ExampleSecret"), false);
    const reason = JSON.parse(readFileSync(join(f.input.directory, "failure-reason.json"), "utf8"));
    assert.deepEqual(reason, { name: "Error", message: "ExampleSecret" },
      "the private evidence must say why the capture is incomplete");
    assert.equal(statSync(join(f.input.directory, "failure-reason.json")).mode & 0o777, 0o600);
  } finally { f.close(); }
});

test("given native output over the bound, when capture fails, then the result names the bounded step", async () => {
  // given
  const f = fixture();
  const command = (args, options) => args[0] === "inspect" ? f.command(args, options)
    : { exitCode: 0, stdout: Buffer.alloc(200000), stderr: Buffer.alloc(0) };
  try {
    // when
    const result = await captureSecurityStartupFailure({ ...f.input, command });
    // then
    assert.equal(result.cause, "command-incomplete", "a step that failed on its own bound is named by that step's code");
  } finally { f.close(); }
});
