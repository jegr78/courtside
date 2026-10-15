import { apiAs } from "./api";
import type { PersonaKey } from "./context";
import { instantOf, type Slot } from "./lanes";

type Entry = { id: string; startsAt: string; state: string };
const OPEN = ["WAITING", "OFFERED"];

export const MEMBERS = ["memberA", "memberB", "memberC"] as const satisfies readonly PersonaKey[];

export async function openWaitlistEntries(key: PersonaKey, slots: Slot[]): Promise<Entry[]> {
  const starts = new Set(slots.map((slot) => instantOf(slot, "start").getTime()));
  const entries = await (await (await apiAs(key)).get("/api/my/waitlist")).json() as Entry[];
  return entries.filter((entry) => OPEN.includes(entry.state) && starts.has(Date.parse(entry.startsAt)));
}

// A member sees only their own entries, so the queue is left as that member and never through the admin.
export async function leaveWaitlist(key: PersonaKey, slots: Slot[]) {
  const api = await apiAs(key);
  for (const entry of await openWaitlistEntries(key, slots)) await api.del(`/api/my/waitlist/${entry.id}`);
}

export async function unreadNotifications(key: PersonaKey): Promise<number> {
  return (await (await (await apiAs(key)).get("/api/account/notifications?limit=1")).json() as { unread: number }).unread;
}

export async function latestNotificationKinds(key: PersonaKey, since: Date): Promise<string[]> {
  const page = await (await (await apiAs(key)).get("/api/account/notifications?limit=20")).json() as { items: { kind: string; createdAt: string }[] };
  return page.items.filter((item) => Date.parse(item.createdAt) >= since.getTime()).map((item) => item.kind);
}
