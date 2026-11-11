import { replaceInterface, type Replacement } from "../components/waitingUpdate";

// A tab left open across a deployment is served its old shell by the old worker, so a plain reload
// would ask for the same missing chunk again; the newest worker has to take over first.
export async function recoverStaleDocument(replacement: Replacement = { unregisterWithoutWaiting: false }): Promise<void> {
  const container = "serviceWorker" in navigator ? navigator.serviceWorker : undefined;
  const registration = await container?.getRegistration().catch(() => undefined);
  await replaceInterface(registration, container ?? { addEventListener: () => undefined },
    () => window.location.reload(), replacement);
}
