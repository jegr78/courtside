import type { SessionStatus } from "./api/client";

export const PERSONAL_BOOKINGS_CACHE = "courtside-personal-bookings";
export const PERSONAL_BOOKINGS_CONTROL_CACHE = "courtside-personal-bookings-control";
export const SESSION_CHANGE_CHANNEL = "courtside-session-change";
const PERSONAL_BOOKINGS_GENERATION = "/.courtside/personal-bookings-generation";
const PERSONAL_BOOKINGS_GENERATION_HEADER = "x-courtside-cache-generation";
let sessionChanges: BroadcastChannel | undefined;

export async function offlineMemberSession(): Promise<SessionStatus | undefined> {
  if (!("caches" in globalThis)) return undefined;
  const [cache, control] = await Promise.all([
    caches.open(PERSONAL_BOOKINGS_CACHE).catch(() => undefined),
    caches.open(PERSONAL_BOOKINGS_CONTROL_CACHE).catch(() => undefined)
  ]);
  const generation = await storedGeneration(control);
  if (!generation) {
    await caches.delete(PERSONAL_BOOKINGS_CACHE).catch(() => false);
    return undefined;
  }
  const keys = await cache?.keys().catch(() => []);
  const current = keys?.find((request) => {
    const url = new URL(request.url);
    return url.pathname === "/api/my/bookings" && url.searchParams.get("limit") === "50";
  });
  const cached = current ? await cache?.match(current).catch(() => undefined) : undefined;
  if (!cached) return undefined;
  if (cached.headers.get(PERSONAL_BOOKINGS_GENERATION_HEADER) !== generation) {
    await caches.delete(PERSONAL_BOOKINGS_CACHE).catch(() => false);
    return undefined;
  }
  const refreshedAt = await cached.clone().json()
    .then((page: { refreshedAt?: string }) => page.refreshedAt)
    .catch(() => undefined);
  const age = refreshedAt ? Date.now() - Date.parse(refreshedAt) : Number.NaN;
  const freshEnough = Number.isFinite(age) && age >= 0 && age <= 7 * 24 * 60 * 60 * 1_000;
  if (!freshEnough) {
    await clearPersonalBookingsOfflineData();
    return undefined;
  }
  const latestControl = await caches.open(PERSONAL_BOOKINGS_CONTROL_CACHE).catch(() => undefined);
  if (await storedGeneration(latestControl) !== generation) return undefined;
  return { authenticated: true, roles: ["MEMBER"], passwordChangeRequired: false };
}

export async function clearPersonalBookingsOfflineData(): Promise<void> {
  if (!("caches" in globalThis)) return;
  const control = await caches.open(PERSONAL_BOOKINGS_CONTROL_CACHE).catch(() => undefined);
  await control?.delete(PERSONAL_BOOKINGS_GENERATION).catch(() => false);
  await control?.put(PERSONAL_BOOKINGS_GENERATION, new Response(crypto.randomUUID())).catch(() => undefined);
  await caches.delete(PERSONAL_BOOKINGS_CACHE).catch(() => false);
}

export function notifyOtherClientsOfSessionChange(): void {
  sessionChanges?.postMessage("changed");
}

export function listenForOtherClientSessionChanges(changed: () => void): () => void {
  if (!("BroadcastChannel" in globalThis)) return () => undefined;
  const channel = sessionChanges ??= new BroadcastChannel(SESSION_CHANGE_CHANNEL);
  channel.addEventListener("message", changed);
  return () => {
    channel.removeEventListener("message", changed);
    channel.close();
    if (sessionChanges === channel) sessionChanges = undefined;
  };
}

async function storedGeneration(cache: Cache | undefined): Promise<string | undefined> {
  const marker = await cache?.match(PERSONAL_BOOKINGS_GENERATION).catch(() => undefined);
  return marker?.text().catch(() => undefined);
}
