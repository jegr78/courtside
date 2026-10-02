import type { SessionStatus } from "./api/client";

export const PERSONAL_BOOKINGS_CACHE = "courtside-personal-bookings";
export const PERSONAL_BOOKINGS_CONTROL_CACHE = "courtside-personal-bookings-control";
export const SESSION_CHANGE_CHANNEL = "courtside-session-change";
const PERSONAL_BOOKINGS_GENERATION = "/.courtside/personal-bookings-generation";
const PERSONAL_BOOKINGS_GENERATION_HEADER = "x-courtside-cache-generation";
let sessionChanges: BroadcastChannel | undefined;

interface OfflinePage {
  refreshedAt?: string;
  clubName?: string;
}

export interface OfflineMemberState {
  session: SessionStatus;
  clubName?: string;
}

export async function offlineMemberState(): Promise<OfflineMemberState | undefined> {
  const page = await offlinePage();
  if (!page) return undefined;
  const clubName = typeof page.clubName === "string" && page.clubName.trim() ? page.clubName : undefined;
  return { session: { authenticated: true, roles: ["MEMBER"], passwordChangeRequired: false }, clubName };
}

export async function offlineMemberSession(): Promise<SessionStatus | undefined> {
  return (await offlineMemberState())?.session;
}

async function offlinePage(): Promise<OfflinePage | undefined> {
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
  const page = await (cached.clone().json() as Promise<OfflinePage>).catch(() => undefined);
  const age = page?.refreshedAt ? Date.now() - Date.parse(page.refreshedAt) : Number.NaN;
  const freshEnough = Number.isFinite(age) && age >= 0 && age <= 7 * 24 * 60 * 60 * 1_000;
  if (!freshEnough) {
    await clearPersonalBookingsOfflineData();
    return undefined;
  }
  const latestControl = await caches.open(PERSONAL_BOOKINGS_CONTROL_CACHE).catch(() => undefined);
  if (await storedGeneration(latestControl) !== generation) return undefined;
  return page;
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
