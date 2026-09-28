const INTERVAL_MS = 500;

export interface ReadinessWorld {
  exitCode: () => number | null;
  signalCode: () => NodeJS.Signals | null;
  probe: () => Promise<boolean>;
  pause: (milliseconds: number) => Promise<void>;
}

// Every attempt costs its interval, including the ones the server answers. A starting Courtside
// replies 503 to its own health endpoint, and that answer must not be cheaper than no answer.
// The hosted job owns the outer deadline; host load must not turn into a second inner failure.
export async function awaitReadiness(world: ReadinessWorld, baseURL: string): Promise<void> {
  for (;;) {
    const stop = stopReason(world);
    if (stop !== null) {
      throw new Error(`Courtside ${stop} while starting on ${baseURL}.`
        + " Its own output says why, above this line.");
    }
    if (await world.probe()) {
      return;
    }
    await world.pause(INTERVAL_MS);
  }
}

// A signalled process leaves exitCode null, so asking only for the code turns an out-of-memory
// kill into a wait that runs its full budget and then blames the clock.
function stopReason(world: ReadinessWorld): string | null {
  const exited = world.exitCode();
  if (exited !== null) {
    return `stopped with exit code ${exited}`;
  }
  const signal = world.signalCode();
  return signal === null ? null : `was killed by ${signal}`;
}
