import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { allocationLabel } from "../booking/allocationLabel";
import {
  api, type Allocation, type BookingCardLegendEntry, type BookingEligibility, type BookingGrid, type PublicCourt
} from "../api/client";
import { useReportedFailure } from "../failures/useReportedFailure";
import { Alert } from "../components/Alert";
import { LoadFailure } from "../components/LoadFailure";
import { useRetry } from "../failures/useRetry";
import { Button } from "../components/Button";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { BookingDialog, type BookingSelection } from "./BookingDialog";
import { CancellationDialog } from "./CancellationDialog";
import { contrastColor } from "./cardColors";
import {
  addDays, calendarDayNumber, dateInTimeZone, dateInTimeZoneValue, formatBookingTimeRange,
  formatDate, formatTime, isPastSlot, isValidZonedDateTime, parseDate, startOfWeek, timeToMinutes,
  weekDays, zonedDateTime
} from "../time/clubZone";
import { hoursOn } from "../time/openingHours";
import { dateTimeFormatter } from "../time/dateTimeFormatter";
import { violationMessage } from "../api/problem-message";

interface WeekViewProps {
  today?: Date;
  clock?: () => Date;
  canBook?: boolean;
  canChooseSeveralCourts?: boolean;
  offline?: boolean;
}

interface WeekData {
  grid: BookingGrid;
  courts: PublicCourt[];
  bookingCards: BookingCardLegendEntry[];
  days: Date[];
  allocations: Map<string, Allocation[]>;
}

interface LegendCard {
  id?: string | null;
  label: string;
  color: string;
}
const systemClock = () => new Date();

export function WeekView({ today, clock = systemClock, canBook = true,
  canChooseSeveralCourts = false, offline = false }: WeekViewProps) {
  const { t, i18n } = useTranslation();
  const [referenceInstant] = useState(() => today ?? clock());
  const [currentInstant, setCurrentInstant] = useState(referenceInstant);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>();
  const [data, setData] = useState<WeekData>();
  const { message: error, report, clear } = useReportedFailure();
  const { message: loadError, report: reportLoad, clear: clearLoad } = useReportedFailure();
  const [loadAttempt, retryLoad] = useRetry();
  const [success, setSuccess] = useState<string>();
  const [eligibility, setEligibility] = useState<BookingEligibility>();
  const { message: eligibilityError, report: reportEligibility, clear: clearEligibility } = useReportedFailure();
  const [bookingSelection, setBookingSelection] = useState<BookingSelection>();
  const [drag, setDrag] = useState<{ courtId: string; anchor: string; head: string }>();
  const [cancellation, setCancellation] = useState<Allocation>();
  const planRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const dayNavigationRef = useRef<HTMLElement>(null);
  const eligibilityRequest = useRef(0);
  const shownDate = useRef<string>(undefined);
  const scrolledToNowOn = useRef<string>(undefined);
  const memberMoved = useRef(false);

  useEffect(() => {
    let active = true;
    setData(undefined);
    clear();
    clearLoad();
    if (offline) return () => { active = false; };
    void Promise.all([api.bookingGrid(), api.courts(), api.bookingCardLegend()])
      .then(async ([grid, courts, currentBookingCards]) => {
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
          setData({ grid, courts, bookingCards: currentBookingCards, days,
            allocations: new Map(dailyAllocations) });
        }
      }).catch((failure: unknown) => {
      if (active) {
        reportLoad(failure);
      }
    });
    return () => { active = false; };
  }, [clear, clearLoad, loadAttempt, offline, referenceInstant, reportLoad, weekOffset]);

  useEffect(() => {
    if (!canBook || offline) {
      setEligibility(undefined);
      clearEligibility();
      return;
    }
    let active = true;
    setEligibility(undefined);
    clearEligibility();
    const refresh = () => {
      const request = ++eligibilityRequest.current;
      void api.bookingEligibility().then((current) => {
        if (active && request === eligibilityRequest.current) {
          setEligibility(current);
          clearEligibility();
        }
      }).catch((failure: unknown) => {
        if (active && request === eligibilityRequest.current) {
          setEligibility(undefined);
          reportEligibility(failure);
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
  }, [canBook, clearEligibility, offline, reportEligibility]);

  useEffect(() => {
    if (eligibilityError || eligibility?.violations.length) setBookingSelection(undefined);
  }, [eligibility, eligibilityError]);

  const remainingCounts = useMemo(() => data && data.courts.length > 0
    ? new Map(data.days.map((day) => [formatDate(day), remainingFreeSlots(day, data, currentInstant)] as const))
    : new Map<string, number>(), [data, currentInstant]);
  const hasCourts = (data?.courts.length ?? 0) > 0;
  const days = data?.days ?? [];
  const renderedWeekStart = days[0] ? formatDate(days[0]) : undefined;
  const selectedDay = days.find((day) => formatDate(day) === selectedDate);
  const selectedAllocations = useMemo(() => selectedDate ? data?.allocations.get(selectedDate) ?? [] : [],
    [selectedDate, data]);
  const grid = data?.grid;
  const daySlots = useMemo(() => selectedDay && grid ? slotsFor(selectedDay, grid) : [], [selectedDay, grid]);
  const outsideSlots = useMemo(() => selectedDate && grid
    ? slotsOutsideHours(selectedDate, daySlots, selectedAllocations, grid) : [],
  [selectedDate, daySlots, selectedAllocations, grid]);
  const isToday = selectedDate === dateInTimeZoneValue(currentInstant, data?.grid.timeZone);
  const currentTime = data ? formatTime(currentInstant.toISOString(), data.grid.timeZone) : undefined;
  const slots = useMemo(() => [...daySlots, ...outsideSlots].sort(), [daySlots, outsideSlots]);
  const slotStarts = useMemo(() => new Map(slots.map((slot) => [slot, selectedDate && grid
    ? Date.parse(zonedDateTime(selectedDate, slot, grid.timeZone)) : Number.NaN])), [slots, selectedDate, grid]);
  const isOutside = (slot: string) => outsideSlots.includes(slot);

  function isBookable(courtId: string, slot: string): boolean {
    if (!data || !selectedDate || isOutside(slot)) return false;
    if (isPastSlot(selectedDate, slot, data.grid.timeZone, currentInstant)) return false;
    return !isOccupied(selectedAllocations, courtId, slot, data.grid.timeZone);
  }

  function bookableSpan(courtId: string, anchor: string, head: string): string[] {
    const from = slots.indexOf(anchor);
    const to = slots.indexOf(head);
    if (from === -1 || to === -1) return [];
    const step = to >= from ? 1 : -1;
    const span: string[] = [];
    for (let index = from; step > 0 ? index <= to : index >= to; index += step) {
      if (!isBookable(courtId, slots[index])) break;
      if (data && exceedsTheBound((span.length + 1) * data.grid.slotMinutes)) break;
      span.push(slots[index]);
    }
    return step > 0 ? span : span.reverse();
  }

  function exceedsTheBound(minutes: number): boolean {
    const bound = eligibility?.maxBookingMinutes;
    return bound !== undefined && bound !== null && minutes > bound;
  }

  const dragSpan = drag ? bookableSpan(drag.courtId, drag.anchor, drag.head) : [];
  const language = i18n.resolvedLanguage ?? i18n.language;
  useEffect(() => {
    if (!drag) return;
    const finish = () => {
      setDrag(undefined);
      // A pointer that never left its cell is a click, and that path is also the keyboard's.
      if (drag.head !== drag.anchor && dragSpan.length > 0 && selectedDate && data) {
        setBookingSelection({ date: selectedDate, slot: dragSpan[0], courtId: drag.courtId,
          durationMinutes: dragSpan.length * data.grid.slotMinutes });
      }
    };
    window.addEventListener("pointerup", finish);
    return () => window.removeEventListener("pointerup", finish);
  });

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
      void refreshDate(selectedDate).catch((failure: unknown) => report(failure));
    };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [clock, data, refreshDate, report, selectedDate]);

  useEffect(() => {
    const moved = () => { memberMoved.current = true; };
    const events = ["pointerdown", "wheel", "touchstart", "keydown"] as const;
    for (const event of events) window.addEventListener(event, moved, { capture: true, passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, moved, { capture: true });
    };
  }, []);

  // A day the member chose is one they asked to see; only the plan's own first load must not move under them.
  useLayoutEffect(() => {
    if (shownDate.current === undefined || shownDate.current === selectedDate) return;
    memberMoved.current = false;
    scrolledToNowOn.current = undefined;
  }, [selectedDate]);

  // Before paint, so the grid never shows a position it is about to leave.
  useLayoutEffect(() => {
    if (!isToday || !currentSlot || !selectedDate || scrolledToNowOn.current === selectedDate) return;
    if (memberMoved.current) return;
    scrolledToNowOn.current = selectedDate;
    scrollToSlot(planRef.current, currentSlot);
  }, [currentSlot, isToday, selectedDate]);

  // Another day has no current time to scroll to.
  useEffect(() => {
    const changed = shownDate.current !== selectedDate;
    shownDate.current = selectedDate;
    if (!changed || isToday) return;
    scrollToStart(planRef.current);
  }, [selectedDate, isToday]);

  useEffect(() => {
    const navigation = dayNavigationRef.current;
    const section = sectionRef.current;
    if (!navigation || !section || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      section.style.setProperty("--week-navigation-height", `${navigation.offsetHeight}px`));
    observer.observe(navigation);
    return () => observer.disconnect();
  }, [hasCourts]);

  useEffect(() => {
    const activeDay = selectedDate
      ? dayNavigationRef.current?.querySelector(`[data-testid="day-selector-${selectedDate}"]`)
      : undefined;
    if (activeDay instanceof HTMLElement && typeof activeDay.scrollIntoView === "function") {
      activeDay.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [renderedWeekStart, selectedDate]);

  return <section ref={sectionRef} aria-labelledby="occupancy-heading" className="mt-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="occupancy-heading" data-testid="occupancy-heading" className="text-2xl font-bold">{t("week.title")}</h2>
        {days.length > 0 && hasCourts && <p className="text-muted text-sm">{formatWeekRange(days, language)}</p>}
      </div>
      {(!data || hasCourts) && <div className="desktop-week-controls flex gap-2">
        <input data-testid="week-date" type="date" value={selectedDate ?? ""} disabled={!data} onChange={(event) => selectDate(event.target.value)} aria-label={t("week.chooseDate")} className="desktop-week-date form-control rounded-lg border px-2" />
        <Button variant="secondary" type="button" data-testid="week-previous" onClick={() => setWeekOffset((offset) => offset - 1)} aria-label={t("week.previous")}>
          {t("week.previousShort")}
        </Button>
        <Button variant="secondary" type="button" data-testid="week-next" onClick={() => setWeekOffset((offset) => offset + 1)} aria-label={t("week.next")}>
          {t("week.nextShort")}
        </Button>
      </div>}
    </div>

    {data && hasCourts && <nav ref={dayNavigationRef} data-testid="mobile-week-navigation" className="week-day-navigation mt-5"
      aria-label={t("week.chooseDate")}>
      <div data-testid="mobile-week-days" className="week-day-list">
        <Button variant="secondary" type="button" data-testid="mobile-week-previous"
          className="mobile-week-control shrink-0 px-3" onClick={() => setWeekOffset((offset) => offset - 1)}
          aria-label={t("week.previous")}>‹</Button>
        {days.map((day) => {
          const date = formatDate(day);
          const count = remainingCounts.get(date) ?? 0;
          const freeCount = t("week.freeCount", { count });
          return <button
            key={date}
            type="button"
            data-testid={`day-selector-${date}`}
            aria-label={`${formatDayLong(day, language)}, ${freeCount}`}
            aria-pressed={selectedDate === date}
            className="week-day-option border-structural rounded-xl border px-3 py-2 text-left hover:border-(--club-primary) aria-pressed:border-(--club-primary) aria-pressed:bg-(--club-accent)/15"
            onClick={() => setSelectedDate(date)}
          >
            <span className="block text-sm font-semibold">{formatWeekday(day, language)}</span>
            <span className="text-muted font-value text-sm">{formatDayMonth(day, language)}</span>
            <span data-testid={`day-free-count-${date}`} data-free-count={count}
              className="text-muted mt-1 block text-xs">{freeCount}</span>
          </button>;
        })}
        <Button variant="secondary" type="button" data-testid="mobile-week-next"
          className="mobile-week-control shrink-0 px-3" onClick={() => setWeekOffset((offset) => offset + 1)}
          aria-label={t("week.next")}>›</Button>
      </div>
      <Button variant="secondary" type="button" data-testid="mobile-current-time" className="mobile-week-control shrink-0"
        onClick={() => isToday
          ? scrollToSlot(planRef.current, currentSlot)
          : selectDate(dateInTimeZoneValue(currentInstant, data.grid.timeZone))}>{t("week.nowShort")}</Button>
    </nav>}

    {offline && <Alert tone="warning" testId="court-plan-offline">{t("week.offline")}</Alert>}
    {!offline && loadError && <LoadFailure message={loadError} retry={retryLoad} />}
    {!offline && error && <Alert>{error}</Alert>}
    {success && <SuccessFeedback>{success}</SuccessFeedback>}
    {eligibilityError && <Alert testId="booking-eligibility-error">{eligibilityError}</Alert>}
    {eligibility && eligibility.violations.length > 0 && <Alert testId="booking-eligibility">
      <ul>
        {eligibility.violations.map((violation) => <li key={violation.code} data-code={violation.code}>
          {violationMessage(violation.code, violation.params, t)}
        </li>)}
      </ul>
    </Alert>}
    {!offline && !data && !error && <p className="mt-6" aria-live="polite">{t("status.loading")}</p>}
    {data && !hasCourts && <p data-testid="court-plan-empty" className="text-muted mt-6">{t("week.noCourtOpen")}</p>}
    {data && hasCourts && <div className="desktop-current-time mt-4 flex justify-end">
      <Button variant="secondary" type="button" data-testid="current-time" onClick={() => isToday
        ? scrollToSlot(planRef.current, currentSlot)
        : selectDate(dateInTimeZoneValue(currentInstant, data.grid.timeZone))}>{t("week.now")}</Button>
    </div>}
    {data && hasCourts && daySlots.length === 0 && slots.length > 0 && <p data-testid="day-closed-notice"
      className="text-muted mt-4">{t("week.closed")}</p>}
    {data && hasCourts && <div
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
          {data.courts.map((court) => <col key={court.id} data-testid={`court-column-${court.number}`} className="day-plan-court-column" />)}
        </colgroup>
        <thead className="surface-raised">
          <tr>
            <th scope="col" className="border-structural border-b px-4 py-3 text-left">{t("week.time")}</th>
            {data.courts.map((court) => {
              const courtName = court.name || t("court.number", { number: court.number });
              return <th key={court.id} data-testid={`court-heading-${court.number}`} scope="col"
                aria-label={courtName} className="border-structural border-b px-4 py-3 text-left">
                <span className="court-heading-full" aria-hidden="true">{courtName}</span>
                <span className="court-heading-compact" aria-hidden="true">{court.number}</span>
              </th>;
            })}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => {
            const visibleSlotStartsAt = slotStarts.get(slot) ?? Number.NaN;
            const past = visibleSlotStartsAt < currentInstant.getTime();
            const outside = isOutside(slot);
            return <tr key={slot} data-testid={`slot-row-${slot}`} data-slot={slot}
              data-state={outside ? "outside" : past ? "past" : "remaining"}
              className="day-plan-slot-row" style={{ "--slot-height": `${slotHeight}px` } as CSSProperties}>
            <th scope="row" data-testid={`slot-heading-${slot}`} className="font-value surface-panel border-structural whitespace-nowrap border-b px-3 text-left font-medium">
              {slot}
            </th>
            {data.courts.map((court) => renderCell(
              court, slot, selectedDate, visibleSlotStartsAt, selectedAllocations, data.grid.slotMinutes, data.grid.timeZone, language, t,
              () => {
                setSuccess(undefined);
                if (selectedDate) setBookingSelection({ date: selectedDate, slot, courtId: court.id });
              },
              (allocation) => {
                setSuccess(undefined);
                setCancellation(allocation);
              },
              past,
              outside,
              bookingAllowed,
              slot === slots[0],
              {
                selected: drag?.courtId === court.id && dragSpan.includes(slot),
                start: (pointerType: string) => pointerType === "mouse"
                  && setDrag({ courtId: court.id, anchor: slot, head: slot }),
                extend: () => setDrag((current) => current?.courtId === court.id
                  ? { ...current, head: slot } : current)
              }
            ))}
            </tr>;
          })}
        </tbody>
      </table>
      {isToday && currentTime && slots.length > 0 && <div
        data-testid="current-time-line"
        role="img"
        aria-label={t("week.currentTime", { time: currentTime })}
        className="current-time-line"
        style={{ top: `${48 + currentLineOffset(currentTime, slots, data.grid.slotMinutes, slotHeight)}px` }}
      />}
      {slots.length === 0 && <p data-testid="day-closed" className="text-muted px-4 py-6 text-center">{t("week.closed")}</p>}
    </div>}
    {data && hasCourts && <ul data-testid="court-plan-legend" className="text-muted mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label={t("week.legend")}>
      <li><span className="day-plan-legend free" aria-hidden="true" />{t("week.available")}</li>
      <li><span className="day-plan-legend own" aria-hidden="true" />{t("week.own")}</li>
      <li><span className="day-plan-legend unavailable" aria-hidden="true" />{t("week.unavailable")}</li>
      {hasGenericOccupancy(data) && <li>
        <span data-testid="legend-occupied" className="day-plan-legend occupied"
          aria-hidden="true" />{t("week.occupied")}
      </li>}
      {legendCards(data).map((card) => <li key={`${card.label}:${card.color}`}>
        <span data-testid={card.id ? `legend-card-${card.id}` : "legend-allocation-card"}
          className="day-plan-legend" aria-hidden="true"
          style={{ backgroundColor: card.color }} />{card.label}
      </li>)}
    </ul>}
    {bookingSelection && data && <BookingDialog
      selection={bookingSelection}
      grid={data.grid}
      courts={data.courts}
      allocations={data.allocations.get(bookingSelection.date) ?? []}
      canChooseSeveralCourts={canChooseSeveralCourts}
      maxBookingMinutes={eligibility?.maxBookingMinutes ?? undefined}
      closed={() => setBookingSelection(undefined)}
      created={async () => {
        setBookingSelection(undefined);
        setSuccess(t("booking.created"));
        try {
          await refreshDate(bookingSelection.date);
        } catch (failure) {
          report(failure);
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
        setSuccess(t("booking.cancelledSuccess"));
        try {
          await refreshDate(selectedDate);
        } catch (failure) {
          report(failure);
        }
      }}
    />}
  </section>;
}

function isOccupied(allocations: Allocation[], courtId: string, slot: string, timeZone: string): boolean {
  const minute = timeToMinutes(slot);
  return allocations.some((entry) => entry.courtId === courtId
    && timeToMinutes(formatTime(entry.startsAt, timeZone)) <= minute
    && timeToMinutes(formatTime(entry.endsAt, timeZone)) > minute);
}

function remainingFreeSlots(day: Date, data: WeekData, currentInstant: Date): number {
  const date = formatDate(day);
  const allocations = data.allocations.get(date) ?? [];
  return slotsFor(day, data.grid).reduce((count, slot) => {
    if (isPastSlot(date, slot, data.grid.timeZone, currentInstant)) return count;
    return count + data.courts.filter((court) =>
      !isOccupied(allocations, court.id, slot, data.grid.timeZone)
    ).length;
  }, 0);
}

function hasGenericOccupancy(data: WeekData): boolean {
  return data.bookingCards.some((card) => card.showGenericOccupancy)
    || [...data.allocations.values()].some((allocations) =>
      allocations.some((allocation) => allocation.showGenericOccupancy));
}

function legendCards(data: WeekData): LegendCard[] {
  const entries = new Map<string, LegendCard>();
  data.bookingCards.filter((card) => !card.showGenericOccupancy).forEach((card) => {
    entries.set(`${card.label}:${card.color}`, card);
  });
  for (const allocation of [...data.allocations.values()].flat()) {
    if (!allocation.showGenericOccupancy) {
      const key = `${allocation.cardLabel}:${allocation.cardColor}`;
      if (!entries.has(key)) {
        entries.set(key, { label: allocation.cardLabel, color: allocation.cardColor });
      }
    }
  }
  return [...entries.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function renderCell(
  court: PublicCourt,
  slot: string,
  date: string | undefined,
  visibleSlotStartsAt: number,
  allocations: Allocation[],
  slotMinutes: number,
  timeZone: string,
  locale: string,
  t: ReturnType<typeof useTranslation>["t"],
  book: () => void,
  cancel: (allocation: Allocation) => void,
  isPast: boolean,
  isOutside: boolean,
  canBook: boolean,
  isFirstVisibleSlot: boolean,
  drag: { selected: boolean; start: (pointerType: string) => void; extend: () => void }
) {
  const cellClass = "border-structural border-b";
  const allocation = allocations.find((entry) => entry.courtId === court.id
    && (formatTime(entry.startsAt, timeZone) === slot
      || (isFirstVisibleSlot && Date.parse(entry.startsAt) < visibleSlotStartsAt
        && Date.parse(entry.endsAt) > visibleSlotStartsAt)));
  if (allocation) {
    const visibleStartsAt = Number.isFinite(visibleSlotStartsAt)
      ? Math.max(Date.parse(allocation.startsAt), visibleSlotStartsAt)
      : Date.parse(allocation.startsAt);
    const duration = (Date.parse(allocation.endsAt) - visibleStartsAt) / 60_000;
    const startedBeforeVisibleSlot = Date.parse(allocation.startsAt) < visibleSlotStartsAt;
    const label = allocationLabel(allocation, t);
    const period = formatBookingTimeRange(allocation.startsAt, allocation.endsAt, locale, timeZone);
    const className = "day-plan-allocation h-full w-full rounded-md px-3 py-2 text-left font-semibold";
    const state = allocation.ownBooking ? "own" : allocation.showGenericOccupancy ? "occupied" : "card";
    const style = allocation.ownBooking
      ? { backgroundColor: "var(--cs-ball)", color: "var(--cs-shade)" }
      : { backgroundColor: allocation.cardColor, color: contrastColor(allocation.cardColor) };
    return <td key={court.id} rowSpan={Math.max(1, Math.ceil(duration / slotMinutes))} className={`${cellClass} p-2 align-top`}>
      {allocation.ownBooking && !isPast && !startedBeforeVisibleSlot ? <button
        type="button"
        data-testid="own-allocation"
        data-booking-id={allocation.bookingId}
        data-card-color={allocation.cardColor}
        data-state={state}
        aria-label={t("booking.cancelLabel", { label: `${label}, ${period}` })}
        onClick={() => cancel(allocation)}
        className={className}
        style={style}
      ><span className="block">{label}</span><span className="block text-xs">{period}</span></button> : <div role="img" aria-label={`${label}, ${period}`} data-testid={allocation.ownBooking ? "own-allocation" : "allocation"} data-card-color={allocation.cardColor} data-state={state} className={className} style={style}><span className="block">{label}</span><span className="block text-xs">{period}</span></div>}
    </td>;
  }
  const isCovered = isOccupied(allocations, court.id, slot, timeZone);
  const courtName = court.name || t("court.number", { number: court.number });
  if (isCovered) return null;
  if (isOutside) {
    return <td key={court.id} className={`${cellClass} day-plan-free-cell p-1`}>
      <div data-testid="outside-slot" data-date={date} data-court-number={court.number} data-slot={slot}
        data-state="outside" className="day-plan-slot day-plan-free-slot flex w-full items-center justify-center rounded-md px-2 text-sm">
        {t("week.outside")}
      </div>
    </td>;
  }
  const content = canBook ? <button
      type="button"
      data-testid="free-slot"
      data-date={date}
      data-court-number={court.number}
      data-slot={slot}
      disabled={isPast}
      data-state={isPast ? "past" : drag.selected ? "selected" : "free"}
      className="day-plan-slot day-plan-free-slot w-full rounded-md px-2 text-sm"
      aria-label={isPast ? t("week.pastLabel", { court: courtName, time: slot }) : t("booking.open", { court: courtName, time: slot })}
      onClick={book}
      onPointerDown={(event) => drag.start(event.pointerType)}
      onPointerEnter={drag.extend}
    >
      {isPast ? t("week.past") : t("week.available")}
    </button> : <div data-testid="free-slot" data-date={date} data-court-number={court.number} data-slot={slot} data-state={isPast ? "past" : "free"} className="day-plan-slot day-plan-free-slot flex w-full items-center justify-center rounded-md px-2 text-sm">
      {isPast ? t("week.past") : t("week.available")}
    </div>;
  return <td key={court.id} className={`${cellClass} day-plan-free-cell p-1`}>
    {content}
  </td>;
}

function currentLineOffset(currentTime: string, slots: string[], slotMinutes: number, slotHeight: number): number {
  const now = timeToMinutes(currentTime);
  const row = slots.findLastIndex((slot) => timeToMinutes(slot) <= now);
  if (row === -1) return 0;
  const into = Math.min(slotMinutes, now - timeToMinutes(slots[row]));
  return (row + into / slotMinutes) * slotHeight;
}

function scrollToSlot(plan: HTMLDivElement | null, slot?: string) {
  const target = slot ? plan?.querySelector(`[data-slot="${slot}"]`) : undefined;
  if (!plan || !(target instanceof HTMLElement)) return;
  if (window.getComputedStyle(plan).overflowY === "visible") {
    if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
    return;
  }
  plan.scrollTop += target.getBoundingClientRect().top - plan.getBoundingClientRect().top
    - (plan.clientHeight - target.clientHeight) / 2;
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
  const hours = hoursOn(grid, formatDate(day));
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

// A booking may lie where the hours in force that day do not open; the plan still shows it.
function slotsOutsideHours(date: string, open: string[], allocations: Allocation[], grid: BookingGrid): string[] {
  const step = grid.slotMinutes;
  const origin = open.length > 0 ? timeToMinutes(open[0]) % step : 0;
  const outside = new Set<string>();
  for (const allocation of allocations) {
    const startsOnDay = localDate(allocation.startsAt, grid.timeZone) === date;
    const endsOnDay = localDate(allocation.endsAt, grid.timeZone) === date;
    const from = startsOnDay ? timeToMinutes(formatTime(allocation.startsAt, grid.timeZone)) : 0;
    const to = endsOnDay ? timeToMinutes(formatTime(allocation.endsAt, grid.timeZone)) : 24 * 60;
    for (let minutes = from - ((from - origin) % step + step) % step; minutes < to; minutes += step) {
      const slot = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      if (!open.includes(slot) && isValidZonedDateTime(date, slot, grid.timeZone)) outside.add(slot);
    }
  }
  return [...outside];
}

function localDate(timestamp: string, timeZone: string): string | undefined {
  return dateInTimeZoneValue(new Date(timestamp), timeZone);
}

function formatWeekday(date: Date, language: string): string {
  return dateTimeFormatter(language, { weekday: "short" }).format(date);
}

function formatDayMonth(date: Date, language: string): string {
  return dateTimeFormatter(language, { day: "2-digit", month: "2-digit" }).format(date);
}

function formatDayLong(date: Date, language: string): string {
  return dateTimeFormatter(language, { weekday: "long", month: "long", day: "numeric" }).format(date);
}

function formatWeekRange(days: Date[], language: string): string {
  const formatter = dateTimeFormatter(language, { year: "numeric", month: "short", day: "numeric" });
  return `${formatter.format(days[0])} – ${formatter.format(days[6])}`;
}
