import { describe, expect, it } from "vitest";
import type { BookingGrid, DayOfWeek, OpeningHours } from "../api/client";
import { closureOn, hoursOn } from "./openingHours";

const weekdays: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

function days(opensAt: string | null, closesAt: string | null): OpeningHours[] {
  return weekdays.map((dayOfWeek) => ({ dayOfWeek, opensAt, closesAt }));
}

function grid(weeks: BookingGrid["openingWeeks"], today = days("08:00:00", "22:00:00"),
  openingPeriods: BookingGrid["openingPeriods"] = [], courtClosures: BookingGrid["courtClosures"] = []): BookingGrid {
  return { timeZone: "Europe/Berlin", slotMinutes: 30, openingHours: today, openingWeeks: weeks, openingPeriods, courtClosures };
}

describe("hoursOn", () => {
  const schedule = grid([
    { id: "a", effectiveFrom: null, days: days("08:00:00", "22:00:00") },
    { id: "b", effectiveFrom: "2026-11-02", days: days("10:00:00", "18:00:00") }
  ]);

  it("given a later week, when reading the day before it starts, then the earlier week governs", () => {
    // when
    const hours = hoursOn(schedule, "2026-11-01");

    // then
    expect(hours).toEqual({ dayOfWeek: "SUNDAY", opensAt: "08:00:00", closesAt: "22:00:00" });
  });

  it("given a later week, when reading the day it starts, then that week governs", () => {
    // when
    const hours = hoursOn(schedule, "2026-11-02");

    // then
    expect(hours).toEqual({ dayOfWeek: "MONDAY", opensAt: "10:00:00", closesAt: "18:00:00" });
  });

  it("given no week at all, when reading a day, then the hours in force today answer", () => {
    // when
    const hours = hoursOn(grid([]), "2026-11-03");

    // then
    expect(hours).toEqual({ dayOfWeek: "TUESDAY", opensAt: "08:00:00", closesAt: "22:00:00" });
  });

  it("given only weeks starting later, when reading a day before all of them, then no hours answer", () => {
    // when
    const hours = hoursOn(grid([{ id: "b", effectiveFrom: "2026-11-02", days: days("10:00:00", "18:00:00") }]), "2026-11-01");

    // then
    expect(hours).toBeUndefined();
  });

  it("given a season, when reading a day inside it, then its hours replace the weekly ones", () => {
    // given
    const seasonal = grid(schedule.openingWeeks, undefined, [
      { id: "s", kind: "SEASON", name: "Winter", startsOn: "2026-11-01", endsOn: "2027-03-31", days: days("09:00:00", "20:00:00") }
    ]);

    // when
    const hours = hoursOn(seasonal, "2026-11-03");

    // then
    expect(hours).toEqual({ dayOfWeek: "TUESDAY", opensAt: "09:00:00", closesAt: "20:00:00" });
    expect(hoursOn(seasonal, "2027-04-01")?.opensAt).toBe("10:00:00");
  });

  it("given a closed holiday inside a season, when reading that day, then the holiday wins and the day is closed", () => {
    // given
    const festive = grid(schedule.openingWeeks, undefined, [
      { id: "h", kind: "HOLIDAY", name: "New Year", startsOn: "2027-01-01", endsOn: "2027-01-01", days: days(null, null) },
      { id: "s", kind: "SEASON", name: "Winter", startsOn: "2026-11-01", endsOn: "2027-03-31", days: days("09:00:00", "20:00:00") }
    ]);

    // when
    const hours = hoursOn(festive, "2027-01-01");

    // then
    expect(hours).toEqual({ dayOfWeek: "FRIDAY", opensAt: null, closesAt: null });
  });
});

describe("closureOn", () => {
  const closed = grid([], undefined, [], [
    { id: "c", courtId: "court-2", startsOn: "2026-06-01", endsOn: "2026-06-03" }
  ]);

  it("given a closure, when reading a court on one of its days, then the closure answers", () => {
    // when
    const closure = closureOn(closed, "court-2", "2026-06-03");

    // then
    expect(closure?.endsOn).toBe("2026-06-03");
  });

  it("given a closure, when reading another court or the day after, then nothing answers", () => {
    // when / then
    expect(closureOn(closed, "court-1", "2026-06-02")).toBeUndefined();
    expect(closureOn(closed, "court-2", "2026-06-04")).toBeUndefined();
  });
});
