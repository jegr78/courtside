import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { waitForProcessMarker } from "./global-setup";

function processWithOutput(): { client: ChildProcess; output: PassThrough } {
  const output = new PassThrough();
  const client = Object.assign(new EventEmitter(), { stdout: output }) as unknown as ChildProcess;
  return { client, output };
}

describe("process marker coordination", () => {
  it("given a marker split across process output, when it arrives, then coordination completes without polling", async () => {
    // given
    const { client, output } = processWithOutput();
    const waiting = waitForProcessMarker(client, "LOCK_READY", () => "");

    // when
    output.write("LOCK_");
    output.write("READY\n");

    // then
    await expect(waiting).resolves.toBeUndefined();
  });

  it("given a process that stops before its marker, when coordinating, then exit diagnostics are retained", async () => {
    // given
    const { client } = processWithOutput();
    const waiting = waitForProcessMarker(client, "LOCK_READY", () => "psql failed");

    // when
    client.emit("exit", 2, null);

    // then
    await expect(waiting).rejects.toThrow("code 2 and signal none: psql failed");
  });

  it("given an abandoned command, when its request is cancelled, then the process and listeners are released", async () => {
    // given
    const { client, output } = processWithOutput();
    const kill = vi.fn().mockImplementation(() => {
      queueMicrotask(() => client.emit("exit", null, "SIGTERM"));
      return true;
    });
    client.kill = kill;
    const controller = new AbortController();
    const waiting = waitForProcessMarker(client, "LOCK_READY", () => "still starting", controller.signal);

    // when
    controller.abort();

    // then
    await expect(waiting).rejects.toThrow("Database lock acquisition was cancelled: still starting");
    expect(kill).toHaveBeenCalledOnce();
    expect(output.listenerCount("data")).toBe(0);
    expect(client.listenerCount("error")).toBe(0);
    expect(client.listenerCount("exit")).toBe(0);
  });

  it("given a child that cannot be signalled, when its request is cancelled, then termination failure is explicit", async () => {
    // given
    const { client } = processWithOutput();
    client.kill = vi.fn().mockReturnValue(false);
    const controller = new AbortController();
    const waiting = waitForProcessMarker(client, "LOCK_READY", () => "docker unavailable", controller.signal);

    // when
    controller.abort();

    // then
    await expect(waiting).rejects.toThrow("Database lock client could not be terminated: docker unavailable");
  });
});
