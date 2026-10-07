import assert from "node:assert/strict";
import { test } from "node:test";
import { containerIdentity, dockerIsRootless } from "./mail-relay-certificate.mjs";

function dockerInfo(stdout, status = 0) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    return { status, stdout, stderr: "" };
  };
  return { run, calls };
}

test("given a rootless Docker daemon, when asking for the container identity, then root maps to the host user", () => {
  // given
  const docker = dockerInfo('["name=seccomp,profile=builtin","name=rootless","name=cgroupns"]\n');

  // when
  const rootless = dockerIsRootless(docker.run);

  // then
  assert.equal(rootless, true);
  assert.deepEqual(docker.calls, [["docker", "info", "--format", "{{json .SecurityOptions}}"]]);
  assert.equal(containerIdentity({ getuid: () => 1001, getgid: () => 1001 }, rootless), "0:0",
    "under rootless Docker only container root is the host user that owns the private files");
});

test("given a rootful Docker daemon, when asking for the container identity, then the host user is kept", () => {
  // given
  const docker = dockerInfo('["name=seccomp,profile=builtin","name=cgroupns"]\n');

  // when
  const rootless = dockerIsRootless(docker.run);

  // then
  assert.equal(rootless, false);
  assert.equal(containerIdentity({ getuid: () => 1001, getgid: () => 121 }, rootless), "1001:121");
});

test("given a Docker daemon that cannot be asked, when detecting rootless mode, then the host user is kept", () => {
  // when / then
  assert.equal(dockerIsRootless(dockerInfo("", 1).run), false);
  assert.equal(dockerIsRootless(() => ({ error: new Error("spawn docker ENOENT") })), false);
});
