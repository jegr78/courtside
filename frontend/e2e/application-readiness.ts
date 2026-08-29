const ATTEMPTS = 120;
const INTERVAL_MS = 500;

export interface ReadinessWorld {
  exitCode: () => number | null;
  signalCode: () => NodeJS.Signals | null;
  probe: () => Promise<boolean>;
  pause: (milliseconds: number) => Promise<void>;
}

// Every attempt costs its interval, including the ones the server answers. A starting Courtside
// replies 503 to its own health endpoint, and that answer must not be cheaper than no answer.
export async function awaitReadiness(world: ReadinessWorld, baseURL: string): Promise<void> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
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
  throw new Error(`Courtside did not become ready on ${baseURL} within`
    + ` ${(ATTEMPTS * INTERVAL_MS) / 1000} seconds.`);
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

export const readinessBudget = { attempts: ATTEMPTS, intervalMs: INTERVAL_MS };
