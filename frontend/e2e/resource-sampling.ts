export interface ResourceSampleSchedule {
  every(callback: () => void, intervalMs: number): unknown;
  cancel(handle: unknown): void;
}

const systemSchedule: ResourceSampleSchedule = {
  every: (callback, intervalMs) => setInterval(callback, intervalMs),
  cancel: (handle) => clearInterval(handle as NodeJS.Timeout)
};

export class ResourceSampling {
  private timer: unknown;
  private pending: Promise<void> | undefined;

  constructor(
    private readonly retainSample: () => Promise<void>,
    private readonly intervalMs: number,
    private readonly schedule: ResourceSampleSchedule = systemSchedule
  ) {}

  async start(): Promise<void> {
    await this.retainSample();
    this.resume();
  }

  observe(): void {
    if (this.pending) return;
    const observation = Promise.resolve()
      .then(this.retainSample)
      // Periodic samples improve the timeline, but an individual observation is not a lifecycle
      // boundary. The next explicit boundary sample proves whether every target is still observable.
      .catch(() => undefined)
      .finally(() => {
        if (this.pending === observation) this.pending = undefined;
      });
    this.pending = observation;
  }

  async pause(): Promise<void> {
    if (this.timer !== undefined) this.schedule.cancel(this.timer);
    this.timer = undefined;
    await this.pending;
  }

  async captureBoundary(): Promise<void> {
    await this.pause();
    // Boundary observations are authoritative: their failure must fail the reliability run.
    await this.retainSample();
  }

  resume(): void {
    if (this.timer !== undefined) return;
    this.timer = this.schedule.every(() => this.observe(), this.intervalMs);
  }
}
