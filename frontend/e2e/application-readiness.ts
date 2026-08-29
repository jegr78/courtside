const ATTEMPTS = 120;
const INTERVAL_MS = 500;

export interface ReadinessWorld {
  exitCode: () => number | null;
  probe: () => Promise<boolean>;
  pause: (milliseconds: number) => Promise<void>;
}

// Every attempt costs its interval, including the ones the server answers. A starting Courtside
// replies 503 to its own health endpoint, and that answer must not be cheaper than no answer.
export async function awaitReadiness(world: ReadinessWorld, baseURL: string): Promise<void> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const exited = world.exitCode();
    if (exited !== null) {
      throw new Error(`Courtside stopped with exit code ${exited} while starting on ${baseURL}.`
        + " Its own output says why, above this line.");
    }
    if (await world.probe()) {
      return;
    }
    await world.pause(INTERVAL_MS);
  }
  throw new Error("Courtside did not become ready");
}

export const readinessBudget = { attempts: ATTEMPTS, intervalMs: INTERVAL_MS };
