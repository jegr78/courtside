import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api, type CancelScope, type ManagedAppointment, type ManagedAppointmentDetail,
  type MovePreview, type MoveRequest, type PersonalBooking, type PublicCourt
} from "../api/client";
import { violationMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { useReportedFailure } from "../failures/useReportedFailure";
import { formatBookingPeriod } from "../time/clubZone";

export type Appointment = PersonalBooking | ManagedAppointment;
type Translate = ReturnType<typeof useTranslation>["t"];

function ScopeFields({ scope, changed, t }: { scope: CancelScope; changed: (scope: CancelScope) => void; t: Translate }) {
  return <fieldset className="grid gap-2"><legend className="font-semibold">{t("myBookings.scope")}</legend>
    {(["THIS", "THIS_AND_FOLLOWING", "WHOLE_SERIES"] as CancelScope[]).map((value) => <label key={value} className="flex gap-2">
      <input data-testid={`scope-${value}`} type="radio" name="scope" checked={scope === value} onChange={() => changed(value)} />{t(`myBookings.scope.${value}`)}
    </label>)}
  </fieldset>;
}

export function CancelDialog({ booking, seriesBookings, hasMoreBookings, timeZone, closed, completed }: { booking: Appointment; seriesBookings: Appointment[]; hasMoreBookings: boolean; timeZone: string; closed: () => void; completed: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<CancelScope>("THIS");
  const { message: error, report } = useReportedFailure();
  async function submit() {
    try {
      if (booking.seriesId) await api.cancelSeries(booking.seriesId, booking.id, scope);
      else await api.cancelBooking(booking.id);
      await completed();
    } catch (failure) { report(failure); }
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
    <div className="flex gap-2"><Button variant="destructive-confirm" data-testid="confirm-cancellation" onClick={() => void submit()}>{t("booking.cancelConfirm")}</Button><Button variant="secondary" onClick={closed}>{t("booking.close")}</Button></div>
  </div></Modal>;
}

export function MoveDialog({ booking, courts, timeZone, maxBookingMinutes, closed, completed }: { booking: Appointment; courts: PublicCourt[]; timeZone: string; maxBookingMinutes?: number; closed: () => void; completed: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<CancelScope>("THIS");
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState("");
  const [courtIds, setCourtIds] = useState<string[]>(booking.courtIds);
  const [preview, setPreview] = useState<MovePreview>();
  const { message: error, report, clear } = useReportedFailure();
  const request: MoveRequest = {
    fromBookingId: booking.id, scope,
    ...(startTime ? { newStartTime: startTime } : {}),
    ...(duration ? { newDurationMinutes: Number(duration) } : {}),
    ...(courtIds.join() !== booking.courtIds.join() ? { newCourtIds: courtIds } : {})
  };
  const courtNames = new Map(courts.map((court) => [court.id, court.name ?? t("court.number", { number: court.number })]));
  async function previewMove() {
    try { setPreview(await api.previewSeriesMove(booking.seriesId!, request)); clear(); }
    catch (failure) { report(failure); }
  }
  async function move() {
    try { await api.moveSeries(booking.seriesId!, request); await completed(); }
    catch (failure) { report(failure); }
  }
  return <Modal labelledBy="move-personal-title" closed={closed}><div data-testid="move-dialog" className="surface-panel grid w-full max-w-lg gap-4 rounded-2xl border p-6">
    <h2 id="move-personal-title" className="text-xl font-bold">{t("myBookings.moveTitle")}</h2>
    <ScopeFields scope={scope} changed={(value) => { setScope(value); setPreview(undefined); }} t={t} />
    <label className="grid gap-1 font-semibold">{t("myBookings.newStartTime")}<input data-testid="move-start-time" type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); setPreview(undefined); }} className="form-control rounded border p-2" /></label>
    <label className="grid gap-1 font-semibold">{t("myBookings.newDuration")}<input data-testid="move-duration" type="number" min="1" max={maxBookingMinutes} value={duration} onChange={(event) => { setDuration(event.target.value); setPreview(undefined); }} className="form-control rounded border p-2" /></label>
    <fieldset><legend className="font-semibold">{t("booking.courts")}</legend>{courts.map((court) => <label key={court.id} className="flex gap-2"><input type="checkbox" checked={courtIds.includes(court.id)} onChange={(event) => { setCourtIds((ids) => event.target.checked ? [...ids, court.id] : ids.filter((id) => id !== court.id)); setPreview(undefined); }} />{court.name ?? t("court.number", { number: court.number })}</label>)}</fieldset>
    {error && <Alert>{error}</Alert>}
    {preview && <div data-testid="move-preview"><p className="font-semibold">{t("myBookings.previewCount", { count: preview.moves.length })}</p><ul className="mt-2 grid gap-2">{preview.moves.map((move) => <li key={move.bookingId}><p>{formatBookingPeriod(move.fromStartsAt, move.fromEndsAt, i18n.language, timeZone)} → {formatBookingPeriod(move.toStartsAt, move.toEndsAt, i18n.language, timeZone)}</p><MoveReasons move={move} courtNames={courtNames} t={t} /></li>)}</ul></div>}
    <div className="flex gap-2">{preview ? <Button variant="primary" data-testid="confirm-move" disabled={!preview.executable} onClick={() => void move()}>{t("myBookings.moveConfirm")}</Button> : <Button variant="secondary" data-testid="preview-move" disabled={courtIds.length === 0 || (!startTime && !duration && courtIds.join() === booking.courtIds.join())} onClick={() => void previewMove()}>{t("myBookings.movePreview")}</Button>}<Button variant="secondary" onClick={closed}>{t("booking.close")}</Button></div>
  </div></Modal>;
}

export function ManagedAppointmentDialog({ bookingId, locale, timeZone, closed }: { bookingId: string; locale: string; timeZone: string; closed: () => void }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ManagedAppointmentDetail>();
  const { message: error, report } = useReportedFailure();

  useEffect(() => {
    let active = true;
    void api.managedAppointment(bookingId)
      .then((appointment) => { if (active) setDetail(appointment); })
      .catch((failure) => { if (active) report(failure); });
    return () => { active = false; };
  }, [bookingId, report]);

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
    <div><Button variant="secondary" data-testid="close-managed-appointment" onClick={closed}>{t("booking.close")}</Button></div>
  </div></Modal>;
}

function MoveReasons({ move, courtNames, t }: { move: MovePreview["moves"][number]; courtNames: Map<string, string>; t: Translate }) {
  const names = (ids: string[]) => ids.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ");
  return <ul className="list-disc pl-5">
    {move.violations.map((violation) => <li data-code={violation.code} key={`${move.bookingId}-${violation.code}`}>{violationMessage(violation.code, violation.params, t)}</li>)}
    {move.blockedCourtIds.length > 0 && <li data-testid="occupied-courts">{t("myBookings.occupiedCourts", { courts: names(move.blockedCourtIds) })}</li>}
    {move.unbookableCourtIds.length > 0 && <li data-testid="unavailable-courts">{t("myBookings.unavailableCourts", { courts: names(move.unbookableCourtIds) })}</li>}
  </ul>;
}
