import type { StatisticsRange } from "../../api/client";

export interface Period {
  from: string;
  to: string;
}

export const ROLLING_CHOICES = ["7d", "1m", "3m", "6m", "12m"] as const;
export type RollingChoice = typeof ROLLING_CHOICES[number];
export type QuickChoice = RollingChoice | "all" | "previousYear";

const MONTHS: Record<Exclude<RollingChoice, "7d">, number> = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parts(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);
  return [year, month, day];
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function utc(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function fromUtc(date: Date): string {
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function plusDays(date: string, days: number): string {
  const [year, month, day] = parts(date);
  return fromUtc(utc(year, month, day + days));
}

function daysInMonth(year: number, month: number): number {
  return utc(year, month + 1, 0).getUTCDate();
}

function minusMonths(date: string, months: number): string {
  const [year, month, day] = parts(date);
  const index = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index % 12 + 1;
  return iso(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

export function isIsoDate(value: string | null): value is string {
  if (value === null || !ISO_DATE.test(value)) return false;
  const [year, month, day] = parts(value);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function rollingPeriod(choice: RollingChoice, today: string): Period {
  if (choice === "7d") return { from: plusDays(today, -6), to: today };
  return { from: plusDays(minusMonths(today, MONTHS[choice]), 1), to: today };
}

export function previousCalendarYear(today: string): Period {
  const year = parts(today)[0] - 1;
  return { from: iso(year, 1, 1), to: iso(year, 12, 31) };
}

export function allTime(range: StatisticsRange): Period | undefined {
  if (range.firstBookingOn === null) return undefined;
  const from = range.firstBookingOn < range.today ? range.firstBookingOn : range.today;
  return { from, to: range.today };
}

export function quickPeriod(choice: QuickChoice, range: StatisticsRange): Period | undefined {
  if (choice === "all") return allTime(range);
  if (choice === "previousYear") return previousCalendarYear(range.today);
  return rollingPeriod(choice, range.today);
}

export function matchingChoice(period: Period, range: StatisticsRange | undefined): QuickChoice | undefined {
  if (!range) return undefined;
  const choices: QuickChoice[] = [...ROLLING_CHOICES, "previousYear", "all"];
  return choices.find((choice) => {
    const candidate = quickPeriod(choice, range);
    return candidate?.from === period.from && candidate.to === period.to;
  });
}

export function periodFromAddress(params: URLSearchParams): Period | undefined {
  const from = params.get("from");
  const to = params.get("to");
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return undefined;
  return { from, to };
}
