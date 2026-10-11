import type { Api } from "./api";
import { occupying } from "./core.mjs";
import { instantOf, type Slot } from "./lanes";

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

export async function sweep(admin: Api, slots: Slot[]) {
  const courts = await (await admin.get("/api/public/courts")).json() as { id: string; number: number }[];
  const removed: { journey: string; id: string; status: number }[] = [];
  const left: { journey: string; id: string }[] = [];
  for (const slot of slots) {
    const courtId = courts.find((c) => c.number === slot.court)!.id;
    const read = async () => occupying(await (await admin.get(`/api/bookings?date=${slot.date}`)).json(), courtId,
      instantOf(slot, "start"), instantOf(slot, "end"));
    for (const id of await read()) removed.push({ journey: slot.journey, id, status: await cancelAny(admin, id) });
    left.push(...(await read()).map((id) => ({ journey: slot.journey, id })));
  }
  return { removed, left };
}
