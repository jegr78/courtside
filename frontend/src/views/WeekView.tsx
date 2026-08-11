import { type CSSProperties, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type Allocation, type BookingGrid, type Problem, type PublicBookingCard, type PublicCourt, type PublicParticipantCard, type PublicParticipantMember } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";

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

interface BookingSelection {
  date: string;
  slot: string;
  courtId: string;
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
  const [bookingSelection, setBookingSelection] = useState<BookingSelection>();
  const [cancellation, setCancellation] = useState<Allocation>();
  const planRef = useRef<HTMLDivElement>(null);

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

  const days = data?.days ?? [];
  const selectedDay = days.find((day) => formatDate(day) === selectedDate);
  const selectedAllocations = selectedDate ? data?.allocations.get(selectedDate) ?? [] : [];
  const slots = selectedDay && data ? slotsFor(selectedDay, data.grid) : [];
  const language = i18n.resolvedLanguage ?? i18n.language;
  const isToday = selectedDate === dateInTimeZoneValue(currentInstant, data?.grid.timeZone);
  const currentTime = data ? formatTime(currentInstant.toISOString(), data.grid.timeZone) : undefined;
  const slotHeight = data ? data.grid.slotMinutes * 4 / 3 : 40;
  const currentSlot = currentTime && (slots.find((slot) => slot >= currentTime) ?? slots.at(-1));

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

  return <section aria-labelledby="occupancy-heading" className="mt-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="occupancy-heading" className="text-2xl font-bold">{t("week.title")}</h2>
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
          className="border-structural rounded-xl border px-3 py-2 text-left hover:border-(--club-primary) aria-pressed:border-(--club-primary) aria-pressed:bg-(--club-accent)/30"
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

    {data && data.courts.length > 1 && <div className="mobile-court-selector surface-panel sticky top-0 z-10 mt-3 flex gap-2 overflow-x-auto py-2" role="group" aria-label={t("week.chooseCourt")}>
      {data.courts.map((court) => <Button
        key={court.id}
        type="button"
        data-testid={`court-selector-${court.number}`}
        className={selectedCourtId === court.id ? "" : "button-secondary"}
        aria-pressed={selectedCourtId === court.id}
        onClick={() => setSelectedCourtId(court.id)}
      >{court.name || t("court.number", { number: court.number })}</Button>)}
    </div>}

    {error && <Alert>{error}</Alert>}
    {!data && !error && <p className="mt-6" aria-live="polite">{t("status.loading")}</p>}
    {data && <div className="mt-4 flex justify-end">
      {isToday && <Button type="button" className="button-secondary" onClick={() => scrollToSlot(planRef.current, currentSlot)}>{t("week.now")}</Button>}
    </div>}
    {data && <div
      ref={planRef}
      data-testid="week-grid"
      data-week-offset={weekOffset}
      className="day-plan border-structural relative mt-3 max-h-[70vh] overflow-auto rounded-xl border"
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
              scope="col"
              className={`border-structural border-b px-4 py-3 text-left ${selectedCourtId === court.id ? "" : "mobile-court-hidden"}`}
            >{court.name || t("court.number", { number: court.number })}</th>)}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => <tr key={slot} data-slot={slot} style={{ height: `${slotHeight}px` }}>
            <th scope="row" className="font-value surface-panel border-structural whitespace-nowrap border-b px-3 text-left font-medium">
              {slot}
            </th>
            {data.courts.map((court) => renderCell(
              court, slot, selectedAllocations, data.grid.slotMinutes, data.grid.timeZone, t,
              () => selectedDate && setBookingSelection({ date: selectedDate, slot, courtId: court.id }),
              setCancellation,
              selectedDate ? isPastSlot(selectedDate, slot, data.grid.timeZone, currentInstant) : false,
              canBook,
              selectedCourtId === court.id
            ))}
          </tr>)}
        </tbody>
      </table>
      {isToday && currentTime && slots.length > 0 && <div
        data-testid="current-time-line"
        aria-label={t("week.currentTime", { time: currentTime })}
        className="current-time-line"
        style={{ top: `${48 + currentLineOffset(currentTime, slots[0], data.grid.slotMinutes, slotHeight)}px` }}
      />}
      {slots.length === 0 && <p className="text-muted px-4 py-6 text-center">{t("week.closed")}</p>}
    </div>}
    {data && <ul className="text-muted mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label={t("week.legend")}>
      <li><span className="day-plan-legend free" aria-hidden="true" />{t("week.available")}</li>
      <li><span className="day-plan-legend occupied" aria-hidden="true" />{t("week.occupied")}</li>
      <li><span className="day-plan-legend own" aria-hidden="true" />{t("week.own")}</li>
      <li><span className="day-plan-legend unavailable" aria-hidden="true" />{t("week.unavailable")}</li>
    </ul>}
    {bookingSelection && data && <BookingDialog
      selection={bookingSelection}
      grid={data.grid}
      courts={data.courts}
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
    {cancellation && selectedDate && <CancellationDialog
      allocation={cancellation}
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
  allocations: Allocation[],
  slotMinutes: number,
  timeZone: string,
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
    const className = "h-full w-full rounded-md px-3 py-2 text-left font-semibold";
    const state = allocation.ownBooking ? "own" : allocation.matchType ? "occupied" : "card";
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
        aria-label={t("booking.cancelLabel", { label })}
        onClick={() => cancel(allocation)}
        className={className}
        style={style}
      >{label}</button> : <div data-card-color={allocation.cardColor} data-state={state} className={className} style={style}>{label}</div>}
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
      disabled={isPast}
      data-state={isPast ? "past" : "free"}
      className="day-plan-slot h-full w-full rounded-md px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--club-accent)"
      aria-label={isPast ? t("week.pastLabel", { court: courtName, time: slot }) : t("booking.open", { court: courtName, time: slot })}
      onClick={book}
    >
      {isPast ? t("week.past") : t("week.available")}
    </button> : <div data-state={isPast ? "past" : "free"} className="day-plan-slot flex h-full w-full items-center justify-center rounded-md px-2 text-sm">
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
  if (allocation.ownBooking && allocation.matchType) {
    return [t("booking.viewer"), ...(allocation.participantLastNames ?? [])].join(", ");
  }
  return allocation.matchType ? t(`booking.matchType.${allocation.matchType}`) : allocation.cardLabel;
}

function BookingDialog({ selection, grid, courts, closed, created, conflicted }: {
  selection: BookingSelection;
  grid: BookingGrid;
  courts: PublicCourt[];
  closed: () => void;
  created: () => Promise<void>;
  conflicted: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [bookingCards, setBookingCards] = useState<PublicBookingCard[]>([]);
  const [participantCards, setParticipantCards] = useState<PublicParticipantCard[]>([]);
  const [courtIds, setCourtIds] = useState([selection.courtId]);
  const [cardId, setCardId] = useState("");
  const [guestNames, setGuestNames] = useState([""]);
  const [participantCardIds, setParticipantCardIds] = useState([""]);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberMatches, setMemberMatches] = useState<PublicParticipantMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<PublicParticipantMember[]>([]);
  const [note, setNote] = useState("");
  const [violations, setViolations] = useState<Array<{ field: string; message: string }>>([]);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    void Promise.all([api.bookingCards(), api.participantCards()]).then(([cards, participants]) => {
      setBookingCards(cards);
      setParticipantCards(participants);
      setCardId(cards[0]?.id ?? "");
    }).catch((failure: unknown) => setError(problemMessage(failure, t)));
  }, [t]);

  useEffect(() => {
    const query = memberQuery.trim();
    if (query.length < 2) {
      setMemberMatches([]);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      void api.participantMembers(query).then((matches) => {
        if (active) setMemberMatches(matches.filter((match) =>
          !selectedMembers.some((selected) => selected.personId === match.personId)));
      }).catch((failure: unknown) => { if (active) setError(problemMessage(failure, t)); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [memberQuery, selectedMembers, t]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setViolations([]);
    try {
      const startsAt = zonedDateTime(selection.date, selection.slot, grid.timeZone);
      const endsAt = zonedDateTime(selection.date, addMinutes(selection.slot, grid.slotMinutes), grid.timeZone);
      const participants = [
        ...selectedMembers.map((member) => ({ personId: member.personId })),
        ...guestNames.map((name) => name.trim()).filter(Boolean).map((guestName) => ({ guestName })),
        ...participantCardIds.filter(Boolean).map((participantCardId) => ({ cardId: participantCardId }))
      ];
      await api.createBooking({
        courtIds,
        cardId,
        startsAt,
        endsAt,
        note: note.trim() || undefined,
        participants
      }, idempotencyKey);
      await created();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        await conflicted().catch(() => undefined);
      }
      if (failure instanceof ApiError && failure.problem) {
        setViolations(translatedViolations(failure.problem, t));
        setIdempotencyKey(crypto.randomUUID());
      }
      setError(problemMessage(failure, t));
    } finally {
      setSubmitting(false);
    }
  }

  const fieldViolations = (field: string) => violations.filter((violation) => violation.field === field);
  const describedBy = (field: string) => fieldViolations(field).length > 0 ? `booking-${field}-errors` : undefined;

  return <Modal labelledBy="booking-heading" closed={closed}>
    <form data-testid="booking-dialog" onSubmit={(event) => void submit(event)} className="surface-panel max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl border p-6 shadow-2xl">
      <h3 id="booking-heading" className="text-xl font-bold">{t("booking.title", { date: selection.date, time: selection.slot })}</h3>
      <FieldViolations id="booking-startsAt-errors" violations={fieldViolations("startsAt")} />
      <fieldset className="mt-5 grid gap-2" aria-invalid={fieldViolations("courtIds").length > 0} aria-describedby={describedBy("courtIds")}>
        <legend className="font-semibold">{t("booking.courts")}</legend>
        {courts.map((court) => <label key={court.id} className="flex gap-2">
          <input type="checkbox" checked={courtIds.includes(court.id)} onChange={(event) => setCourtIds((current) => event.target.checked ? [...current, court.id] : current.filter((id) => id !== court.id))} />
          {court.name || t("court.number", { number: court.number })}
        </label>)}
      </fieldset>
      <FieldViolations id="booking-courtIds-errors" violations={fieldViolations("courtIds")} />
      <label className="mt-4 grid gap-2 font-medium">{t("booking.card")}
        <select value={cardId} onChange={(event) => setCardId(event.target.value)} required aria-invalid={fieldViolations("cardId").length > 0} aria-describedby={describedBy("cardId")} className="form-control rounded-lg border px-3 py-3">
          {bookingCards.map((card) => <option key={card.id} value={card.id}>{card.label}</option>)}
        </select>
      </label>
      <FieldViolations id="booking-cardId-errors" violations={fieldViolations("cardId")} />
      <fieldset className="mt-4 grid gap-3" aria-invalid={fieldViolations("participants").length > 0} aria-describedby={describedBy("participants")}>
        <legend className="font-semibold">{t("booking.members")}</legend>
        <label className="grid gap-2 font-medium">{t("booking.memberSearch")}
          <input data-testid="member-search" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} className="form-control rounded-lg border px-3 py-3" />
        </label>
        {memberMatches.length > 0 && <ul className="grid gap-2">
          {memberMatches.map((member) => <li key={member.personId}>
            <Button type="button" data-testid="member-match" className="button-secondary w-full text-left" onClick={() => {
              setSelectedMembers((current) => [...current, member]);
              setMemberQuery("");
            }}>{t("booking.addMember", { name: member.displayName })}</Button>
          </li>)}
        </ul>}
        {selectedMembers.map((member) => <div key={member.personId} className="surface-raised flex items-center justify-between gap-3 rounded-lg px-3 py-2">
          <span>{member.displayName}</span>
          <Button type="button" className="button-secondary px-3 py-2" onClick={() => setSelectedMembers((current) => current.filter((selected) => selected.personId !== member.personId))}>{t("booking.removeMember", { name: member.displayName })}</Button>
        </div>)}
      </fieldset>
      <fieldset className="mt-4 grid gap-3" aria-invalid={fieldViolations("participants").length > 0} aria-describedby={describedBy("participants")}>
        <legend className="font-semibold">{t("booking.guests")}</legend>
        {guestNames.map((guestName, index) => <label key={index} className="grid gap-2 font-medium">
          {index === 0 ? t("booking.guest") : t("booking.guestNumber", { number: index + 1 })}
          <input value={guestName} onChange={(event) => setGuestNames((current) => current.map((name, currentIndex) => currentIndex === index ? event.target.value : name))} className="form-control rounded-lg border px-3 py-3" />
        </label>)}
        <Button type="button" className="button-secondary justify-self-start" onClick={() => setGuestNames((current) => [...current, ""])}>{t("booking.addGuest")}</Button>
      </fieldset>
      <fieldset className="mt-4 grid gap-3" aria-invalid={fieldViolations("participants").length > 0} aria-describedby={describedBy("participants")}>
        <legend className="font-semibold">{t("booking.participantCards")}</legend>
        {participantCardIds.map((participantCardId, index) => <label key={index} className="grid gap-2 font-medium">
          {index === 0 ? t("booking.participantCard") : t("booking.participantCardNumber", { number: index + 1 })}
          <select value={participantCardId} onChange={(event) => setParticipantCardIds((current) => current.map((id, currentIndex) => currentIndex === index ? event.target.value : id))} className="form-control rounded-lg border px-3 py-3">
            <option value="">{t("booking.none")}</option>
            {participantCards.map((card) => <option key={card.id} value={card.id}>{card.label}</option>)}
          </select>
        </label>)}
        <Button type="button" className="button-secondary justify-self-start" onClick={() => setParticipantCardIds((current) => [...current, ""])}>{t("booking.addParticipantCard")}</Button>
      </fieldset>
      <FieldViolations id="booking-participants-errors" violations={fieldViolations("participants")} />
      <label className="mt-4 grid gap-2 font-medium">{t("booking.note")}
        <textarea value={note} onChange={(event) => setNote(event.target.value)} aria-invalid={fieldViolations("note").length > 0} aria-describedby={describedBy("note")} className="form-control rounded-lg border px-3 py-3" />
      </label>
      <FieldViolations id="booking-note-errors" violations={fieldViolations("note")} />
      <FieldViolations id="booking-general-errors" violations={fieldViolations("general")} />
      {error && violations.length === 0 && <Alert>{error}</Alert>}
      <div className="mt-6 flex justify-end gap-3">
        <Button type="button" className="button-secondary" onClick={closed}>{t("booking.close")}</Button>
        <Button type="submit" data-testid="booking-submit" disabled={submitting || courtIds.length === 0 || !cardId}>{t("booking.submit")}</Button>
      </div>
    </form>
  </Modal>;
}

function CancellationDialog({ allocation, closed, cancelled }: { allocation: Allocation; closed: () => void; cancelled: () => Promise<void> }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  return <Modal labelledBy="cancel-heading" closed={closed}>
    <div className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-2xl">
      <h3 id="cancel-heading" className="text-xl font-bold">{t("booking.cancelTitle")}</h3>
      <p className="mt-3">{t("booking.cancelQuestion", { label: allocation.cardLabel })}</p>
      {error && <Alert>{error}</Alert>}
      <div className="mt-6 flex justify-end gap-3">
        <Button type="button" className="button-secondary" onClick={closed}>{t("booking.close")}</Button>
        <Button type="button" onClick={() => void api.cancelBooking(allocation.bookingId).then(cancelled).catch((failure: unknown) => setError(problemMessage(failure, t)))}>{t("booking.cancelConfirm")}</Button>
      </div>
    </div>
  </Modal>;
}

function FieldViolations({ id, violations }: { id: string; violations: Array<{ field: string; message: string }> }) {
  if (violations.length === 0) return null;
  return <div id={id} className="mt-2 grid gap-1">
    {violations.map((violation, index) => <p key={`${violation.field}-${index}`} data-field={violation.field} className="text-sm text-red-800">{violation.message}</p>)}
  </div>;
}

function translatedViolations(problem: Problem, t: ReturnType<typeof useTranslation>["t"]): Array<{ field: string; message: string }> {
  return [
    ...(problem.violations ?? []).map((violation) => ({
      field: violationField(violation.code),
      message: t(violation.code, { ...violation.params, defaultValue: t("error.generic") })
    })),
    ...(problem.fieldErrors ?? []).map((violation) => ({
      field: normalizedField(violation.field),
      message: t(violation.code, { ...violation.params, defaultValue: t("error.generic") })
    }))
  ];
}

function violationField(code: string): string {
  if (code.startsWith("booking.participants.")) return "participants";
  if (code === "booking.rule.maxOpenBookings.exceeded") return "cardId";
  return "startsAt";
}

function normalizedField(field: string): string {
  if (field.startsWith("participants")) return "participants";
  if (field.startsWith("courtIds")) return "courtIds";
  return ["startsAt", "endsAt", "cardId", "note"].includes(field) ? field === "endsAt" ? "startsAt" : field : "general";
}

function addMinutes(time: string, minutes: number): string {
  const total = timeToMinutes(time) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function zonedDateTime(date: string, time: string, timeZone: string): string {
  const local = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, timeZoneName: "longOffset", hour: "2-digit"
  }).formatToParts(local);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value.replace("GMT", "") || "+00:00";
  return `${date}T${time}:00${offset}`;
}

function dateInTimeZone(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(value("year"), value("month") - 1, value("day"));
}

function dateInTimeZoneValue(instant: Date, timeZone?: string): string | undefined {
  return timeZone ? formatDate(dateInTimeZone(instant, timeZone)) : undefined;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function calendarDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

function isPastSlot(date: string, time: string, timeZone: string, now: Date): boolean {
  return Date.parse(zonedDateTime(date, time, timeZone)) < now.getTime();
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

function formatTime(timestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("hour")}:${value("minute")}`;
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
