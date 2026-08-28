import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type BookingGrid, type CancelScope, type ManagedAppointment, type ManagedAppointmentDetail, type ManagedAppointmentPage, type MovePreview, type MoveRequest, type Participation, type PersonalBooking, type PublicCourt } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { formatBookingPeriod } from "../time/clubZone";
import { SeriesForm } from "./SeriesForm";

type Appointment = PersonalBooking | ManagedAppointment;

export function MyBookingsView({ now, showManaged = false }: { now?: Date; showManaged?: boolean }) {
  const { t, i18n } = useTranslation();
  const translation = useRef(t);
  const [reference] = useState(() => now ?? new Date());
  const [bookings, setBookings] = useState<PersonalBooking[]>([]);
  const [managed, setManaged] = useState<ManagedAppointment[]>([]);
  const [participations, setParticipations] = useState<Participation[]>([]);
  const [courts, setCourts] = useState<PublicCourt[]>([]);
  const [grid, setGrid] = useState<BookingGrid>();
  const [maxBookingMinutes, setMaxBookingMinutes] = useState<number>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [managedNextCursor, setManagedNextCursor] = useState<string>();
  const [participationsNextCursor, setParticipationsNextCursor] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [action, setAction] = useState<{ kind: "cancel" | "move" | "detail"; booking: Appointment; managed: boolean }>();

  useEffect(() => { translation.current = t; }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [page, managedPage, participationPage, availableCourts, bookingGrid] = await Promise.all([
        api.personalBookings(), showManaged ? api.managedAppointments() : Promise.resolve<ManagedAppointmentPage>({ items: [] }),
        api.participations(), api.courts(), api.bookingGrid()
      ]);
      setBookings(page.items);
      setManaged(managedPage.items);
      setParticipations(participationPage.items);
      setParticipationsNextCursor(participationPage.nextCursor ?? undefined);
      setNextCursor(page.nextCursor ?? undefined);
      setManagedNextCursor(managedPage.nextCursor ?? undefined);
      setCourts(availableCourts);
      setGrid(bookingGrid);
      setError(undefined);
    } catch (failure) {
      setError(problemMessage(failure, translation.current));
    } finally {
      setLoading(false);
    }
  }, [showManaged]);

  useEffect(() => { void load(); }, [load]);

  // The bound only fills in a field's maximum, and the server holds the rule either way, so a
  // reading that fails leaves the maximum unset rather than taking the bookings down with it.
  useEffect(() => {
    void api.bookingEligibility()
      .then((eligibility) => setMaxBookingMinutes(eligibility.maxBookingMinutes ?? undefined))
      .catch(() => setMaxBookingMinutes(undefined));
  }, []);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api.personalBookings(nextCursor);
      setBookings((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor ?? undefined);
      setError(undefined);
    } catch (failure) {
      setError(problemMessage(failure, t));
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadMoreParticipations() {
    if (!participationsNextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api.participations(participationsNextCursor);
      setParticipations((current) => [...current, ...page.items]);
      setParticipationsNextCursor(page.nextCursor ?? undefined);
      setError(undefined);
    } catch (failure) {
      setError(problemMessage(failure, t));
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadMoreManaged() {
    if (!managedNextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api.managedAppointments(managedNextCursor);
      setManaged((current) => [...current, ...page.items]);
      setManagedNextCursor(page.nextCursor ?? undefined);
      setError(undefined);
    } catch (failure) {
      setError(problemMessage(failure, t));
    } finally {
      setLoadingMore(false);
    }
  }

  const sections = useMemo(() => ({
    upcoming: bookings
      .filter((booking) => booking.status === "CONFIRMED" && new Date(booking.endsAt) >= reference)
      .toSorted((left, right) => left.startsAt.localeCompare(right.startsAt)),
    past: bookings
      .filter((booking) => booking.status === "CANCELLED" || new Date(booking.endsAt) < reference)
      .toSorted((left, right) => right.startsAt.localeCompare(left.startsAt))
  }), [bookings, reference]);

  const courtNames = new Map(courts.map((court) => [court.id, court.name ?? t("court.number", { number: court.number })]));
  const chooseAction = (chosen: { kind: "cancel" | "move" | "detail"; booking: Appointment; managed: boolean }) => {
    setSuccess(undefined);
    setAction(chosen);
  };
  return <section className="mt-8" aria-labelledby="my-bookings-title">
    <h2 id="my-bookings-title" data-testid="my-bookings-title" className="text-2xl font-bold">{t("myBookings.title")}</h2>
    {error && <Alert>{error}</Alert>}
    {success && <SuccessFeedback>{success}</SuccessFeedback>}
    {loading ? <p aria-live="polite">{t("status.loading")}</p> : grid && <div className="mt-4 grid gap-8 lg:grid-cols-2">
      <BookingSection testId="upcoming-bookings" title={t("myBookings.upcoming")} empty={t("myBookings.noUpcoming")} bookings={sections.upcoming} courtNames={courtNames} locale={i18n.language} timeZone={grid.timeZone} actionable action={chooseAction} t={t} />
      <BookingSection testId="past-bookings" title={t("myBookings.past")} empty={t("myBookings.noPast")} bookings={sections.past} courtNames={courtNames} locale={i18n.language} timeZone={grid.timeZone} action={chooseAction} t={t} />
    </div>}
    {nextCursor && <Button data-testid="load-more-bookings" className="mt-6" disabled={loadingMore} onClick={() => void loadMore()}>{t("myBookings.loadMore")}</Button>}
    {showManaged && grid && <section className="border-structural mt-10 border-t pt-8" aria-labelledby="managed-appointments-title">
      <h2 id="managed-appointments-title" data-testid="managed-appointments-title" className="text-2xl font-bold">{t("managedAppointments.title")}</h2>
      <p className="text-muted mt-2">{t("managedAppointments.description")}</p>
      <div className="mt-4"><BookingSection testId="managed-bookings" title={t("managedAppointments.appointments")} empty={t("managedAppointments.empty")} bookings={managed} courtNames={courtNames} locale={i18n.language} timeZone={grid.timeZone} actionable managed action={chooseAction} t={t} /></div>
      {managedNextCursor && <Button className="mt-6" disabled={loadingMore} onClick={() => void loadMoreManaged()}>{t("managedAppointments.loadMore")}</Button>}
      <SeriesForm timeZone={grid.timeZone} courts={courts} created={async () => { await load(); setSuccess(t("series.createdSuccess")); }} reportError={(failure) => { setSuccess(undefined); setError(problemMessage(failure, t)); }} />
    </section>}
    {!loading && grid && <ParticipationSection participations={participations} courtNames={courtNames} locale={i18n.language} timeZone={grid.timeZone} withdrawn={async () => { await load(); setSuccess(t("participations.withdrawn")); }} nextCursor={participationsNextCursor} loadingMore={loadingMore} loadMore={loadMoreParticipations} t={t} />}
    {grid && action?.kind === "cancel" && <CancelDialog booking={action.booking} seriesBookings={(action.managed ? managed : bookings).filter((booking) => booking.seriesId === action.booking.seriesId && booking.status === "CONFIRMED")} hasMoreBookings={(action.managed ? managedNextCursor : nextCursor) !== undefined} timeZone={grid.timeZone} closed={() => setAction(undefined)} completed={async () => { setAction(undefined); await load(); setSuccess(t("booking.cancelledSuccess")); }} />}
    {grid && action?.kind === "move" && <MoveDialog booking={action.booking} courts={courts} timeZone={grid.timeZone} maxBookingMinutes={maxBookingMinutes} closed={() => setAction(undefined)} completed={async () => { setAction(undefined); await load(); setSuccess(t("booking.moved")); }} />}
    {grid && action?.kind === "detail" && <ManagedAppointmentDialog bookingId={action.booking.id} locale={i18n.language} timeZone={grid.timeZone} closed={() => setAction(undefined)} />}
  </section>;
}

function ParticipationSection({ participations, courtNames, locale, timeZone, withdrawn, nextCursor, loadingMore, loadMore, t }: {
  participations: Participation[]; courtNames: Map<string, string>; locale: string; timeZone: string;
  withdrawn: () => Promise<void>; nextCursor?: string; loadingMore: boolean;
  loadMore: () => Promise<void>; t: Translate;
}) {
  const [leaving, setLeaving] = useState<string>();
  const [error, setError] = useState<string>();

  async function withdraw(bookingId: string) {
    setLeaving(bookingId);
    try {
      await api.withdrawParticipation(bookingId);
      setError(undefined);
      await withdrawn();
    } catch (failure) {
      setError(problemMessage(failure, t));
    } finally {
      setLeaving(undefined);
    }
  }

  return <section className="border-structural mt-10 border-t pt-8" aria-labelledby="participations-title">
    <h2 id="participations-title" data-testid="participations-title" className="text-2xl font-bold">{t("participations.title")}</h2>
    <p className="text-muted mt-2">{t("participations.description")}</p>
    {error && <Alert>{error}</Alert>}
    <div data-testid="participations" className="mt-4">
      {participations.length === 0 ? <p className="text-muted">{t("participations.empty")}</p>
        : <ul className="grid gap-3">{participations.map((participation) =>
          <li key={participation.id} data-testid={`participation-${participation.id}`} data-status={participation.status} className="border-structural grid gap-1 rounded-xl border p-4">
            <span className="font-semibold">{participation.cardLabel}</span>
            <span>{formatBookingPeriod(participation.startsAt, participation.endsAt, locale, timeZone)}</span>
            <span>{participation.courtIds.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ")}</span>
            {participation.status === "CANCELLED" && <span>{t("myBookings.cancelled")}</span>}
            <div className="pt-1">
              <Button data-testid="withdraw-participation" data-booking-id={participation.id} className="px-3 py-2" disabled={leaving === participation.id} onClick={() => void withdraw(participation.id)}>{t("participations.withdraw")}</Button>
            </div>
          </li>)}</ul>}
    </div>
    {nextCursor && <Button data-testid="load-more-participations" className="mt-6" disabled={loadingMore} onClick={() => void loadMore()}>{t("participations.loadMore")}</Button>}
  </section>;
}

type Translate = ReturnType<typeof useTranslation>["t"];

function BookingSection({ testId, title, empty, bookings, courtNames, locale, timeZone, actionable = false, managed = false, action, t }: {
  testId: string; title: string; empty: string; bookings: Appointment[]; courtNames: Map<string, string>;
  locale: string; timeZone: string; actionable?: boolean; managed?: boolean; action: (value: { kind: "cancel" | "move" | "detail"; booking: Appointment; managed: boolean }) => void; t: Translate;
}) {
  const groups = groupBookings(bookings);
  return <section data-testid={testId}>
    <h3 className="text-xl font-semibold">{title}</h3>
    {groups.length === 0 ? <p className="text-muted mt-3">{empty}</p> : <div className="mt-3 grid gap-4">{groups.map((group) =>
      <article key={group.key} className="border-structural rounded-xl border p-4">
        {group.series && <p data-testid="series-marker" className="mb-2 font-semibold">{t("myBookings.series")}</p>}
        <ul className="grid gap-3">{group.bookings.map((booking) => <li key={booking.id} data-testid={`booking-${booking.id}`} data-status={booking.status} className="border-structural grid gap-1 border-b pb-3 last:border-0 last:pb-0">
          <span className="font-semibold">{booking.cardLabel}</span>
          <span>{formatBookingPeriod(booking.startsAt, booking.endsAt, locale, timeZone)}</span>
          <span>{booking.courtIds.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ")}</span>
          {booking.status === "CANCELLED" && <span>{t("myBookings.cancelled")}</span>}
          {managed && "participantCount" in booking && <span>{t("managedAppointments.participants", { count: booking.participantCount })}</span>}
          {actionable && <div className="flex flex-wrap gap-2 pt-1">
            {managed && <Button data-testid="managed-details" className="button-secondary px-3 py-2" onClick={() => action({ kind: "detail", booking, managed })}>{t("managedAppointments.details")}</Button>}
            {booking.status === "CONFIRMED" && <>
              <Button aria-label={bookingActionName("myBookings.cancelAccessible", booking, courtNames, locale, timeZone, t)} data-testid={managed ? "managed-cancel" : "personal-cancel"} data-booking-id={booking.id} className="px-3 py-2" onClick={() => action({ kind: "cancel", booking, managed })}>{t("myBookings.cancel")}</Button>
              {booking.seriesId && <Button aria-label={bookingActionName("myBookings.moveAccessible", booking, courtNames, locale, timeZone, t)} data-testid="move-booking" className="px-3 py-2" onClick={() => action({ kind: "move", booking, managed })}>{t("myBookings.move")}</Button>}
            </>}
          </div>}
        </li>)}</ul>
      </article>)}</div>}
  </section>;
}

function bookingActionName(key: string, booking: Appointment, courtNames: Map<string, string>, locale: string, timeZone: string, t: Translate) {
  return t(key, {
    label: booking.cardLabel,
    period: formatBookingPeriod(booking.startsAt, booking.endsAt, locale, timeZone),
    courts: booking.courtIds.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ")
  });
}

function groupBookings(bookings: Appointment[]) {
  const groups = new Map<string, Appointment[]>();
  for (const booking of bookings) {
    const key = booking.seriesId ?? booking.id;
    groups.set(key, [...(groups.get(key) ?? []), booking]);
  }
  return [...groups].map(([key, entries]) => ({ key, series: entries[0].seriesId !== null && entries[0].seriesId !== undefined, bookings: entries }));
}

function ScopeFields({ scope, changed, t }: { scope: CancelScope; changed: (scope: CancelScope) => void; t: Translate }) {
  return <fieldset className="grid gap-2"><legend className="font-semibold">{t("myBookings.scope")}</legend>
    {(["THIS", "THIS_AND_FOLLOWING", "WHOLE_SERIES"] as CancelScope[]).map((value) => <label key={value} className="flex gap-2">
      <input data-testid={`scope-${value}`} type="radio" name="scope" checked={scope === value} onChange={() => changed(value)} />{t(`myBookings.scope.${value}`)}
    </label>)}
  </fieldset>;
}

function CancelDialog({ booking, seriesBookings, hasMoreBookings, timeZone, closed, completed }: { booking: Appointment; seriesBookings: Appointment[]; hasMoreBookings: boolean; timeZone: string; closed: () => void; completed: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<CancelScope>("THIS");
  const [error, setError] = useState<string>();
  async function submit() {
    try {
      if (booking.seriesId) await api.cancelSeries(booking.seriesId, booking.id, scope);
      else await api.cancelBooking(booking.id);
      await completed();
    } catch (failure) { setError(problemMessage(failure, t)); }
  }
  const affected = scope === "THIS" ? [booking] : scope === "WHOLE_SERIES"
    ? seriesBookings
    : seriesBookings.filter((candidate) => new Date(candidate.startsAt) >= new Date(booking.startsAt));
  return <Modal labelledBy="cancel-personal-title" closed={closed}><div className="surface-panel grid w-full max-w-lg gap-4 rounded-2xl border p-6">
    <h2 id="cancel-personal-title" className="text-xl font-bold">{t("booking.cancelTitle")}</h2>
    {booking.seriesId && <ScopeFields scope={scope} changed={setScope} t={t} />}
    <p className="font-semibold">{t("myBookings.affected", { count: affected.length })}</p>
    <ul className="list-disc pl-5">{affected.map((candidate) => <li key={candidate.id}>{formatBookingPeriod(candidate.startsAt, candidate.endsAt, i18n.language, timeZone)}</li>)}</ul>
    {hasMoreBookings && scope !== "THIS" && <p data-testid="incomplete-series-warning">{t("myBookings.affectedIncomplete")}</p>}
    {error && <Alert>{error}</Alert>}
    <div className="flex gap-2"><Button data-testid="confirm-cancellation" onClick={() => void submit()}>{t("booking.cancelConfirm")}</Button><Button className="button-secondary" onClick={closed}>{t("booking.close")}</Button></div>
  </div></Modal>;
}

function MoveDialog({ booking, courts, timeZone, maxBookingMinutes, closed, completed }: { booking: Appointment; courts: PublicCourt[]; timeZone: string; maxBookingMinutes?: number; closed: () => void; completed: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<CancelScope>("THIS");
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState("");
  const [courtIds, setCourtIds] = useState<string[]>(booking.courtIds);
  const [preview, setPreview] = useState<MovePreview>();
  const [error, setError] = useState<string>();
  const request: MoveRequest = {
    fromBookingId: booking.id, scope,
    ...(startTime ? { newStartTime: startTime } : {}),
    ...(duration ? { newDurationMinutes: Number(duration) } : {}),
    ...(courtIds.join() !== booking.courtIds.join() ? { newCourtIds: courtIds } : {})
  };
  const courtNames = new Map(courts.map((court) => [court.id, court.name ?? t("court.number", { number: court.number })]));
  async function previewMove() {
    try { setPreview(await api.previewSeriesMove(booking.seriesId!, request)); setError(undefined); }
    catch (failure) { setError(problemMessage(failure, t)); }
  }
  async function move() {
    try { await api.moveSeries(booking.seriesId!, request); await completed(); }
    catch (failure) { setError(problemMessage(failure, t)); }
  }
  return <Modal labelledBy="move-personal-title" closed={closed}><div data-testid="move-dialog" className="surface-panel grid w-full max-w-lg gap-4 rounded-2xl border p-6">
    <h2 id="move-personal-title" className="text-xl font-bold">{t("myBookings.moveTitle")}</h2>
    <ScopeFields scope={scope} changed={(value) => { setScope(value); setPreview(undefined); }} t={t} />
    <label className="grid gap-1 font-semibold">{t("myBookings.newStartTime")}<input data-testid="move-start-time" type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); setPreview(undefined); }} className="form-control rounded border p-2" /></label>
    <label className="grid gap-1 font-semibold">{t("myBookings.newDuration")}<input data-testid="move-duration" type="number" min="1" max={maxBookingMinutes} value={duration} onChange={(event) => { setDuration(event.target.value); setPreview(undefined); }} className="form-control rounded border p-2" /></label>
    <fieldset><legend className="font-semibold">{t("booking.courts")}</legend>{courts.map((court) => <label key={court.id} className="flex gap-2"><input type="checkbox" checked={courtIds.includes(court.id)} onChange={(event) => { setCourtIds((ids) => event.target.checked ? [...ids, court.id] : ids.filter((id) => id !== court.id)); setPreview(undefined); }} />{court.name ?? t("court.number", { number: court.number })}</label>)}</fieldset>
    {error && <Alert>{error}</Alert>}
    {preview && <div data-testid="move-preview"><p className="font-semibold">{t("myBookings.previewCount", { count: preview.moves.length })}</p><ul className="mt-2 grid gap-2">{preview.moves.map((move) => <li key={move.bookingId}><p>{formatBookingPeriod(move.fromStartsAt, move.fromEndsAt, i18n.language, timeZone)} → {formatBookingPeriod(move.toStartsAt, move.toEndsAt, i18n.language, timeZone)}</p><MoveReasons move={move} courtNames={courtNames} t={t} /></li>)}</ul></div>}
    <div className="flex gap-2">{preview ? <Button data-testid="confirm-move" disabled={!preview.executable} onClick={() => void move()}>{t("myBookings.moveConfirm")}</Button> : <Button data-testid="preview-move" disabled={courtIds.length === 0 || (!startTime && !duration && courtIds.join() === booking.courtIds.join())} onClick={() => void previewMove()}>{t("myBookings.movePreview")}</Button>}<Button className="button-secondary" onClick={closed}>{t("booking.close")}</Button></div>
  </div></Modal>;
}

function ManagedAppointmentDialog({ bookingId, locale, timeZone, closed }: { bookingId: string; locale: string; timeZone: string; closed: () => void }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ManagedAppointmentDetail>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void api.managedAppointment(bookingId)
      .then((appointment) => { if (active) setDetail(appointment); })
      .catch((failure) => { if (active) setError(problemMessage(failure, t)); });
    return () => { active = false; };
  }, [bookingId, t]);

  return <Modal labelledBy="managed-appointment-detail-title" closed={closed}><div className="surface-panel grid w-full max-w-lg gap-4 rounded-2xl border p-6">
    <h2 id="managed-appointment-detail-title" className="text-xl font-bold">{t("managedAppointments.detailTitle")}</h2>
    {error && <Alert>{error}</Alert>}
    {!detail && !error && <p aria-live="polite">{t("status.loading")}</p>}
    {detail && <>
      <p data-testid="managed-card-label" className="font-semibold">{detail.cardLabel}</p>
      <span data-testid="managed-period">{formatBookingPeriod(detail.startsAt, detail.endsAt, locale, timeZone)}</span>
      <section data-testid="managed-note"><h3 className="font-semibold">{t("managedAppointments.note")}</h3><p>{detail.note || t("managedAppointments.noNote")}</p></section>
      <section data-testid="managed-participants"><h3 className="font-semibold">{t("managedAppointments.participantDetails")}</h3>
        {detail.participants.length === 0 ? <p>{t("managedAppointments.noParticipants")}</p> : <ul className="list-disc pl-5">{detail.participants.map((participant, index) => <li key={`${participant.kind}-${index}`}>{participant.displayName} · {t(`managedAppointments.kind.${participant.kind}`)}</li>)}</ul>}
      </section>
    </>}
    <div><Button data-testid="close-managed-appointment" className="button-secondary" onClick={closed}>{t("booking.close")}</Button></div>
  </div></Modal>;
}

function MoveReasons({ move, courtNames, t }: { move: MovePreview["moves"][number]; courtNames: Map<string, string>; t: Translate }) {
  const names = (ids: string[]) => ids.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ");
  return <ul className="list-disc pl-5">
    {move.violations.map((violation) => <li data-code={violation.code} key={`${move.bookingId}-${violation.code}`}>{t(violation.code, { ...violation.params, defaultValue: t("error.generic") })}</li>)}
    {move.blockedCourtIds.length > 0 && <li data-testid="occupied-courts">{t("myBookings.occupiedCourts", { courts: names(move.blockedCourtIds) })}</li>}
    {move.unbookableCourtIds.length > 0 && <li data-testid="unavailable-courts">{t("myBookings.unavailableCourts", { courts: names(move.unbookableCourtIds) })}</li>}
  </ul>;
}
