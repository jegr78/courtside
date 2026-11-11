// A first install passes through the waiting slot on its way to active; only a worker that replaces one is new.
export function holdsWaitingUpdate(
  registration: Pick<ServiceWorkerRegistration, "active" | "waiting"> | undefined
): boolean {
  return Boolean(registration?.waiting && registration.active);
}

type UpdatableWorker = Pick<ServiceWorker, "state" | "postMessage"> & {
  addEventListener(type: "statechange", listener: () => void, options?: AddEventListenerOptions): void;
};

export interface UpdatableRegistration {
  readonly active: object | null;
  readonly installing: UpdatableWorker | null;
  readonly waiting: UpdatableWorker | null;
  update(): Promise<unknown>;
  unregister(): Promise<boolean>;
}

interface ControllerChanges {
  readonly controller: object | null;
  addEventListener(type: "controllerchange", listener: () => void, options?: AddEventListenerOptions): void;
}

function within(work: Promise<unknown>, until: Promise<void>): Promise<unknown> {
  return Promise.race([work.catch(() => undefined), until]);
}

function installed(worker: UpdatableWorker | null): Promise<void> {
  if (worker?.state !== "installing") return Promise.resolve();
  return new Promise((settled) => worker.addEventListener("statechange", () => settled(), { once: true }));
}

export interface Replacement {
  // Offline, an unregistered worker would leave nothing to start the app from.
  unregisterWithoutWaiting: boolean;
  patienceMs?: number;
}

// A worker that finishes installing replaces the waiting one, so the confirmation waits for it.
export async function replaceInterface(registration: UpdatableRegistration | undefined, container: ControllerChanges,
  reload: () => void, { unregisterWithoutWaiting, patienceMs = 30_000 }: Replacement): Promise<void> {
  if (!registration) {
    reload();
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const patience = new Promise<void>((expired) => { timer = setTimeout(expired, patienceMs); });
  let installing: UpdatableWorker | null;
  try {
    await within(registration.update(), patience);
    installing = registration.installing;
    await within(installed(installing), patience);
  } finally {
    clearTimeout(timer);
  }
  if (installing?.state === "installing") throw new Error("The newest build is still installing");
  const waiting = registration.waiting ?? (installing?.state === "installed" ? installing : null);
  if (!waiting) {
    const controlledByActive = registration.active === container.controller;
    if (unregisterWithoutWaiting && controlledByActive) await registration.unregister().catch(() => false);
    reload();
    return;
  }
  container.addEventListener("controllerchange", reload, { once: true });
  // A window the worker does not control yet gets no controllerchange.
  setTimeout(reload, 10_000);
  waiting.postMessage({ type: "SKIP_WAITING" });
}
