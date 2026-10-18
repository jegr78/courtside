import type { Api } from "./api";
import { occupying, sweepSlots } from "./core.mjs";
import { instantOf, type Slot } from "./lanes";
import { readLedger } from "./ledger";

type Allocation = { bookingId: string; courtId: string; startsAt: string; endsAt: string };

// A series occurrence is cancelled with its whole series, so later weeks outside the window do not linger.
async function cancelAny(admin: Api, id: string): Promise<number> {
  const detail = await admin.get(`/api/managed/bookings/${id}`);
  const seriesId = detail.ok() ? (await detail.json()).seriesId as string | null : null;
  if (seriesId) {
    const series = await admin.del(`/api/booking-series/${seriesId}?scope=WHOLE_SERIES&fromBookingId=${id}`);
    if (series.status() < 400 || series.status() === 404) return series.status();
  }
  return (await admin.del(`/api/bookings/${id}`)).status();
}

const ownBookings = () => new Set(readLedger().flatMap((entry) => entry.kind === "booking" ? [entry.id] : entry.anchor ? [entry.anchor] : []));

export async function sweep(admin: Api, slots: Slot[]) {
  const courts = await (await admin.get("/api/public/courts")).json() as { id: string; number: number }[];
  // One read per day: a read per slot spends the admin's request budget the next page then finds exhausted.
  const days = new Map<string, Promise<Allocation[]>>();
  const day = (date: string) => days.get(date) ?? days.set(date, admin.get(`/api/bookings?date=${date}`).then((answer) => answer.json())).get(date)!;
  return sweepSlots({
    slots, ours: ownBookings(),
    read: async (slot: Slot) => occupying(await day(slot.date),
      courts.find((c) => c.number === slot.court)!.id, instantOf(slot, "start"), instantOf(slot, "end")),
    cancel: (id: string) => { days.clear(); return cancelAny(admin, id); }
  }) as Promise<{ removed: { journey: string; id: string; status: number }[]; left: { journey: string; id: string }[]; foreign: { journey: string; id: string }[] }>;
}
