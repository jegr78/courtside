import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type Allocation, type BookingGrid, type Problem, type PublicBookingCard, type PublicCourt, type PublicParticipantCard, type PublicParticipantMember } from "../api/client";
import { idempotencyKey } from "../api/idempotency";
import { problemReference } from "../api/problem-message";
import { useReportedFailure } from "../failures/useReportedFailure";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { bookingTimeSlot, formatBookingPeriod, zonedDateTime } from "../time/clubZone";

export interface BookingSelection {
  date: string;
  slot: string;
  courtId: string;
  durationMinutes?: number;
}

export function BookingDialog({ selection, grid, courts, allocations, canChooseSeveralCourts,
  maxBookingMinutes, closed, created, conflicted }: {
  selection: BookingSelection;
  grid: BookingGrid;
  courts: PublicCourt[];
  allocations: Allocation[];
  canChooseSeveralCourts: boolean;
  maxBookingMinutes?: number;
  closed: () => void;
  created: () => Promise<void>;
  conflicted: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [bookingCards, setBookingCards] = useState<PublicBookingCard[]>([]);
  const [participantCards, setParticipantCards] = useState<PublicParticipantCard[]>([]);
  const [courtIds, setCourtIds] = useState([selection.courtId]);
  const [cardId, setCardId] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(selection.durationMinutes ?? grid.slotMinutes);
  const [guestNames, setGuestNames] = useState([""]);
  const [participantCardIds, setParticipantCardIds] = useState([""]);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberMatches, setMemberMatches] = useState<PublicParticipantMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<PublicParticipantMember[]>([]);
  const [note, setNote] = useState("");
  const [violations, setViolations] = useState<Array<{ field: string; code: string; message: string }>>([]);
  const { message: error, report, clear } = useReportedFailure();
  const [submitting, setSubmitting] = useState(false);
  const [requestKey, setRequestKey] = useState(() => idempotencyKey());
  const [showsMore, setShowsMore] = useState(false);

  useEffect(() => {
    void Promise.all([api.bookingCards(), api.participantCards()]).then(([cards, participants]) => {
      setBookingCards(cards);
      setParticipantCards(participants);
      setCardId(cards[0]?.id ?? "");
    }).catch((failure: unknown) => report(failure));
  }, [report]);

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
      }).catch((failure: unknown) => { if (active) report(failure); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [memberQuery, report, selectedMembers]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    clear();
    setViolations([]);
    try {
      const { startsAt, endsAt } = bookingTimeSlot(
        selection.date, selection.slot, grid.timeZone, selectedDuration
      );
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
      }, requestKey);
      await created();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        await conflicted().catch(() => undefined);
      }
      if (failure instanceof ApiError && failure.problem) {
        const translated = translatedViolations(failure.problem, t);
        setViolations(translated);
        // A refusal about a field nobody can see leaves a member with no way to answer it.
        if (translated.some((violation) => BEHIND_THE_DISCLOSURE.includes(violation.field))) {
          setShowsMore(true);
        }
        if (translated.length > 0) report(failure, problemReference); else report(failure);
        setRequestKey(idempotencyKey());
      } else {
        report(failure);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const fieldViolations = (field: string) => violations.filter((violation) => violation.field === field);
  const describedBy = (field: string) => fieldViolations(field).length > 0 ? `booking-${field}-errors` : undefined;
  const durations = availableDurations(selection, grid, courtIds, allocations, maxBookingMinutes);
  // A list emptied by the bound is a different thing from one emptied by an occupied court: the
  // second is the conflict the server reports on submit, and saying so is its job and not ours.
  const boundLeavesNoPeriod = maxBookingMinutes != null && maxBookingMinutes < grid.slotMinutes;
  const selectedDuration = durations.includes(durationMinutes) ? durationMinutes : durations[0] ?? grid.slotMinutes;
  const period = bookingTimeSlot(selection.date, selection.slot, grid.timeZone, selectedDuration);
  // The booker takes a slot too, which is what BookingWriter counts, so an empty dialog stands at one.
  const chosenPlayers = 1 + selectedMembers.length
    + guestNames.filter((name) => name.trim()).length
    + participantCardIds.filter(Boolean).length;
  const requiredPlayers = requiredFor(bookingCards.find((card) => card.id === cardId), chosenPlayers);

  return <Modal labelledBy="booking-heading" closed={closed}>
    <form data-testid="booking-dialog" onSubmit={(event) => void submit(event)} className="surface-panel flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border shadow-2xl">
      <div className="overflow-y-auto p-6">
      <h3 id="booking-heading" className="text-xl font-bold">{t("booking.title")}</h3>
      <p data-testid="booking-period" aria-live="polite" className="mt-2 font-semibold">{formatBookingPeriod(period.startsAt, period.endsAt, i18n.language, grid.timeZone)}</p>
      <FieldViolations id="booking-startsAt-errors" violations={fieldViolations("startsAt")} />
      <label className="mt-5 grid gap-2 font-medium">{t("booking.duration")}
        <select data-testid="booking-duration" value={selectedDuration} onChange={(event) => setDurationMinutes(Number(event.target.value))} className="form-control rounded-lg border px-3 py-3">
          {durations.map((minutes) => <option key={minutes} value={minutes}>{t("booking.durationMinutes", { count: minutes })}</option>)}
        </select>
      </label>
      {boundLeavesNoPeriod && <Alert testId="booking-no-duration">{t("booking.boundBelowSlotGrid")}</Alert>}
      {canChooseSeveralCourts
        ? <fieldset className="mt-5 grid gap-2" aria-invalid={fieldViolations("courtIds").length > 0} aria-describedby={describedBy("courtIds")}>
          <legend className="font-semibold">{t("booking.courts")}</legend>
          {courts.map((court) => <label key={court.id} className="flex gap-2">
            <input data-testid={`booking-court-${court.id}`} type="checkbox" checked={courtIds.includes(court.id)} onChange={(event) => setCourtIds((current) => event.target.checked ? [...current, court.id] : current.filter((id) => id !== court.id))} />
            {court.name || t("court.number", { number: court.number })}
          </label>)}
        </fieldset>
        : <p data-testid="booking-court" className="mt-5 font-semibold">
          {courtName(courts, selection.courtId, t)}</p>}
      <FieldViolations id="booking-courtIds-errors" violations={fieldViolations("courtIds")} />
      <label className="mt-4 grid gap-2 font-medium">{t("booking.card")}
        <select data-testid="booking-card" value={cardId} onChange={(event) => setCardId(event.target.value)} required aria-invalid={fieldViolations("cardId").length > 0} aria-describedby={describedBy("cardId")} className="form-control rounded-lg border px-3 py-3">
          {bookingCards.map((card) => <option key={card.id} value={card.id}>{card.label}</option>)}
        </select>
      </label>
      <FieldViolations id="booking-cardId-errors" violations={fieldViolations("cardId")} />
      {requiredPlayers !== undefined && <p data-testid="booking-players" aria-live="polite" className="mt-2">
        {t("booking.players", { players: chosenPlayers, required: requiredPlayers })}
      </p>}
      <fieldset className="mt-4 grid gap-3" aria-invalid={fieldViolations("participants").length > 0} aria-describedby={describedBy("participants")}>
        <legend className="font-semibold">{t("booking.members")}</legend>
        <label className="grid gap-2 font-medium">{t("booking.memberSearch")}
          <input data-testid="member-search" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} className="form-control rounded-lg border px-3 py-3" />
        </label>
        {memberMatches.length > 0 && <ul className="grid gap-2">
          {memberMatches.map((member) => <li key={member.personId}>
            <Button variant="secondary" type="button" data-testid="member-match" data-person-id={member.personId} className="w-full text-left" onClick={() => {
              setSelectedMembers((current) => [...current, member]);
              setMemberQuery("");
            }}>{t("booking.addMember", { name: member.displayName })}</Button>
          </li>)}
        </ul>}
        {selectedMembers.map((member) => <div key={member.personId} className="surface-raised flex items-center justify-between gap-3 rounded-lg px-3 py-2">
          <span>{member.displayName}</span>
          <Button variant="secondary" type="button" className="px-3 py-2" onClick={() => setSelectedMembers((current) => current.filter((selected) => selected.personId !== member.personId))}>{t("booking.removeMember", { name: member.displayName })}</Button>
        </div>)}
      </fieldset>
      <details data-testid="booking-more" open={showsMore} onToggle={(event) => setShowsMore(event.currentTarget.open)} className="mt-4">
      <summary data-testid="booking-more-summary" className="cursor-pointer font-semibold">{t("booking.more")}</summary>
      <fieldset data-testid="guest-participants" className="mt-4 grid gap-3" aria-invalid={fieldViolations("participants").length > 0} aria-describedby={describedBy("participants")}>
        <legend className="font-semibold">{t("booking.guests")}</legend>
        {guestNames.map((guestName, index) => <label key={index} className="grid gap-2 font-medium">
          {index === 0 ? t("booking.guest") : t("booking.guestNumber", { number: index + 1 })}
          <input data-testid="guest-name" value={guestName} onChange={(event) => setGuestNames((current) => current.map((name, currentIndex) => currentIndex === index ? event.target.value : name))} className="form-control rounded-lg border px-3 py-3" />
        </label>)}
        <Button variant="secondary" type="button" className="justify-self-start" onClick={() => setGuestNames((current) => [...current, ""])}>{t("booking.addGuest")}</Button>
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
        <Button variant="secondary" type="button" className="justify-self-start" onClick={() => setParticipantCardIds((current) => [...current, ""])}>{t("booking.addParticipantCard")}</Button>
      </fieldset>
      <FieldViolations id="booking-participants-errors" violations={fieldViolations("participants")} />
      <label className="mt-4 grid gap-2 font-medium">{t("booking.note")}
        <textarea data-testid="booking-note" value={note} onChange={(event) => setNote(event.target.value)} aria-invalid={fieldViolations("note").length > 0} aria-describedby={describedBy("note")} className="form-control rounded-lg border px-3 py-3" />
      </label>
      <FieldViolations id="booking-note-errors" violations={fieldViolations("note")} />
      </details>
      <FieldViolations id="booking-general-errors" violations={fieldViolations("general")} />
      {error && <Alert>{error}</Alert>}
      </div>
      <div className="surface-panel border-structural flex shrink-0 justify-end gap-3 border-t px-6 py-4">
        <Button variant="secondary" type="button" data-testid="booking-close" onClick={closed}>{t("booking.close")}</Button>
        <Button variant="primary" type="submit" data-testid="booking-submit" disabled={submitting || courtIds.length === 0 || !cardId || boundLeavesNoPeriod}>{t("booking.submit")}</Button>
      </div>
    </form>
  </Modal>;
}

function availableDurations(selection: BookingSelection, grid: BookingGrid, courtIds: string[], allocations: Allocation[], maxBookingMinutes?: number): number[] {
  const start = bookingTimeSlot(selection.date, selection.slot, grid.timeZone, grid.slotMinutes).startsAt;
  const openingHours = grid.openingHours.find((window) => window.dayOfWeek === dayOfWeek(selection.date));
  const closesAt = openingHours?.closesAt
    ? zonedDateTime(selection.date, openingHours.closesAt.slice(0, 5), grid.timeZone)
    : new Date(Date.parse(start) + grid.slotMinutes * 60_000).toISOString();
  // The floor is one slot only where nothing else bounds the day; a rule set that bounds a booking
  // shorter than a slot offers no period at all rather than one the server refuses.
  const untilClosing = Math.max(grid.slotMinutes, Math.floor((Date.parse(closesAt) - Date.parse(start)) / 60_000));
  const maximum = maxBookingMinutes == null ? untilClosing : Math.min(untilClosing, maxBookingMinutes);
  const durations: number[] = [];
  for (let minutes = grid.slotMinutes; minutes <= maximum; minutes += grid.slotMinutes) {
    const end = Date.parse(start) + minutes * 60_000;
    const overlaps = allocations.some((allocation) => courtIds.includes(allocation.courtId)
      && Date.parse(allocation.startsAt) < end && Date.parse(allocation.endsAt) > Date.parse(start));
    if (overlaps) break;
    durations.push(minutes);
  }
  return durations;
}

function dayOfWeek(date: string): string {
  const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  return days[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

function FieldViolations({ id, violations }: { id: string; violations: Array<{ field: string; code: string; message: string }> }) {
  if (violations.length === 0) return null;
  return <div id={id} className="mt-2 grid gap-1">
    {violations.map((violation, index) => <p key={`${violation.field}-${index}`} data-field={violation.field} data-code={violation.code} className="text-sm text-red-800">{violation.message}</p>)}
  </div>;
}

function translatedViolations(problem: Problem, t: ReturnType<typeof useTranslation>["t"]): Array<{ field: string; code: string; message: string }> {
  return [
    ...(problem.violations ?? []).map((violation) => ({
      field: violationField(violation.code),
      code: violation.code,
      message: t(violation.code, { ...violation.params, defaultValue: t("error.generic") })
    })),
    ...(problem.fieldErrors ?? []).map((violation) => ({
      field: normalizedField(violation.field),
      code: violation.code,
      message: t(violation.code, { ...violation.params, defaultValue: t("error.generic") })
    }))
  ];
}

// An empty set of counts is how a card says it tracks no players at all, so there is nothing to meet.
function requiredFor(card: PublicBookingCard | undefined, chosen: number): number | undefined {
  const counts = [...(card?.allowedPlayerCounts ?? [])].sort((left, right) => left - right);
  return counts.length === 0 ? undefined : counts.find((count) => count >= chosen) ?? counts.at(-1);
}

function courtName(courts: PublicCourt[], courtId: string, t: ReturnType<typeof useTranslation>["t"]): string {
  const court = courts.find((candidate) => candidate.id === courtId);
  if (!court) return "";
  return court.name || t("court.number", { number: court.number });
}

const BEHIND_THE_DISCLOSURE = ["participants", "note"];

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
