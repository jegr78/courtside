import type { BookingGrid, DayOfWeek, OpeningHours } from "../api/client";

const dayNames: DayOfWeek[] = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

export function weekdayOf(date: string): DayOfWeek {
  return dayNames[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export function hoursOn(grid: BookingGrid, date: string): OpeningHours | undefined {
  const day = weekdayOf(date);
  if (grid.openingWeeks.length === 0) return grid.openingHours.find((hours) => hours.dayOfWeek === day);
  const governing = grid.openingWeeks
    .filter((week) => week.effectiveFrom === null || week.effectiveFrom <= date)
    .reduce<BookingGrid["openingWeeks"][number] | undefined>((latest, week) =>
      latest === undefined || (week.effectiveFrom ?? "") >= (latest.effectiveFrom ?? "") ? week : latest, undefined);
  return governing?.days.find((hours) => hours.dayOfWeek === day);
}
