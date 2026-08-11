import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type Allocation, type BookingGrid, type Problem, type PublicBookingCard, type PublicCourt, type PublicParticipantCard, type PublicParticipantMember } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";

interface WeekViewProps {
  today?: Date;
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

export function WeekView({ today = new Date() }: WeekViewProps) {
  const { t, i18n } = useTranslation();
  const [referenceInstant] = useState(today);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>();
  const [data, setData] = useState<WeekData>();
  const [error, setError] = useState<string>();
  const [bookingSelection, setBookingSelection] = useState<BookingSelection>();
  const [cancellation, setCancellation] = useState<Allocation>();

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

  async function refreshDate(date: string) {
    const allocations = await api.allocations(date);
    setData((current) => current ? {
      ...current,
      allocations: new Map(current.allocations).set(date, allocations)
    } : current);
  }

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
            {data.courts.map((court) => renderCell(
              court, slot, selectedAllocations, data.grid.slotMinutes, data.grid.timeZone, t,
              () => selectedDate && setBookingSelection({ date: selectedDate, slot, courtId: court.id }),
              setCancellation
            ))}
          </tr>)}
        </tbody>
      </table>
      {slots.length === 0 && <p className="px-4 py-6 text-center text-slate-600">{t("week.closed")}</p>}
    </div>}
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
  cancel: (allocation: Allocation) => void
) {
  const allocation = allocations.find((entry) => entry.courtId === court.id && formatTime(entry.startsAt, timeZone) === slot);
  if (allocation) {
    const duration = (Date.parse(allocation.endsAt) - Date.parse(allocation.startsAt)) / 60_000;
    return <td key={court.id} rowSpan={Math.max(1, Math.ceil(duration / slotMinutes))} className="border-b border-slate-100 p-2 align-top">
      <button
        type="button"
        aria-label={t("booking.cancelLabel", { label: allocation.cardLabel })}
        onClick={() => cancel(allocation)}
        className="h-full rounded-lg px-3 py-2 font-semibold"
        style={{ backgroundColor: allocation.cardColor, color: contrastColor(allocation.cardColor) }}
      >{allocation.cardLabel}</button>
    </td>;
  }
  const minute = timeToMinutes(slot);
  const isCovered = allocations.some((entry) => entry.courtId === court.id
    && timeToMinutes(formatTime(entry.startsAt, timeZone)) < minute
    && timeToMinutes(formatTime(entry.endsAt, timeZone)) > minute);
  const courtName = court.name || t("court.number", { number: court.number });
  return isCovered ? null : <td key={court.id} className="border-b border-slate-100 p-2">
    <button type="button" className="min-h-10 w-full rounded-lg hover:bg-(--club-accent)/40" aria-label={t("booking.open", { court: courtName, time: slot })} onClick={book}>
      <span className="sr-only">{t("week.available")}</span>
    </button>
  </td>;
}

function BookingDialog({ selection, grid, courts, closed, created }: {
  selection: BookingSelection;
  grid: BookingGrid;
  courts: PublicCourt[];
  closed: () => void;
  created: () => Promise<void>;
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
    <form onSubmit={(event) => void submit(event)} className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
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
        <select value={cardId} onChange={(event) => setCardId(event.target.value)} required aria-invalid={fieldViolations("cardId").length > 0} aria-describedby={describedBy("cardId")} className="rounded-lg border border-slate-300 bg-white px-3 py-3">
          {bookingCards.map((card) => <option key={card.id} value={card.id}>{card.label}</option>)}
        </select>
      </label>
      <FieldViolations id="booking-cardId-errors" violations={fieldViolations("cardId")} />
      <fieldset className="mt-4 grid gap-3" aria-invalid={fieldViolations("participants").length > 0} aria-describedby={describedBy("participants")}>
        <legend className="font-semibold">{t("booking.members")}</legend>
        <label className="grid gap-2 font-medium">{t("booking.memberSearch")}
          <input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-3" />
        </label>
        {memberMatches.length > 0 && <ul className="grid gap-2">
          {memberMatches.map((member) => <li key={member.personId}>
            <Button type="button" className="w-full bg-slate-600 text-left" onClick={() => {
              setSelectedMembers((current) => [...current, member]);
              setMemberQuery("");
            }}>{t("booking.addMember", { name: member.displayName })}</Button>
          </li>)}
        </ul>}
        {selectedMembers.map((member) => <div key={member.personId} className="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2">
          <span>{member.displayName}</span>
          <Button type="button" className="bg-slate-600 px-3 py-2" onClick={() => setSelectedMembers((current) => current.filter((selected) => selected.personId !== member.personId))}>{t("booking.removeMember", { name: member.displayName })}</Button>
        </div>)}
      </fieldset>
      <fieldset className="mt-4 grid gap-3" aria-invalid={fieldViolations("participants").length > 0} aria-describedby={describedBy("participants")}>
        <legend className="font-semibold">{t("booking.guests")}</legend>
        {guestNames.map((guestName, index) => <label key={index} className="grid gap-2 font-medium">
          {index === 0 ? t("booking.guest") : t("booking.guestNumber", { number: index + 1 })}
          <input value={guestName} onChange={(event) => setGuestNames((current) => current.map((name, currentIndex) => currentIndex === index ? event.target.value : name))} className="rounded-lg border border-slate-300 px-3 py-3" />
        </label>)}
        <Button type="button" className="justify-self-start bg-slate-600" onClick={() => setGuestNames((current) => [...current, ""])}>{t("booking.addGuest")}</Button>
      </fieldset>
      <fieldset className="mt-4 grid gap-3" aria-invalid={fieldViolations("participants").length > 0} aria-describedby={describedBy("participants")}>
        <legend className="font-semibold">{t("booking.participantCards")}</legend>
        {participantCardIds.map((participantCardId, index) => <label key={index} className="grid gap-2 font-medium">
          {index === 0 ? t("booking.participantCard") : t("booking.participantCardNumber", { number: index + 1 })}
          <select value={participantCardId} onChange={(event) => setParticipantCardIds((current) => current.map((id, currentIndex) => currentIndex === index ? event.target.value : id))} className="rounded-lg border border-slate-300 bg-white px-3 py-3">
            <option value="">{t("booking.none")}</option>
            {participantCards.map((card) => <option key={card.id} value={card.id}>{card.label}</option>)}
          </select>
        </label>)}
        <Button type="button" className="justify-self-start bg-slate-600" onClick={() => setParticipantCardIds((current) => [...current, ""])}>{t("booking.addParticipantCard")}</Button>
      </fieldset>
      <FieldViolations id="booking-participants-errors" violations={fieldViolations("participants")} />
      <label className="mt-4 grid gap-2 font-medium">{t("booking.note")}
        <textarea value={note} onChange={(event) => setNote(event.target.value)} aria-invalid={fieldViolations("note").length > 0} aria-describedby={describedBy("note")} className="rounded-lg border border-slate-300 px-3 py-3" />
      </label>
      <FieldViolations id="booking-note-errors" violations={fieldViolations("note")} />
      <FieldViolations id="booking-general-errors" violations={fieldViolations("general")} />
      {error && violations.length === 0 && <Alert>{error}</Alert>}
      <div className="mt-6 flex justify-end gap-3">
        <Button type="button" className="bg-slate-600" onClick={closed}>{t("booking.close")}</Button>
        <Button type="submit" disabled={submitting || courtIds.length === 0 || !cardId}>{t("booking.submit")}</Button>
      </div>
    </form>
  </Modal>;
}

function CancellationDialog({ allocation, closed, cancelled }: { allocation: Allocation; closed: () => void; cancelled: () => Promise<void> }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  return <Modal labelledBy="cancel-heading" closed={closed}>
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <h3 id="cancel-heading" className="text-xl font-bold">{t("booking.cancelTitle")}</h3>
      <p className="mt-3">{t("booking.cancelQuestion", { label: allocation.cardLabel })}</p>
      {error && <Alert>{error}</Alert>}
      <div className="mt-6 flex justify-end gap-3">
        <Button type="button" className="bg-slate-600" onClick={closed}>{t("booking.close")}</Button>
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
