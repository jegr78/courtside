import { dateInTimeZoneValue } from "../time/clubZone";

/** Sorts a range read into its club days; an entry belongs to every day it overlaps, as when each day was read alone. */
export function byDay<T extends { startsAt: string; endsAt: string }>(dates: string[], entries: T[], timeZone: string): Map<string, T[]> {
  const days = new Map(dates.map((date) => [date, [] as T[]]));
  for (const entry of entries) {
    const first = dateInTimeZoneValue(new Date(entry.startsAt), timeZone)!;
    const last = dateInTimeZoneValue(new Date(Date.parse(entry.endsAt) - 1), timeZone)!;
    for (const date of dates) if (first <= date && date <= last) days.get(date)!.push(entry);
  }
  return days;
}
