import { describe, expect, it } from "vitest";
import { awaitReadiness, readinessBudget, type ReadinessWorld } from "./application-readiness";

function world(answers: boolean[], overrides: Partial<ReadinessWorld> = {}): {
  world: ReadinessWorld;
  paused: () => number;
} {
  let pauses = 0;
  let asked = 0;
  return {
    paused: () => pauses,
    world: {
      exitCode: () => null,
      probe: () => Promise.resolve(answers[asked++] ?? false),
      pause: () => {
        pauses += 1;
        return Promise.resolve();
      },
      ...overrides
    }
  };
}

describe("awaitReadiness", () => {
  it("given a server that answers before it is ready, when it starts slowly, then the wait keeps its budget", async () => {
    // given — a starting Courtside answers its own health endpoint with 503
    const { world: answering, paused } = world([false, false, false, true]);

    // when
    await awaitReadiness(answering, "http://localhost:1");

    // then
    expect(paused()).toBe(3);
  });

  it("given a server that never becomes ready, when the wait gives up, then it spent every interval", async () => {
    // given
    const { world: silent, paused } = world([]);

    // when / then
    await expect(awaitReadiness(silent, "http://localhost:1"))
      .rejects.toThrow("Courtside did not become ready");
    expect(paused()).toBe(readinessBudget.attempts);
  });

  it("given the application stops while starting, when the wait notices, then it names the exit code", async () => {
    // given
    const { world: stopped } = world([], { exitCode: () => 3 });

    // when / then
    await expect(awaitReadiness(stopped, "http://localhost:1")).rejects.toThrow("exit code 3");
  });
});
