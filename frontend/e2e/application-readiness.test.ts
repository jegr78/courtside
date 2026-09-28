import { describe, expect, it } from "vitest";
import { awaitReadiness, type ReadinessWorld } from "./application-readiness";

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

  it("given a live server that starts after the former minute boundary, when readiness arrives, then it keeps waiting", async () => {
    // given — the outer gate owns the deadline; this helper owns only readiness and process exit
    const { world: slow, paused } = world([...Array<boolean>(121).fill(false), true]);

    // when
    await awaitReadiness(slow, "http://localhost:1");

    // then
    expect(paused()).toHaveLength(121);
    expect(spent(paused())).toBe(60_500);
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
