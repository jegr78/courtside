import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Allocation, type BookingGrid, type PublicCourt } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";

interface WeekViewProps {
  today?: Date;
}

interface WeekData {
  grid: BookingGrid;
  courts: PublicCourt[];
  days: Date[];
  allocations: Map<string, Allocation[]>;
}

const dayNames = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

export function WeekView({ today = new Date() }: WeekViewProps) {
  const { t, i18n } = useTranslation();
  const [referenceInstant] = useState(today);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>();
  const [data, setData] = useState<WeekData>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    setData(undefined);
    setError(undefined);
    void Promise.all([api.bookingGrid(), api.courts()]).then(async ([grid, courts]) => {
      const clubToday = dateInTimeZone(referenceInstant, grid.timeZone);
      const weekStart = addDays(startOfWeek(clubToday), weekOffset * 7);
      const days = weekDays(weekStart);
      const dailyAllocations = await Promise.all(days.map(async (day) => [
        formatDate(day), await api.allocations(formatDate(day))
      ] as const));
      if (active) {
        setSelectedDate(weekOffset === 0 ? formatDate(clubToday) : formatDate(weekStart));
        setData({ grid, courts, days, allocations: new Map(dailyAllocations) });
      }
    }).catch((failure: unknown) => {
      if (active) {
        setError(problemMessage(failure, t));
      }
    });
    return () => { active = false; };
  }, [referenceInstant, t, weekOffset]);

  const days = data?.days ?? [];
  const selectedDay = days.find((day) => formatDate(day) === selectedDate);
  const selectedAllocations = selectedDate ? data?.allocations.get(selectedDate) ?? [] : [];
  const slots = selectedDay && data ? slotsFor(selectedDay, data.grid) : [];
  const language = i18n.resolvedLanguage ?? i18n.language;

  return <section aria-labelledby="occupancy-heading" className="mt-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="occupancy-heading" className="text-2xl font-bold text-slate-950">{t("week.title")}</h2>
        {days.length > 0 && <p className="text-sm text-slate-600">{formatWeekRange(days, language)}</p>}
      </div>
      <div className="flex gap-2">
        <Button type="button" data-testid="week-previous" onClick={() => setWeekOffset((offset) => offset - 1)} aria-label={t("week.previous")}>
          {t("week.previousShort")}
        </Button>
        <Button type="button" data-testid="week-next" onClick={() => setWeekOffset((offset) => offset + 1)} aria-label={t("week.next")}>
          {t("week.nextShort")}
        </Button>
      </div>
    </div>

    {data && <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {days.map((day) => {
        const date = formatDate(day);
        const count = data.allocations.get(date)?.length ?? 0;
        return <button
          key={date}
          type="button"
          aria-label={formatDayLong(day, language)}
          aria-pressed={selectedDate === date}
          className="rounded-xl border border-slate-200 px-3 py-2 text-left hover:border-(--club-primary) aria-pressed:border-(--club-primary) aria-pressed:bg-(--club-accent)/40"
          onClick={() => setSelectedDate(date)}
        >
          <span className="block text-sm font-semibold">{formatWeekday(day, language)}</span>
          <span className="text-sm text-slate-600">{formatDayMonth(day, language)}</span>
          <span className="mt-1 block text-xs text-slate-500">{t("week.bookingCount", { count })}</span>
        </button>;
      })}
    </div>}

    {error && <Alert>{error}</Alert>}
    {!data && !error && <p className="mt-6" aria-live="polite">{t("status.loading")}</p>}
    {data && <div data-testid="week-grid" data-week-offset={weekOffset} className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-slate-100">
          <tr>
            <th scope="col" className="border-b border-slate-200 px-4 py-3 text-left">{t("week.time")}</th>
            {data.courts.map((court) => <th
              key={court.id}
              scope="col"
              className="min-w-40 border-b border-slate-200 px-4 py-3 text-left"
            >{court.name || t("court.number", { number: court.number })}</th>)}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => <tr key={slot}>
            <th scope="row" className="whitespace-nowrap border-b border-slate-100 px-4 py-3 text-left font-medium">
              {slot}
            </th>
            {data.courts.map((court) => renderCell(court, slot, selectedAllocations, data.grid.slotMinutes, t("week.available")))}
          </tr>)}
        </tbody>
      </table>
      {slots.length === 0 && <p className="px-4 py-6 text-center text-slate-600">{t("week.closed")}</p>}
    </div>}
  </section>;
}

function renderCell(court: PublicCourt, slot: string, allocations: Allocation[], slotMinutes: number, available: string) {
  const allocation = allocations.find((entry) => entry.courtId === court.id && formatTime(entry.startsAt) === slot);
  if (allocation) {
    const duration = timeToMinutes(formatTime(allocation.endsAt)) - timeToMinutes(formatTime(allocation.startsAt));
    return <td key={court.id} rowSpan={Math.max(1, Math.ceil(duration / slotMinutes))} className="border-b border-slate-100 p-2 align-top">
      <div
        className="h-full rounded-lg px-3 py-2 font-semibold"
        style={{ backgroundColor: allocation.cardColor, color: contrastColor(allocation.cardColor) }}
      >{allocation.cardLabel}</div>
    </td>;
  }
  const minute = timeToMinutes(slot);
  const isCovered = allocations.some((entry) => entry.courtId === court.id
    && timeToMinutes(formatTime(entry.startsAt)) < minute
    && timeToMinutes(formatTime(entry.endsAt)) > minute);
  return isCovered ? null : <td key={court.id} className="border-b border-slate-100 p-2"><span className="sr-only">{available}</span></td>;
}

function dateInTimeZone(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(value("year"), value("month") - 1, value("day"));
}

function startOfWeek(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7));
}

function addDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function slotsFor(day: Date, grid: BookingGrid): string[] {
  const hours = grid.openingHours.find((entry) => entry.dayOfWeek === dayNames[day.getDay()]);
  if (!hours?.opensAt || !hours.closesAt) {
    return [];
  }
  const start = timeToMinutes(hours.opensAt);
  const end = timeToMinutes(hours.closesAt);
  return Array.from({ length: Math.ceil((end - start) / grid.slotMinutes) }, (_, index) => {
    const minutes = start + index * grid.slotMinutes;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  });
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatWeekday(date: Date, language: string): string {
  return new Intl.DateTimeFormat(language, { weekday: "short" }).format(date);
}

function formatDayMonth(date: Date, language: string): string {
  return new Intl.DateTimeFormat(language, { day: "2-digit", month: "2-digit" }).format(date);
}

function formatDayLong(date: Date, language: string): string {
  return new Intl.DateTimeFormat(language, { weekday: "long", month: "long", day: "numeric" }).format(date);
}

function formatWeekRange(days: Date[], language: string): string {
  const formatter = new Intl.DateTimeFormat(language, { year: "numeric", month: "short", day: "numeric" });
  return `${formatter.format(days[0])} – ${formatter.format(days[6])}`;
}

function formatTime(timestamp: string): string {
  return timestamp.slice(11, 16);
}

function contrastColor(color: string): string {
  const background = relativeLuminance(color);
  const dark = "#0f172a";
  const light = "#ffffff";
  return contrastRatio(background, relativeLuminance(dark)) >= contrastRatio(background, relativeLuminance(light))
    ? dark : light;
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
