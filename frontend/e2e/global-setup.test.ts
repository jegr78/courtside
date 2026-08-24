import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
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
});
