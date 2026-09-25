// A tab left open across a deployment is served its old shell by the old worker, so a plain reload
// would ask for the same missing chunk again; the newer worker has to take over first.
export async function recoverStaleDocument(): Promise<void> {
  const registration = "serviceWorker" in navigator
    ? await navigator.serviceWorker.getRegistration().catch(() => undefined)
    : undefined;
  if (registration) await registration.update().catch(() => undefined);
  const newer = registration?.waiting ?? await installed(registration?.installing ?? null);
  if (!newer) {
    window.location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
  newer.postMessage({ type: "SKIP_WAITING" });
}

function installed(worker: ServiceWorker | null): Promise<ServiceWorker | null> {
  if (!worker) return Promise.resolve(null);
  return new Promise((settle) => {
    function settled() {
      if (worker!.state !== "installed" && worker!.state !== "redundant") return false;
      worker!.removeEventListener("statechange", settled);
      settle(worker!.state === "installed" ? worker : null);
      return true;
    }
    if (!settled()) worker.addEventListener("statechange", settled);
  });
}
