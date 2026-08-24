import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Allocation, type BookingEligibility, type BookingGrid, type PublicCourt } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { BookingDialog, type BookingSelection } from "./BookingDialog";
import { CancellationDialog } from "./CancellationDialog";
import {
  addDays, calendarDayNumber, dateInTimeZone, dateInTimeZoneValue, formatBookingTimeRange,
  formatDate, formatTime, isPastSlot, isValidZonedDateTime, parseDate, startOfWeek, timeToMinutes, weekDays
} from "../time/clubZone";

interface WeekViewProps {
  today?: Date;
  clock?: () => Date;
  canBook?: boolean;
}

interface WeekData {
  grid: BookingGrid;
  courts: PublicCourt[];
  days: Date[];
  allocations: Map<string, Allocation[]>;
}

const dayNames = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const systemClock = () => new Date();

export function WeekView({ today, clock = systemClock, canBook = true }: WeekViewProps) {
  const { t, i18n } = useTranslation();
  const [referenceInstant] = useState(() => today ?? clock());
  const [currentInstant, setCurrentInstant] = useState(referenceInstant);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>();
  const [selectedCourtId, setSelectedCourtId] = useState<string>();
  const [data, setData] = useState<WeekData>();
  const [error, setError] = useState<string>();
  const [eligibility, setEligibility] = useState<BookingEligibility>();
  const [eligibilityError, setEligibilityError] = useState<string>();
  const [bookingSelection, setBookingSelection] = useState<BookingSelection>();
  const [cancellation, setCancellation] = useState<Allocation>();
  const planRef = useRef<HTMLDivElement>(null);
  const courtSelectorRef = useRef<HTMLDivElement>(null);
  const eligibilityRequest = useRef(0);
  const shownDate = useRef<string>(undefined);
  const [courtSelectorContinues, setCourtSelectorContinues] = useState(false);

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
        setSelectedDate((current) => current && days.some((day) => formatDate(day) === current)
          ? current
          : weekOffset === 0 ? formatDate(clubToday) : formatDate(weekStart));
        setSelectedCourtId((current) => courts.some((court) => court.id === current) ? current : courts[0]?.id);
        setData({ grid, courts, days, allocations: new Map(dailyAllocations) });
      }
    }).catch((failure: unknown) => {
      if (active) {
        setError(problemMessage(failure, t));
      }
    });
    return () => { active = false; };
  }, [referenceInstant, t, weekOffset]);

  useEffect(() => {
    if (!canBook) {
      setEligibility(undefined);
      setEligibilityError(undefined);
      return;
    }
    let active = true;
    setEligibility(undefined);
    setEligibilityError(undefined);
    const refresh = () => {
      const request = ++eligibilityRequest.current;
      void api.bookingEligibility().then((current) => {
        if (active && request === eligibilityRequest.current) {
          setEligibility(current);
          setEligibilityError(undefined);
        }
      }).catch((failure: unknown) => {
        if (active && request === eligibilityRequest.current) {
          setEligibility(undefined);
          setEligibilityError(problemMessage(failure, t));
        }
      });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [canBook, t]);

  useEffect(() => {
    if (eligibilityError || eligibility?.violations.length) setBookingSelection(undefined);
  }, [eligibility, eligibilityError]);

  const days = data?.days ?? [];
  const selectedDay = days.find((day) => formatDate(day) === selectedDate);
  const selectedAllocations = selectedDate ? data?.allocations.get(selectedDate) ?? [] : [];
  const slots = selectedDay && data ? slotsFor(selectedDay, data.grid) : [];
  const language = i18n.resolvedLanguage ?? i18n.language;
  const courtCount = data?.courts.length ?? 0;
  const isToday = selectedDate === dateInTimeZoneValue(currentInstant, data?.grid.timeZone);
  const currentTime = data ? formatTime(currentInstant.toISOString(), data.grid.timeZone) : undefined;
  const slotHeight = data ? Math.max(32, data.grid.slotMinutes * 4 / 3) : 40;
  const currentSlot = currentTime && (slots.find((slot) => slot >= currentTime) ?? slots.at(-1));
  const bookingAllowed = canBook && eligibility?.violations.length === 0;

  function selectDate(value: string | undefined) {
    if (!value || !data) return;
    const referenceDate = dateInTimeZone(referenceInstant, data.grid.timeZone);
    const target = parseDate(value);
    const offset = Math.floor((calendarDayNumber(target) - calendarDayNumber(startOfWeek(referenceDate))) / 7);
    setSelectedDate(value);
    setWeekOffset(offset);
  }

  const refreshDate = useCallback(async (date: string) => {
    const allocations = await api.allocations(date);
    setData((current) => current ? {
      ...current,
      allocations: new Map(current.allocations).set(date, allocations)
    } : current);
  }, []);

  useEffect(() => {
    if (!selectedDate || !data) return;
    const refresh = () => {
      setCurrentInstant(clock());
      void refreshDate(selectedDate).catch((failure: unknown) => setError(problemMessage(failure, t)));
    };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [clock, data, refreshDate, selectedDate, t]);

  useEffect(() => {
    if (!isToday || !currentSlot) return;
    const frame = window.requestAnimationFrame(() => scrollToSlot(planRef.current, currentSlot));
    return () => window.cancelAnimationFrame(frame);
  }, [currentSlot, isToday]);

  useEffect(() => {
    const selector = courtSelectorRef.current;
    if (!selector) return;
    const update = () => setCourtSelectorContinues(
      selector.scrollLeft + selector.clientWidth < selector.scrollWidth - 1
    );
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [courtCount, language]);

  // Another day has no current time to scroll to.
  useEffect(() => {
    const changed = shownDate.current !== selectedDate;
    shownDate.current = selectedDate;
    if (!changed || isToday) return;
    scrollToStart(planRef.current);
  }, [selectedDate, isToday]);

  return <section aria-labelledby="occupancy-heading" className="mt-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="occupancy-heading" data-testid="occupancy-heading" className="text-2xl font-bold">{t("week.title")}</h2>
        {days.length > 0 && <p className="text-muted text-sm">{formatWeekRange(days, language)}</p>}
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

    {data && <div className="desktop-day-navigation mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {days.map((day) => {
        const date = formatDate(day);
        const count = data.allocations.get(date)?.length ?? 0;
        return <button
          key={date}
          type="button"
          data-testid={`day-selector-${date}`}
          aria-label={formatDayLong(day, language)}
          aria-pressed={selectedDate === date}
          className="border-structural rounded-xl border px-3 py-2 text-left hover:border-(--club-primary) aria-pressed:border-(--club-primary) aria-pressed:bg-(--club-accent)/15"
          onClick={() => setSelectedDate(date)}
        >
          <span className="block text-sm font-semibold">{formatWeekday(day, language)}</span>
          <span className="text-muted font-value text-sm">{formatDayMonth(day, language)}</span>
          <span className="text-muted mt-1 block text-xs">{t("week.bookingCount", { count })}</span>
        </button>;
      })}
    </div>}

    {data && <div className="mobile-day-navigation sticky top-0 z-10 mt-5 grid grid-cols-[auto_1fr_auto_auto] gap-2 surface-panel py-2">
      <Button type="button" data-testid="day-previous" className="button-secondary px-3" onClick={() => selectedDate && selectDate(formatDate(addDays(parseDate(selectedDate), -1)))} aria-label={t("week.previousDay")}>‹</Button>
      <input data-testid="selected-date" type="date" value={selectedDate ?? ""} onChange={(event) => selectDate(event.target.value)} aria-label={t("week.chooseDate")} className="form-control min-w-0 rounded-lg border px-2" />
      <Button type="button" data-testid="day-today" className="button-secondary px-3" onClick={() => selectDate(dateInTimeZoneValue(currentInstant, data.grid.timeZone))}>{t("week.today")}</Button>
      <Button type="button" data-testid="day-next" className="button-secondary px-3" onClick={() => selectedDate && selectDate(formatDate(addDays(parseDate(selectedDate), 1)))} aria-label={t("week.nextDay")}>›</Button>
    </div>}

    {data && data.courts.length > 1 && <div className="mobile-court-selector-frame surface-panel sticky top-0 z-10 mt-3">
      <div
        ref={courtSelectorRef}
        data-testid="court-selector"
        className="mobile-court-selector flex gap-2 overflow-x-auto py-2"
        role="group"
        aria-label={t("week.chooseCourt")}
        onScroll={() => {
          const selector = courtSelectorRef.current;
          if (selector) setCourtSelectorContinues(selector.scrollLeft + selector.clientWidth < selector.scrollWidth - 1);
        }}
      >
        {data.courts.map((court) => <Button
          key={court.id}
          type="button"
          data-testid={`court-selector-${court.number}`}
          className={selectedCourtId === court.id ? "" : "button-secondary"}
          aria-pressed={selectedCourtId === court.id}
          onClick={() => setSelectedCourtId(court.id)}
        >{court.name || t("court.number", { number: court.number })}</Button>)}
      </div>
      {courtSelectorContinues && <span data-testid="court-selector-continuation" className="mobile-court-selector-continuation" aria-hidden="true" />}
    </div>}

    {error && <Alert>{error}</Alert>}
    {eligibilityError && <Alert testId="booking-eligibility-error">{eligibilityError}</Alert>}
    {eligibility && eligibility.violations.length > 0 && <Alert testId="booking-eligibility">
      <ul>
        {eligibility.violations.map((violation) => <li key={violation.code} data-code={violation.code}>
          {t(violation.code, { ...violation.params, defaultValue: t("error.generic") })}
        </li>)}
      </ul>
    </Alert>}
    {!data && !error && <p className="mt-6" aria-live="polite">{t("status.loading")}</p>}
    {data && <div className="mt-4 flex justify-end">
      {isToday && <Button type="button" data-testid="current-time" className="button-secondary" onClick={() => scrollToSlot(planRef.current, currentSlot)}>{t("week.now")}</Button>}
    </div>}
    {data && <div
      ref={planRef}
      data-testid="week-grid"
      data-week-offset={weekOffset}
      tabIndex={0}
      className="day-plan border-structural relative mt-3 rounded-xl border"
      style={{ "--court-count": data.courts.length } as CSSProperties}
    >
      <table data-testid="day-plan-table" className={`day-plan-table border-collapse text-sm ${data.courts.length > 4 ? "day-plan-many-courts" : ""}`}>
        <colgroup>
          <col className="day-plan-time-column" />
          {data.courts.map((court) => <col key={court.id} data-testid={`court-column-${court.number}`} className={`day-plan-court-column ${selectedCourtId === court.id ? "" : "mobile-court-hidden"}`} />)}
        </colgroup>
        <thead className="surface-raised">
          <tr>
            <th scope="col" className="border-structural border-b px-4 py-3 text-left">{t("week.time")}</th>
            {data.courts.map((court) => <th
              key={court.id}
              data-testid={`court-heading-${court.number}`}
              scope="col"
              className={`border-structural border-b px-4 py-3 text-left ${selectedCourtId === court.id ? "" : "mobile-court-hidden"}`}
            >{court.name || t("court.number", { number: court.number })}</th>)}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => <tr key={slot} data-slot={slot} style={{ height: `${slotHeight}px` }}>
            <th scope="row" data-testid={`slot-heading-${slot}`} className="font-value surface-panel border-structural whitespace-nowrap border-b px-3 text-left font-medium">
              {slot}
            </th>
            {data.courts.map((court) => renderCell(
              court, slot, selectedDate, selectedAllocations, data.grid.slotMinutes, data.grid.timeZone, language, t,
              () => selectedDate && setBookingSelection({ date: selectedDate, slot, courtId: court.id }),
              setCancellation,
              selectedDate ? isPastSlot(selectedDate, slot, data.grid.timeZone, currentInstant) : false,
              bookingAllowed,
              selectedCourtId === court.id
            ))}
          </tr>)}
        </tbody>
      </table>
      {isToday && currentTime && slots.length > 0 && <div
        data-testid="current-time-line"
        role="img"
        aria-label={t("week.currentTime", { time: currentTime })}
        className="current-time-line"
        style={{ top: `${48 + currentLineOffset(currentTime, slots[0], data.grid.slotMinutes, slotHeight)}px` }}
      />}
      {slots.length === 0 && <p className="text-muted px-4 py-6 text-center">{t("week.closed")}</p>}
    </div>}
    {data && <ul data-testid="court-plan-legend" className="text-muted mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label={t("week.legend")}>
      <li><span className="day-plan-legend free" aria-hidden="true" />{t("week.available")}</li>
      <li><span className="day-plan-legend occupied" aria-hidden="true" />{t("week.occupied")}</li>
      <li><span className="day-plan-legend own" aria-hidden="true" />{t("week.own")}</li>
      <li><span className="day-plan-legend unavailable" aria-hidden="true" />{t("week.unavailable")}</li>
    </ul>}
    {bookingSelection && data && <BookingDialog
      selection={bookingSelection}
      grid={data.grid}
      courts={data.courts}
      allocations={data.allocations.get(bookingSelection.date) ?? []}
      closed={() => setBookingSelection(undefined)}
      created={async () => {
        setBookingSelection(undefined);
        try {
          await refreshDate(bookingSelection.date);
        } catch (failure) {
          setError(problemMessage(failure, t));
        }
      }}
      conflicted={() => refreshDate(bookingSelection.date)}
    />}
    {cancellation && selectedDate && data && <CancellationDialog
      allocation={cancellation}
      locale={language}
      timeZone={data.grid.timeZone}
      closed={() => setCancellation(undefined)}
      cancelled={async () => {
        setCancellation(undefined);
        try {
          await refreshDate(selectedDate);
        } catch (failure) {
          setError(problemMessage(failure, t));
        }
      }}
    />}
  </section>;
}

function renderCell(
  court: PublicCourt,
  slot: string,
  date: string | undefined,
  allocations: Allocation[],
  slotMinutes: number,
  timeZone: string,
  locale: string,
  t: ReturnType<typeof useTranslation>["t"],
  book: () => void,
  cancel: (allocation: Allocation) => void,
  isPast: boolean,
  canBook: boolean,
  isSelectedCourt: boolean
) {
  const cellClass = `border-structural border-b ${isSelectedCourt ? "" : "mobile-court-hidden"}`;
  const allocation = allocations.find((entry) => entry.courtId === court.id && formatTime(entry.startsAt, timeZone) === slot);
  if (allocation) {
    const duration = (Date.parse(allocation.endsAt) - Date.parse(allocation.startsAt)) / 60_000;
    const label = allocationLabel(allocation, t);
    const period = formatBookingTimeRange(allocation.startsAt, allocation.endsAt, locale, timeZone);
    const className = "h-full w-full rounded-md px-3 py-2 text-left font-semibold";
    const state = allocation.ownBooking ? "own" : allocation.showGenericOccupancy ? "occupied" : "card";
    const style = allocation.ownBooking
      ? { backgroundColor: "var(--cs-ball)", color: "var(--cs-shade)" }
      : { backgroundColor: allocation.cardColor, color: contrastColor(allocation.cardColor) };
    return <td key={court.id} rowSpan={Math.max(1, Math.ceil(duration / slotMinutes))} className={`${cellClass} p-2 align-top`}>
      {allocation.ownBooking && !isPast ? <button
        type="button"
        data-testid="own-allocation"
        data-booking-id={allocation.bookingId}
        data-card-color={allocation.cardColor}
        data-state={state}
        aria-label={t("booking.cancelLabel", { label: `${label}, ${period}` })}
        onClick={() => cancel(allocation)}
        className={className}
        style={style}
      ><span className="block">{label}</span><span className="block text-xs">{period}</span></button> : <div data-testid={allocation.ownBooking ? "own-allocation" : "allocation"} data-card-color={allocation.cardColor} data-state={state} className={className} style={style}><span className="block">{label}</span><span className="block text-xs">{period}</span></div>}
    </td>;
  }
  const minute = timeToMinutes(slot);
  const isCovered = allocations.some((entry) => entry.courtId === court.id
    && timeToMinutes(formatTime(entry.startsAt, timeZone)) < minute
    && timeToMinutes(formatTime(entry.endsAt, timeZone)) > minute);
  const courtName = court.name || t("court.number", { number: court.number });
  if (isCovered) return null;
  const content = canBook ? <button
      type="button"
      data-testid="free-slot"
      data-date={date}
      data-court-number={court.number}
      data-slot={slot}
      disabled={isPast}
      data-state={isPast ? "past" : "free"}
      className="day-plan-slot h-full w-full rounded-md px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--club-accent)"
      aria-label={isPast ? t("week.pastLabel", { court: courtName, time: slot }) : t("booking.open", { court: courtName, time: slot })}
      onClick={book}
    >
      {isPast ? t("week.past") : t("week.available")}
    </button> : <div data-testid="free-slot" data-date={date} data-court-number={court.number} data-slot={slot} data-state={isPast ? "past" : "free"} className="day-plan-slot flex h-full w-full items-center justify-center rounded-md px-2 text-sm">
      {isPast ? t("week.past") : t("week.available")}
    </div>;
  return <td key={court.id} className={`${cellClass} p-1`}>
    {content}
  </td>;
}

function allocationLabel(
  allocation: Allocation,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  if (allocation.ownBooking && allocation.showGenericOccupancy) {
    return [t("booking.viewer"), ...(allocation.participantLastNames ?? [])].join(", ");
  }
  if (!allocation.showGenericOccupancy) return allocation.cardLabel;
  return allocation.participantCount
    ? t("booking.occupiedWithParticipants", { count: allocation.participantCount })
    : t("booking.occupied");
}

function currentLineOffset(currentTime: string, opensAt: string, slotMinutes: number, slotHeight: number): number {
  return Math.max(0, (timeToMinutes(currentTime) - timeToMinutes(opensAt)) / slotMinutes * slotHeight);
}

function scrollToSlot(plan: HTMLDivElement | null, slot?: string) {
  const target = slot ? plan?.querySelector(`[data-slot="${slot}"]`) : undefined;
  if (target instanceof HTMLElement && typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ block: "center" });
  }
}

function scrollToStart(plan: HTMLDivElement | null) {
  if (!plan) return;
  if (window.getComputedStyle(plan).overflowY === "visible" && typeof plan.scrollIntoView === "function") {
    plan.scrollIntoView({ block: "start" });
    return;
  }
  if (typeof plan.scrollTo === "function") plan.scrollTo(0, 0);
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
  }).filter((time) => isValidZonedDateTime(formatDate(day), time, grid.timeZone));
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
