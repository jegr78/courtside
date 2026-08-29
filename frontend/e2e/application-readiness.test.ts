import { describe, expect, it } from "vitest";
import { awaitReadiness, readinessBudget, type ReadinessWorld } from "./application-readiness";

function world(answers: boolean[], overrides: Partial<ReadinessWorld> = {}): {
  world: ReadinessWorld;
  paused: () => number[];
} {
  const pauses: number[] = [];
  let asked = 0;
  return {
    paused: () => pauses,
    world: {
      exitCode: () => null,
      signalCode: () => null,
      probe: () => Promise.resolve(answers[asked++] ?? false),
      pause: (milliseconds) => {
        pauses.push(milliseconds);
        return Promise.resolve();
      },
      ...overrides
    }
  };
}

function spent(pauses: number[]): number {
  return pauses.reduce((total, milliseconds) => total + milliseconds, 0);
}

describe("awaitReadiness", () => {
  it("given a server that answers before it is ready, when it starts slowly, then the wait keeps its budget", async () => {
    // given — a starting Courtside answers its own health endpoint with 503
    const { world: answering, paused } = world([false, false, false, true]);

    // when
    await awaitReadiness(answering, "http://localhost:1");

    // then
    expect(paused()).toEqual([500, 500, 500]);
  });

  it("given a server that never becomes ready, when the wait gives up, then it waited a full minute", async () => {
    // given
    const { world: silent, paused } = world([]);

    // when / then
    await expect(awaitReadiness(silent, "http://localhost:1"))
      .rejects.toThrow("did not become ready on http://localhost:1 within 60 seconds");
    expect(paused()).toHaveLength(readinessBudget.attempts);
    expect(spent(paused())).toBe(60_000);
  });

  it("given the application stops while starting, when the wait notices, then it names the exit code", async () => {
    // given
    const { world: stopped } = world([], { exitCode: () => 3 });

    // when / then
    await expect(awaitReadiness(stopped, "http://localhost:1")).rejects.toThrow("exit code 3");
  });

  it("given the application is killed while starting, when the wait notices, then it names the signal", async () => {
    // given — an out-of-memory kill leaves no exit code at all
    const { world: killed, paused } = world([], { signalCode: () => "SIGKILL" });

    // when / then
    await expect(awaitReadiness(killed, "http://localhost:1")).rejects.toThrow("killed by SIGKILL");
    expect(paused()).toEqual([]);
  });
});
