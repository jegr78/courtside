// A first install passes through the waiting slot on its way to active; only a worker that replaces one is new.
export function holdsWaitingUpdate(
  registration: Pick<ServiceWorkerRegistration, "active" | "waiting"> | undefined
): boolean {
  return Boolean(registration?.waiting && registration.active);
}
