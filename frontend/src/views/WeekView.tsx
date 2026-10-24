import { DateTimeInput } from "../components/DateTimeInput";
import { type CSSProperties, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { allocationLabel } from "../booking/allocationLabel";
import { shortLabels } from "../booking/shortLabels";
import { byDay } from "../booking/byDay";
import {
  api, type Allocation, type BookingCardLegendEntry, type BookingEligibility, type BookingGrid, type Dependant, type PublicCourt,
  type ReservedSlot
} from "../api/client";
import { warnAbout } from "../api/failureWarning";
import { useReportedFailure } from "../failures/useReportedFailure";
import { Alert } from "../components/Alert";
import { LoadFailure } from "../components/LoadFailure";
import { useRetry } from "../failures/useRetry";
import { Button } from "../components/Button";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { BookingDialog, type BookingSelection, type WaitlistSelection } from "./BookingDialog";
import { CancellationDialog } from "./CancellationDialog";
import { contrastColor } from "./cardColors";
import {
  addDays, calendarDayNumber, dateInTimeZone, dateInTimeZoneValue, formatBookingTimeRange,
  formatDate, formatTime, isValidZonedDateTime, parseDate, startOfWeek, timeToMinutes,
  weekDays, zonedDateTime
} from "../time/clubZone";
import { closureOn, hoursOn, periodOn } from "../time/openingHours";
import { leavesBookingHours } from "../time/bookingHours";
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
  reservations: Map<string, PlanAllocation[]>;
}

// A court held for a waiting member occupies the plan like a booking and names nobody.
type PlanAllocation = Allocation & { reservation?: { ownEntryId?: string | null } };

const RESERVED_COLOR = "#5F6B7A";

interface LegendCard {
  id?: string | null;
  label: string;
  color: string;
}
interface AllocationBoundary {
  allocation: PlanAllocation;
  startsAtMinute: number;
  endsAtMinute: number;
}
interface GridSlot {
  time: string;
  startsAt: number;
}
interface DayPlanCellProps {
  court: PublicCourt;
  slot: string;
  date?: string;
  startsAt: number;
  allocations: AllocationBoundary[];
  grid: BookingGrid;
  locale: string;
  t: ReturnType<typeof useTranslation>["t"];
  shortLabelOf: Map<string, string>;
  book: (courtId: string, slot: string) => void;
  cancel: (allocation: Allocation) => void;
  queue: (allocation: Allocation) => void;
  past: boolean;
  outside: boolean;
  courtClosed: boolean;
  canBook: boolean;
  firstVisible: boolean;
  selected: boolean;
  beginDrag: (courtId: string, slot: string, pointerType: string) => void;
  extendDrag: (courtId: string, slot: string) => void;
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
  const [bookableDependants, setBookableDependants] = useState<Dependant[]>([]);
  const { message: eligibilityError, report: reportEligibility, clear: clearEligibility } = useReportedFailure();
  const [bookingSelection, setBookingSelection] = useState<BookingSelection>();
  const [waitlistSelection, setWaitlistSelection] = useState<{ selection: BookingSelection; period: WaitlistSelection }>();
  const [drag, setDrag] = useState<{ courtId: string; anchor: string; head: string }>();
  const dragAnchor = useRef<{ courtId: string; anchor: string }>(undefined);
  const [cancellation, setCancellation] = useState<Allocation>();
  const planRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const dayNavigationRef = useRef<HTMLElement>(null);
  const dayListRef = useRef<HTMLDivElement>(null);
  const eligibilityRequest = useRef(0);
  const dependantsRequest = useRef(0);
  const shownDate = useRef<string>(undefined);
  const scrolledToNowOn = useRef<string>(undefined);
  const memberMoved = useRef(false);

  useEffect(() => {
    let active = true;
    setData(undefined);
    clear();
    clearLoad();
    if (offline) return () => { active = false; };
    const browserWeek = addDays(startOfWeek(new Date(referenceInstant.getFullYear(), referenceInstant.getMonth(),
      referenceInstant.getDate())), weekOffset * 7);
    const range = { from: formatDate(addDays(browserWeek, -1)), to: formatDate(addDays(browserWeek, 7)) };
    void Promise.all([api.bookingGrid(range), api.courts(), api.bookingCardLegend()])
      .then(async ([grid, courts, currentBookingCards]) => {
        const clubToday = dateInTimeZone(referenceInstant, grid.timeZone);
        const weekStart = addDays(startOfWeek(clubToday), weekOffset * 7);
        const days = weekDays(weekStart);
        const dates = days.map(formatDate);
        const [weekAllocations, weekReservations] = await Promise.all([
          api.allocationsBetween(dates[0], dates[dates.length - 1]),
          reservationsBetween(dates[0], dates[dates.length - 1])
        ]);
        if (active) {
          setSelectedDate((current) => current && days.some((day) => formatDate(day) === current)
            ? current
            : weekOffset === 0 ? formatDate(clubToday) : formatDate(weekStart));
          setData({ grid, courts, bookingCards: currentBookingCards, days,
            allocations: byDay(dates, weekAllocations, grid.timeZone),
            reservations: byDay(dates, weekReservations, grid.timeZone) });
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
      setBookableDependants([]);
      clearEligibility();
      return;
    }
    let active = true;
    setEligibility(undefined);
    clearEligibility();
    const refresh = () => {
      const dependantsAsked = ++dependantsRequest.current;
      void api.dependants()
        .then((dependants) => {
          if (active && dependantsAsked === dependantsRequest.current) {
            setBookableDependants(dependants.filter((dependant) => dependant.grants.includes("BOOK")));
          }
        })
        .catch((failure: unknown) => warnAbout("Dependants unavailable", failure));
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

  const selfBookable = eligibility?.violations.length === 0;
  const bookingAllowed = canBook && (selfBookable || (eligibility !== undefined && bookableDependants.length > 0));
  useEffect(() => {
    if (!bookingAllowed) setBookingSelection(undefined);
  }, [bookingAllowed]);
  const ownLimits = selfBookable ? eligibility : undefined;

  const grid = data?.grid;
  const loadedDays = data?.days;
  const weekSlotGeometry = useMemo(() => {
    if (!grid || !loadedDays) return new Map<string, GridSlot[]>();
    const offsetsByInstant = new Map<string, number>();
    return new Map(loadedDays.map((day) => [formatDate(day), resolveGridSlots(day, grid, offsetsByInstant)]));
  }, [grid, loadedDays]);
  const allocationBoundaries = useMemo(() => data
    ? new Map([...data.allocations].map(([date, allocations]) => [date, [...allocations,
      ...(data.reservations.get(date) ?? [])].map((allocation) => ({
      allocation,
      startsAtMinute: timeToMinutes(formatTime(allocation.startsAt, data.grid.timeZone)),
      endsAtMinute: timeToMinutes(formatTime(allocation.endsAt, data.grid.timeZone))
    }))]))
    : new Map<string, AllocationBoundary[]>(), [data]);
  const remainingCounts = useMemo(() => data && data.courts.length > 0
    ? new Map(data.days.map((day) => [formatDate(day), remainingFreeSlots(data, formatDate(day), currentInstant,
      allocationBoundaries.get(formatDate(day)) ?? [], weekSlotGeometry.get(formatDate(day)) ?? [])] as const))
    : new Map<string, number>(), [data, currentInstant, allocationBoundaries, weekSlotGeometry]);
  const hasCourts = (data?.courts.length ?? 0) > 0;
  const shortLabelOf = useMemo(() => shortLabels(data
    ? [t("booking.viewer"), t("week.occupied"), t("week.reserved"),
      ...legendCards(data).map((card) => card.label)] : []), [data, t]);
  const days = loadedDays ?? [];
  const renderedWeekStart = days[0] ? formatDate(days[0]) : undefined;
  const selectedAllocations = useMemo(() => selectedDate
    ? [...data?.allocations.get(selectedDate) ?? [], ...data?.reservations.get(selectedDate) ?? []] : [],
  [selectedDate, data]);
  const selectedBoundaries = selectedDate ? allocationBoundaries.get(selectedDate) ?? [] : [];
  const selectedGridSlots = useMemo(() => selectedDate ? weekSlotGeometry.get(selectedDate) ?? [] : [],
    [selectedDate, weekSlotGeometry]);
  const daySlots = useMemo(() => selectedGridSlots.map((slot) => slot.time), [selectedGridSlots]);
  const outsideSlots = useMemo(() => selectedDate && grid
    ? slotsOutsideHours(selectedDate, daySlots, selectedAllocations, grid) : [],
  [selectedDate, daySlots, selectedAllocations, grid]);
  const isToday = selectedDate === dateInTimeZoneValue(currentInstant, data?.grid.timeZone);
  const holiday = selectedDate && grid ? periodOn(grid, "HOLIDAY", selectedDate) : undefined;
  const closures = useMemo(() => new Map(selectedDate && data
    ? data.courts.flatMap((court) => {
      const closure = closureOn(data.grid, court.id, selectedDate);
      return closure ? [[court.id, closure.endsOn] as const] : [];
    }) : []), [selectedDate, data]);
  const currentTime = data ? formatTime(currentInstant.toISOString(), data.grid.timeZone) : undefined;
  const slots = useMemo(() => [...daySlots, ...outsideSlots].sort(), [daySlots, outsideSlots]);
  const slotStarts = useMemo(() => new Map([
    ...selectedGridSlots.map((slot) => [slot.time, slot.startsAt] as const),
    ...outsideSlots.map((slot) => [slot, selectedDate && grid
      ? Date.parse(zonedDateTime(selectedDate, slot, grid.timeZone)) : Number.NaN] as const)
  ]), [selectedGridSlots, outsideSlots, selectedDate, grid]);
  const isOutside = (slot: string) => outsideSlots.includes(slot);
  const openBooking = useCallback((courtId: string, slot: string) => {
    setSuccess(undefined);
    if (selectedDate) setBookingSelection({ date: selectedDate, slot, courtId });
  }, [selectedDate]);
  const openCancellation = useCallback((allocation: Allocation) => {
    setSuccess(undefined);
    setCancellation(allocation);
  }, []);
  const timeZone = data?.grid.timeZone;
  const openWaitlist = useCallback((allocation: Allocation) => {
    setSuccess(undefined);
    if (selectedDate && timeZone) setWaitlistSelection({
      selection: { date: selectedDate, slot: formatTime(allocation.startsAt, timeZone), courtId: allocation.courtId },
      period: { startsAt: allocation.startsAt, endsAt: allocation.endsAt }
    });
  }, [selectedDate, timeZone]);
  const beginDrag = useCallback((courtId: string, slot: string, pointerType: string) => {
    if (pointerType === "mouse") dragAnchor.current = { courtId, anchor: slot };
  }, []);
  const extendDrag = useCallback((courtId: string, slot: string) => {
    const anchor = dragAnchor.current;
    if (anchor?.courtId === courtId && anchor.anchor !== slot) setDrag({ ...anchor, head: slot });
    else if (anchor?.courtId === courtId) setDrag(undefined);
  }, []);

  function isBookable(courtId: string, slot: string): boolean {
    if (!data || !selectedDate || isOutside(slot)) return false;
    const startsAt = slotStarts.get(slot);
    if (startsAt === undefined || startsAt < currentInstant.getTime()) return false;
    return !isOccupied(selectedBoundaries, courtId, slot);
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
      if (data && ownLimits?.bookingHours && leavesBookingHours(slots[index], data.grid.slotMinutes, ownLimits.bookingHours)) break;
      span.push(slots[index]);
    }
    return step > 0 ? span : span.reverse();
  }

  function exceedsTheBound(minutes: number): boolean {
    const bound = ownLimits?.maxBookingMinutes;
    return bound !== undefined && bound !== null && minutes > bound;
  }

  const dragSpan = drag ? bookableSpan(drag.courtId, drag.anchor, drag.head) : [];
  const language = i18n.resolvedLanguage ?? i18n.language;
  const calendarTimeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    const finish = () => {
      dragAnchor.current = undefined;
      if (!drag) return;
      setDrag(undefined);
      if (drag.head !== drag.anchor && dragSpan.length > 0 && selectedDate && data) {
        setBookingSelection({ date: selectedDate, slot: dragSpan[0], courtId: drag.courtId,
          durationMinutes: dragSpan.length * data.grid.slotMinutes });
      }
    };
    const cancel = () => {
      dragAnchor.current = undefined;
      if (drag) setDrag(undefined);
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
  });

  const slotHeight = data ? Math.max(32, data.grid.slotMinutes * 4 / 3) : 40;
  const currentSlot = currentTime && (slots.findLast((slot) => slot <= currentTime) ?? slots[0]);

  function selectDate(value: string | undefined) {
    if (!value || !data) return;
    const referenceDate = dateInTimeZone(referenceInstant, data.grid.timeZone);
    const target = parseDate(value);
    const offset = Math.floor((calendarDayNumber(target) - calendarDayNumber(startOfWeek(referenceDate))) / 7);
    setSelectedDate(value);
    setWeekOffset(offset);
  }

  const refreshDate = useCallback(async (date: string) => {
    const [allocations, reservations] = await Promise.all([api.allocations(date), reservationsOn(date)]);
    setData((current) => current ? {
      ...current,
      allocations: new Map(current.allocations).set(date, allocations),
      reservations: new Map(current.reservations).set(date, reservations)
    } : current);
    clear();
  }, [clear]);

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
    const now = currentInstant.getTime();
    let nextStart = Number.POSITIVE_INFINITY;
    for (const slots of weekSlotGeometry.values()) {
      for (const slot of slots) {
        if (slot.startsAt > now && slot.startsAt < nextStart) nextStart = slot.startsAt;
      }
    }
    if (!Number.isFinite(nextStart)) return;
    const timeout = window.setTimeout(() => setCurrentInstant(clock()), nextStart - now + 1);
    return () => window.clearTimeout(timeout);
  }, [clock, currentInstant, weekSlotGeometry]);

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

  useLayoutEffect(() => {
    const plan = planRef.current;
    if (!plan || !data || !isToday || !currentTime) return;
    const position = () => positionCurrentLine(plan, currentTime, data.grid.slotMinutes);
    position();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(position);
    const table = plan.querySelector("table");
    if (table) observer?.observe(table);
    window.addEventListener("resize", position);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
    };
  }, [data, currentTime, isToday, selectedDate]);

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

  const alignSelectedDay = useCallback(() => {
    const list = dayListRef.current;
    const activeDay = selectedDate ? list?.querySelector(`[data-testid="day-selector-${selectedDate}"]`) : undefined;
    if (list && activeDay instanceof HTMLElement) alignToItem(list, activeDay);
  }, [selectedDate]);

  useLayoutEffect(alignSelectedDay, [renderedWeekStart, alignSelectedDay]);

  useEffect(() => {
    const list = dayListRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      list.style.setProperty("--week-day-count", String(itemsThatFit(list)));
      alignSelectedDay();
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [hasCourts, alignSelectedDay]);

  return <section ref={sectionRef} aria-labelledby="occupancy-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 id="occupancy-heading" data-testid="occupancy-heading" className="text-3xl font-bold">{t("week.title")}</h1>
        {days.length > 0 && hasCourts && <p className="text-muted text-sm">{formatWeekRange(days, language, calendarTimeZone)}</p>}
      </div>
      {!offline && (!data || hasCourts) && <div className="desktop-week-controls flex gap-2">
        <span className="desktop-week-date"><DateTimeInput data-testid="week-date" type="date" value={selectedDate ?? ""} disabled={!data} onValueChange={(value) => selectDate(value)} aria-label={t("week.chooseDate")} className="form-control rounded-lg border px-2" /></span>
        <Button variant="secondary" type="button" data-testid="week-previous" onClick={() => setWeekOffset((offset) => offset - 1)} title={t("week.previous")}>
          {t("week.previousShort")}
        </Button>
        <Button variant="secondary" type="button" data-testid="week-next" onClick={() => setWeekOffset((offset) => offset + 1)} title={t("week.next")}>
          {t("week.nextShort")}
        </Button>
      </div>}
    </div>

    {data && hasCourts && <nav ref={dayNavigationRef} data-testid="mobile-week-navigation" className="week-day-navigation mt-5"
      aria-label={t("week.chooseDate")}>
      <div ref={dayListRef} data-testid="mobile-week-days" className="week-day-list">
        <Button variant="secondary" type="button" data-testid="mobile-week-previous"
          className="mobile-week-control week-step px-3" onClick={() => setWeekOffset((offset) => offset - 1)}
          aria-label={t("week.previous")}><span aria-hidden="true">‹</span> <span className="text-xs">{t("week.previous")}</span></Button>
        {days.map((day) => {
          const date = formatDate(day);
          const count = remainingCounts.get(date) ?? 0;
          const freeCount = t("week.freeCount", { count });
          return <button
            key={date}
            type="button"
            data-testid={`day-selector-${date}`}
            title={formatDayLong(day, language, calendarTimeZone)}
            aria-pressed={selectedDate === date}
            className="week-day-option border-structural rounded-xl border px-3 py-2 text-left hover:border-(--club-primary) aria-pressed:border-(--club-primary) aria-pressed:bg-(--club-accent)/15"
            onClick={() => setSelectedDate(date)}
          >
            <span className="block text-sm font-semibold">{formatWeekday(day, language, calendarTimeZone)}</span>{" "}
            <span className="text-muted font-value text-sm">{formatDayMonth(day, language, calendarTimeZone)}</span>{" "}
            <span data-testid={`day-free-count-${date}`} data-free-count={count}
              className="text-muted mt-1 block text-xs">{freeCount}</span>
          </button>;
        })}
        <Button variant="secondary" type="button" data-testid="mobile-week-next"
          className="mobile-week-control week-step px-3" onClick={() => setWeekOffset((offset) => offset + 1)}
          aria-label={t("week.next")}><span className="text-xs">{t("week.next")}</span> <span aria-hidden="true">›</span></Button>
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
    {data && hasCourts && holiday && <p data-testid="day-holiday-notice" data-period-id={holiday.id}
      className="text-muted mt-4">{t("week.holiday", { name: holiday.name })}</p>}
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
              const closedUntil = closures.get(court.id);
              return <th key={court.id} data-testid={`court-heading-${court.number}`} scope="col"
                data-closed-until={closedUntil}
                className="border-structural border-b px-4 py-3 text-left">
                <span className="sr-only">{closedUntil
                  ? t("week.courtClosedUntil", { court: courtName, endsOn: dateTimeFormatter(language, { dateStyle: "medium" }).format(parseDate(closedUntil)) }) : courtName}</span>
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
            {data.courts.map((court) => <DayPlanCell key={court.id}
              court={court} slot={slot} date={selectedDate} startsAt={visibleSlotStartsAt}
              allocations={selectedBoundaries} grid={data.grid} locale={language} t={t} shortLabelOf={shortLabelOf}
              book={openBooking} cancel={openCancellation} queue={openWaitlist} past={past} outside={outside}
              courtClosed={closures.has(court.id)}
              canBook={bookingAllowed} firstVisible={slot === slots[0]}
              selected={drag?.courtId === court.id && dragSpan.includes(slot)}
              beginDrag={beginDrag} extendDrag={extendDrag}
            />)}
            </tr>;
          })}
        </tbody>
      </table>
      {isToday && currentTime && slots.length > 0 && <div
        data-testid="current-time-line"
        role="img"
        aria-label={t("week.currentTime", { time: currentTime })}
        className="current-time-line"
        style={{ top: `${48 + unmeasuredLineOffset(currentTime, slots, data.grid.slotMinutes, slotHeight)}px` }}
      />}
      {slots.length === 0 && <p data-testid="day-closed" className="text-muted px-4 py-6 text-center">{t("week.closed")}</p>}
    </div>}
    {data && hasCourts && <ul data-testid="court-plan-legend" className="text-muted mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label={t("week.legend")}>
      <li><span className="day-plan-legend free" aria-hidden="true" />{t("week.available")}</li>
      <li><span data-testid="legend-own" className="day-plan-legend own" aria-hidden="true"><OwnMarker /></span>{t("week.own")}</li>
      <li><span className="day-plan-legend unavailable" aria-hidden="true" />{t("week.unavailable")}</li>
      {[...data.reservations.values()].some((reserved) => reserved.length > 0) && <li>
        <span data-testid="legend-reserved" className="day-plan-legend day-plan-legend-coded" aria-hidden="true"
          style={{ backgroundColor: RESERVED_COLOR, color: contrastColor(RESERVED_COLOR) }}>{shortLabelOf.get(t("week.reserved"))}</span>{t("week.reserved")}
      </li>}
      {hasGenericOccupancy(data) && <li>
        <span data-testid="legend-occupied" className="day-plan-legend day-plan-legend-coded occupied"
          aria-hidden="true" style={genericOccupancyStyle(data)}>{shortLabelOf.get(t("week.occupied"))}</span>{t("week.occupied")}
      </li>}
      {legendCards(data).map((card) => <li key={`${card.label}:${card.color}`}>
        <span data-testid={card.id ? `legend-card-${card.id}` : "legend-allocation-card"}
          className="day-plan-legend day-plan-legend-coded" aria-hidden="true"
          style={{ backgroundColor: card.color, color: contrastColor(card.color) }}>{shortLabelOf.get(card.label)}</span>{card.label}
      </li>)}
    </ul>}
    {bookingSelection && data && <BookingDialog
      selection={bookingSelection}
      grid={data.grid}
      courts={data.courts}
      allocations={data.allocations.get(bookingSelection.date) ?? []}
      canChooseSeveralCourts={canChooseSeveralCourts}
      maxBookingMinutes={ownLimits?.maxBookingMinutes ?? undefined}
      minBookingMinutes={ownLimits?.minBookingMinutes ?? undefined}
      maxWeeklyBookedHours={ownLimits?.maxWeeklyBookedHours ?? undefined}
      bookingHours={ownLimits?.bookingHours ?? undefined}
      dependants={bookableDependants}
      selfBookable={selfBookable}
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
    {waitlistSelection && data && <BookingDialog
      selection={waitlistSelection.selection}
      waitlist={waitlistSelection.period}
      grid={data.grid}
      courts={data.courts}
      allocations={[]}
      canChooseSeveralCourts={false}
      closed={() => setWaitlistSelection(undefined)}
      created={() => {
        setWaitlistSelection(undefined);
        setSuccess(t("waitlist.joined"));
        return Promise.resolve();
      }}
      conflicted={() => refreshDate(waitlistSelection.selection.date)}
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

const DayPlanCell = memo(function DayPlanCell(props: DayPlanCellProps) {
  const [pressed, setPressed] = useState<string>();
  const cell = `${props.date}:${props.court.id}:${props.slot}`;
  useEffect(() => {
    if (!pressed) return;
    const release = () => setPressed(undefined);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [pressed]);
  return renderCell(props.court, props.slot, props.date, props.startsAt, props.allocations,
    props.grid.slotMinutes, props.grid.timeZone, props.locale, props.t, props.shortLabelOf,
    () => props.book(props.court.id, props.slot), props.cancel, props.queue, props.past, props.outside, props.courtClosed,
    props.canBook, props.firstVisible, {
      selected: props.selected || pressed === cell,
      start: (pointerType) => {
        if (pointerType === "mouse") setPressed(cell);
        props.beginDrag(props.court.id, props.slot, pointerType);
      },
      extend: () => props.extendDrag(props.court.id, props.slot)
    });
});

function isOccupied(allocations: AllocationBoundary[], courtId: string, slot: string): boolean {
  const minute = timeToMinutes(slot);
  return allocations.some((entry) => entry.allocation.courtId === courtId
    && entry.startsAtMinute <= minute && entry.endsAtMinute > minute);
}

function remainingFreeSlots(data: WeekData, date: string, currentInstant: Date,
  allocations: AllocationBoundary[], slots: GridSlot[]): number {
  const openCourts = data.courts.filter((court) => !closureOn(data.grid, court.id, date));
  return slots.reduce((count, slot) => {
    if (slot.startsAt < currentInstant.getTime()) return count;
    return count + openCourts.filter((court) =>
      !isOccupied(allocations, court.id, slot.time)
    ).length;
  }, 0);
}

function hasGenericOccupancy(data: WeekData): boolean {
  return data.bookingCards.some((card) => card.showGenericOccupancy)
    || [...data.allocations.values()].some((allocations) =>
      allocations.some((allocation) => allocation.showGenericOccupancy));
}

function genericOccupancyStyle(data: WeekData): CSSProperties | undefined {
  const color = data.bookingCards.find((card) => card.showGenericOccupancy)?.color
    ?? [...data.allocations.values()].flat().find((allocation) => allocation.showGenericOccupancy && !allocation.ownBooking)?.cardColor;
  return color ? { backgroundColor: color, color: contrastColor(color) } : undefined;
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
  allocations: AllocationBoundary[],
  slotMinutes: number,
  timeZone: string,
  locale: string,
  t: ReturnType<typeof useTranslation>["t"],
  shortLabelOf: Map<string, string>,
  book: () => void,
  cancel: (allocation: Allocation) => void,
  queue: (allocation: Allocation) => void,
  isPast: boolean,
  isOutside: boolean,
  isCourtClosed: boolean,
  canBook: boolean,
  isFirstVisibleSlot: boolean,
  drag: { selected: boolean; start: (pointerType: string) => void; extend: () => void }
) {
  const cellClass = "border-structural border-b";
  const allocation = allocations.find((entry) => entry.allocation.courtId === court.id
    && (entry.startsAtMinute === timeToMinutes(slot)
      || (isFirstVisibleSlot && Date.parse(entry.allocation.startsAt) < visibleSlotStartsAt
        && Date.parse(entry.allocation.endsAt) > visibleSlotStartsAt)))?.allocation;
  if (allocation) {
    const visibleStartsAt = Number.isFinite(visibleSlotStartsAt)
      ? Math.max(Date.parse(allocation.startsAt), visibleSlotStartsAt)
      : Date.parse(allocation.startsAt);
    const duration = (Date.parse(allocation.endsAt) - visibleStartsAt) / 60_000;
    const startedBeforeVisibleSlot = Date.parse(allocation.startsAt) < visibleSlotStartsAt;
    const reservation = allocation.reservation;
    const label = reservation ? t(reservation.ownEntryId ? "week.reservedForYou" : "week.reserved") : allocationLabel(allocation, t);
    const shortLabel = reservation ? reservation.ownEntryId ? t("booking.viewer") : shortLabelOf.get(label) ?? label
      : allocation.ownBooking && allocation.showGenericOccupancy ? t("booking.viewer")
        : shortLabelOf.get(allocation.showGenericOccupancy ? t("week.occupied") : allocation.cardLabel) ?? label;
    const period = formatBookingTimeRange(allocation.startsAt, allocation.endsAt, locale, timeZone);
    const ownLabel = allocation.ownBooking && !allocation.showGenericOccupancy ? `${t("booking.viewer")}, ${label}` : label;
    const spokenLabel = `${ownLabel}, ${period}` + (allocation.ownBooking && allocation.showGenericOccupancy ? "" : `, ${shortLabel}`);
    const className = "day-plan-allocation h-full w-full rounded-md px-3 py-2 text-left font-semibold";
    const state = reservation ? "reserved" : allocation.ownBooking ? "own" : allocation.showGenericOccupancy ? "occupied" : "card";
    const style = allocation.ownBooking || reservation?.ownEntryId
      ? { backgroundColor: "var(--cs-ball)", color: "var(--cs-shade)" }
      : { backgroundColor: allocation.cardColor, color: contrastColor(allocation.cardColor) };
    const content = <span className="day-plan-allocation-body">
      <span className="day-plan-allocation-name">
        {(allocation.ownBooking || reservation?.ownEntryId) && <OwnMarker />}
        <span data-testid="allocation-label" className="day-plan-allocation-full">{label}</span>
        <span data-testid="allocation-short-label" className="day-plan-allocation-short">{shortLabel}</span>
      </span>{" "}
      <span data-testid="allocation-period" className="day-plan-allocation-period block text-xs">{period}</span>
    </span>;
    const ahead = !isPast && !startedBeforeVisibleSlot;
    return <td key={court.id} rowSpan={Math.max(1, Math.ceil(duration / slotMinutes))} className={`${cellClass} day-plan-allocation-cell p-2 align-top`}>
      <span data-testid="allocation-extent" aria-hidden="true" className="day-plan-allocation-extent" style={{ backgroundColor: style.backgroundColor }} />
      {reservation?.ownEntryId && ahead ? <a
        href={`/my-bookings#waitlist-${reservation.ownEntryId}`}
        data-testid="own-reservation"
        data-state={state}
        aria-label={t("waitlist.openOfferLabel", { label: spokenLabel })}
        className={`${className} focus-ring block no-underline`}
        style={style}
      >{content}</a> : allocation.ownBooking && !reservation && ahead ? <button
        type="button"
        data-testid="own-allocation"
        data-booking-id={allocation.bookingId}
        data-card-color={allocation.cardColor}
        data-state={state}
        aria-label={t("booking.cancelLabel", { label: spokenLabel })}
        onClick={() => cancel(allocation)}
        className={className}
        style={style}
      >{content}</button> : !allocation.ownBooking && !reservation?.ownEntryId && ahead && canBook ? <button
        type="button"
        data-testid="allocation"
        data-booking-id={reservation ? undefined : allocation.bookingId}
        data-card-color={allocation.cardColor}
        data-state={state}
        aria-label={t("waitlist.joinLabel", { label: spokenLabel })}
        onClick={() => queue(allocation)}
        className={className}
        style={style}
      >{content}</button> : <div role="img" aria-label={spokenLabel} data-testid={allocation.ownBooking ? "own-allocation" : "allocation"} data-booking-id={reservation ? undefined : allocation.bookingId} data-card-color={allocation.cardColor} data-state={state} className={className} style={style}>{content}</div>}
    </td>;
  }
  const isCovered = isOccupied(allocations, court.id, slot);
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
  if (isCourtClosed) {
    return <td key={court.id} className={`${cellClass} day-plan-free-cell p-1`}>
      <div data-testid="closed-court-slot" data-date={date} data-court-number={court.number} data-slot={slot}
        data-state="closed" className="day-plan-slot day-plan-free-slot flex w-full items-center justify-center rounded-md px-2 text-sm">
        {t("week.courtClosed")}
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
      aria-label={`${t(isPast ? "week.past" : "week.available")}, ${isPast
        ? t("week.pastLabel", { court: courtName, time: slot }) : t("booking.open", { court: courtName, time: slot })}`}
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

function OwnMarker() {
  return <svg data-testid="own-marker" className="own-marker" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <circle cx="12" cy="7.5" r="4.5" /><path d="M3 22a9 9 0 0 1 18 0z" />
  </svg>;
}

function unmeasuredLineOffset(currentTime: string, slots: string[], slotMinutes: number, slotHeight: number): number {
  const now = timeToMinutes(currentTime);
  const row = slots.findLastIndex((slot) => timeToMinutes(slot) <= now);
  if (row === -1) return 0;
  const into = Math.min(slotMinutes, now - timeToMinutes(slots[row]));
  return (row + into / slotMinutes) * slotHeight;
}

const DAY_STRIP_ITEM_MIN_REM = 6;

function itemsThatFit(list: HTMLElement): number {
  const style = window.getComputedStyle(list);
  const gap = parseFloat(style.columnGap) || 0;
  const minimum = DAY_STRIP_ITEM_MIN_REM * parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  return Math.max(1, Math.floor((list.clientWidth + gap) / (minimum + gap)));
}

// Every item shares one width, so resting on an item's start leaves no partial item at either edge.
function alignToItem(list: HTMLElement, item: HTMLElement) {
  const origin = list.getBoundingClientRect().left - list.scrollLeft;
  const itemBounds = item.getBoundingClientRect();
  const lowest = itemBounds.right - origin - list.clientWidth;
  const highest = itemBounds.left - origin;
  const starts = [...list.children]
    .map((child) => child.getBoundingClientRect().left - origin)
    .filter((start) => start >= lowest - 1 && start <= highest + 1);
  if (starts.length === 0) return;
  const target = starts.reduce((closest, start) =>
    Math.abs(start - list.scrollLeft) < Math.abs(closest - list.scrollLeft) ? start : closest);
  const reachable = Math.min(Math.max(0, target), list.scrollWidth - list.clientWidth);
  if (Math.abs(reachable - list.scrollLeft) > 1) list.scrollLeft = reachable;
}

function positionCurrentLine(plan: HTMLDivElement, time: string, slotMinutes: number) {
  const line = plan.querySelector<HTMLElement>('[data-testid="current-time-line"]');
  const rows = [...plan.querySelectorAll<HTMLElement>("tr[data-slot]")];
  const row = rows.findLast((candidate) => (candidate.dataset.slot ?? "") <= time) ?? rows[0];
  const slot = row?.dataset.slot;
  if (!line || !row || !slot) return;
  const bounds = row.getBoundingClientRect();
  if (bounds.height === 0) return;
  const fraction = Math.max(0, Math.min(slotMinutes, timeToMinutes(time) - timeToMinutes(slot))) / slotMinutes;
  line.style.top = `${bounds.top - plan.getBoundingClientRect().top + plan.scrollTop - plan.clientTop + fraction * bounds.height}px`;
}

function scrollToSlot(plan: HTMLDivElement | null, slot?: string) {
  const target = slot ? plan?.querySelector(`[data-slot="${slot}"]`) : undefined;
  if (!plan || !(target instanceof HTMLElement)) return;
  if (window.getComputedStyle(plan).overflowY === "visible") {
    if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
    return;
  }
  const headerHeight = plan.querySelector("thead")?.getBoundingClientRect().height ?? 0;
  plan.scrollTop += target.getBoundingClientRect().top - plan.getBoundingClientRect().top - headerHeight
    - Math.max(0, (plan.clientHeight - headerHeight - target.clientHeight) / 2);
}

function scrollToStart(plan: HTMLDivElement | null) {
  if (!plan) return;
  if (window.getComputedStyle(plan).overflowY === "visible" && typeof plan.scrollIntoView === "function") {
    plan.scrollIntoView({ block: "start" });
    return;
  }
  if (typeof plan.scrollTo === "function") plan.scrollTo(0, 0);
}

function resolveGridSlots(day: Date, grid: BookingGrid, offsetsByInstant: Map<string, number>): GridSlot[] {
  const hours = hoursOn(grid, formatDate(day));
  if (!hours?.opensAt || !hours.closesAt) {
    return [];
  }
  const start = timeToMinutes(hours.opensAt);
  const end = timeToMinutes(hours.closesAt);
  const slots = Array.from({ length: Math.ceil((end - start) / grid.slotMinutes) }, (_, index) => {
    const minutes = start + index * grid.slotMinutes;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  });
  return slots.flatMap((time) => {
    try {
      return [{ time, startsAt: Date.parse(zonedDateTime(formatDate(day), time, grid.timeZone, offsetsByInstant)) }];
    } catch (failure) {
      if (failure instanceof RangeError) return [];
      throw failure;
    }
  });
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

function formatWeekday(date: Date, language: string, timeZone: string): string {
  return dateTimeFormatter(language, { weekday: "short", timeZone }).format(date);
}

function formatDayMonth(date: Date, language: string, timeZone: string): string {
  return dateTimeFormatter(language, { day: "2-digit", month: "2-digit", timeZone }).format(date);
}

function formatDayLong(date: Date, language: string, timeZone: string): string {
  return dateTimeFormatter(language, { weekday: "long", month: "long", day: "numeric", timeZone }).format(date);
}

function formatWeekRange(days: Date[], language: string, timeZone: string): string {
  const formatter = dateTimeFormatter(language, { year: "numeric", month: "short", day: "numeric", timeZone });
  return `${formatter.format(days[0])} – ${formatter.format(days[6])}`;
}

async function reservationsBetween(from: string, to: string): Promise<PlanAllocation[]> {
  try {
    return (await api.reservedSlotsBetween(from, to)).map(reservedAllocation);
  } catch (failure) {
    warnAbout("Reserved slots unavailable", failure);
    return [];
  }
}

async function reservationsOn(date: string): Promise<PlanAllocation[]> {
  try {
    return (await api.reservedSlots(date)).map(reservedAllocation);
  } catch (failure) {
    warnAbout("Reserved slots unavailable", failure);
    return [];
  }
}

function reservedAllocation(slot: ReservedSlot): PlanAllocation {
  return {
    bookingId: `reserved:${slot.courtId}:${slot.startsAt}`, courtId: slot.courtId,
    startsAt: slot.startsAt, endsAt: slot.endsAt, cardLabel: "", cardColor: RESERVED_COLOR,
    ownBooking: false, showGenericOccupancy: false, reservation: { ownEntryId: slot.ownEntryId ?? null }
  };
}
