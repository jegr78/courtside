import { describe, expect, it } from "vitest";
import type { BookingGrid, DayOfWeek, OpeningHours } from "../api/client";
import { hoursOn } from "./openingHours";

const weekdays: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

function days(opensAt: string | null, closesAt: string | null): OpeningHours[] {
  return weekdays.map((dayOfWeek) => ({ dayOfWeek, opensAt, closesAt }));
}

function grid(weeks: BookingGrid["openingWeeks"], today = days("08:00:00", "22:00:00")): BookingGrid {
  return { timeZone: "Europe/Berlin", slotMinutes: 30, openingHours: today, openingWeeks: weeks };
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
});
