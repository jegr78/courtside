import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type BookingGrid, type Problem, type PublicBookingCard, type PublicCourt, type PublicParticipantCard, type PublicParticipantMember } from "../api/client";
import { idempotencyKey } from "../api/idempotency";
import { problemMessage, problemReference } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { bookingTimeSlot } from "../time/clubZone";

export interface BookingSelection {
  date: string;
  slot: string;
  courtId: string;
}

export function BookingDialog({ selection, grid, courts, closed, created, conflicted }: {
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
  const [violations, setViolations] = useState<Array<{ field: string; code: string; message: string }>>([]);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [requestKey, setRequestKey] = useState(() => idempotencyKey());

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
      const { startsAt, endsAt } = bookingTimeSlot(
        selection.date, selection.slot, grid.timeZone, grid.slotMinutes
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
        setError(translated.length > 0
          ? problemReference(failure, t)
          : problemMessage(failure, t));
        setRequestKey(idempotencyKey());
      } else {
        setError(problemMessage(failure, t));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const fieldViolations = (field: string) => violations.filter((violation) => violation.field === field);
  const describedBy = (field: string) => fieldViolations(field).length > 0 ? `booking-${field}-errors` : undefined;

  return <Modal labelledBy="booking-heading" closed={closed}>
    <form data-testid="booking-dialog" onSubmit={(event) => void submit(event)} className="surface-panel flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border shadow-2xl">
      <div className="overflow-y-auto p-6">
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
        <select data-testid="booking-card" value={cardId} onChange={(event) => setCardId(event.target.value)} required aria-invalid={fieldViolations("cardId").length > 0} aria-describedby={describedBy("cardId")} className="form-control rounded-lg border px-3 py-3">
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
      <fieldset data-testid="guest-participants" className="mt-4 grid gap-3" aria-invalid={fieldViolations("participants").length > 0} aria-describedby={describedBy("participants")}>
        <legend className="font-semibold">{t("booking.guests")}</legend>
        {guestNames.map((guestName, index) => <label key={index} className="grid gap-2 font-medium">
          {index === 0 ? t("booking.guest") : t("booking.guestNumber", { number: index + 1 })}
          <input data-testid="guest-name" value={guestName} onChange={(event) => setGuestNames((current) => current.map((name, currentIndex) => currentIndex === index ? event.target.value : name))} className="form-control rounded-lg border px-3 py-3" />
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
      {error && <Alert>{error}</Alert>}
      </div>
      <div className="surface-panel border-structural flex shrink-0 justify-end gap-3 border-t px-6 py-4">
        <Button type="button" data-testid="booking-close" className="button-secondary" onClick={closed}>{t("booking.close")}</Button>
        <Button type="submit" data-testid="booking-submit" disabled={submitting || courtIds.length === 0 || !cardId}>{t("booking.submit")}</Button>
      </div>
    </form>
  </Modal>;
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
