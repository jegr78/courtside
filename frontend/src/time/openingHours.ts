import type { BookingGrid, CourtClosure, DayOfWeek, OpeningHours, OpeningPeriod } from "../api/client";

const dayNames: DayOfWeek[] = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

export function weekdayOf(date: string): DayOfWeek {
  return dayNames[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export function hoursOn(grid: BookingGrid, date: string): OpeningHours | undefined {
  const day = weekdayOf(date);
  const period = periodOn(grid, "HOLIDAY", date) ?? periodOn(grid, "SEASON", date);
  if (period) return period.days.find((hours) => hours.dayOfWeek === day);
  if (grid.openingWeeks.length === 0) return grid.openingHours.find((hours) => hours.dayOfWeek === day);
  const governing = grid.openingWeeks
    .filter((week) => week.effectiveFrom === null || week.effectiveFrom <= date)
    .reduce<BookingGrid["openingWeeks"][number] | undefined>((latest, week) =>
      latest === undefined || (week.effectiveFrom ?? "") >= (latest.effectiveFrom ?? "") ? week : latest, undefined);
  return governing?.days.find((hours) => hours.dayOfWeek === day);
}

export function periodOn(grid: BookingGrid, kind: OpeningPeriod["kind"], date: string): OpeningPeriod | undefined {
  return grid.openingPeriods.find((period) => period.kind === kind && period.startsOn <= date && date <= period.endsOn);
}

export function closureOn(grid: BookingGrid, courtId: string, date: string): CourtClosure | undefined {
  return grid.courtClosures.find((closure) => closure.courtId === courtId && closure.startsOn <= date && date <= closure.endsOn);
}
