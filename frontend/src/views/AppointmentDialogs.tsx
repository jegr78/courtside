import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api, type AttendanceOutcome, type CancellationReason, type CancelScope, type ManagedAppointment, type ManagedAppointmentDetail,
  type MovePreview, type MoveRequest, type PersonalBooking, type PublicCourt
} from "../api/client";
import { violationMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { DateTimeInput } from "../components/DateTimeInput";
import { DialogBody } from "../components/DialogBody";
import { Modal } from "../components/Modal";
import { useReportedFailure } from "../failures/useReportedFailure";
import { formatBookingPeriod } from "../time/clubZone";
import { CancellationReasonField } from "./CancellationReasonField";

export type Appointment = PersonalBooking | ManagedAppointment;
type Translate = ReturnType<typeof useTranslation>["t"];

function ScopeFields({ scope, changed, t }: { scope: CancelScope; changed: (scope: CancelScope) => void; t: Translate }) {
  return <fieldset className="grid gap-2"><legend className="font-semibold">{t("myBookings.scope")}</legend>
    {(["THIS", "THIS_AND_FOLLOWING", "WHOLE_SERIES"] as CancelScope[]).map((value) => <label key={value} className="flex gap-2">
      <input data-testid={`scope-${value}`} type="radio" name="scope" checked={scope === value} onChange={() => changed(value)} />{t(`myBookings.scope.${value}`)}
    </label>)}
  </fieldset>;
}

export function CancelDialog({ booking, seriesBookings, incompleteSeries, timeZone, now = new Date(), closed, completed, cancelOne }: { booking: Appointment; seriesBookings: Appointment[]; incompleteSeries: boolean; timeZone: string; now?: Date; closed: () => void; completed: () => Promise<void>; cancelOne?: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<CancelScope>("THIS");
  const [reason, setReason] = useState<CancellationReason>();
  const { message: error, report } = useReportedFailure();
  const foreign = !cancelOne && "ownBooking" in booking && !booking.ownBooking;
  const series = !cancelOne && booking.seriesId;
  async function submit() {
    try {
      if (cancelOne) await cancelOne();
      else if (booking.seriesId) await api.cancelSeries(booking.seriesId, booking.id, scope, reason);
      else await api.cancelBooking(booking.id, reason);
      await completed();
    } catch (failure) { report(failure); }
  }
  // The series scopes skip an occurrence that has started, as the server does.
  const upcoming = seriesBookings.filter((candidate) => new Date(candidate.startsAt) > now);
  const affected = scope === "THIS" ? [booking] : scope === "WHOLE_SERIES"
    ? upcoming
    : upcoming.filter((candidate) => new Date(candidate.startsAt) >= new Date(booking.startsAt));
  return <Modal labelledBy="cancel-personal-title" closed={closed} width="lg" composed>
    <DialogBody><div className="grid gap-4">
    <h2 id="cancel-personal-title" className="text-xl font-bold">{t("booking.cancelTitle")}</h2>
    {series && <ScopeFields scope={scope} changed={setScope} t={t} />}
    <p data-testid="affected-count" className="font-semibold">{t("myBookings.affected", { count: affected.length })}</p>
    <ul data-testid="affected-occurrences" className="list-disc pl-5">{affected.map((candidate) => <li key={candidate.id}>{formatBookingPeriod(candidate.startsAt, candidate.endsAt, i18n.language, timeZone)}</li>)}</ul>
    {incompleteSeries && scope !== "THIS" && <p data-testid="incomplete-series-warning">{t("myBookings.affectedIncomplete")}</p>}
    {foreign && <CancellationReasonField reason={reason} changed={setReason} />}
    </div></DialogBody>
    {error && <div className="shrink-0 px-6 pt-3"><Alert>{error}</Alert></div>}
    <div className="surface-panel border-structural flex shrink-0 gap-2 border-t px-6 py-4"><Button variant="destructive-confirm" data-testid="confirm-cancellation" onClick={() => void submit()}>{t("booking.cancelConfirm")}</Button><Button variant="secondary" onClick={closed}>{t("booking.close")}</Button></div>
  </Modal>;
}

export function MoveDialog({ booking, courts, timeZone, maxBookingMinutes, closed, completed }: { booking: Appointment; courts: PublicCourt[]; timeZone: string; maxBookingMinutes?: number; closed: () => void; completed: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<CancelScope>("THIS");
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState("");
  const [courtIds, setCourtIds] = useState<string[]>(booking.courtIds);
  const [preview, setPreview] = useState<MovePreview>();
  const { message: error, report, clear } = useReportedFailure();
  const dialog = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const previewPanel = useRef<HTMLDivElement>(null);
  const previewCount = useId();
  // The preview replaces the focused button, so the focus is returned to the dialog.
  useLayoutEffect(() => {
    if (!preview || dialog.current?.contains(document.activeElement)) return;
    if (preview.executable) confirmButton.current?.focus();
    else previewPanel.current?.focus();
  }, [preview]);
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
  return <Modal labelledBy="move-personal-title" closed={closed} width="lg" composed testId="move-dialog"><div ref={dialog} className="flex min-h-0 flex-col">
    <DialogBody><div className="grid gap-4">
    <h2 id="move-personal-title" className="text-xl font-bold">{t(`myBookings.moveTitle.${scope}`)}</h2>
    <ScopeFields scope={scope} changed={(value) => { setScope(value); setPreview(undefined); }} t={t} />
    <label className="grid gap-1 font-semibold">{t("myBookings.newStartTime")}<DateTimeInput data-testid="move-start-time" type="time" emptyHint={t("myBookings.startUnchanged")} value={startTime} onValueChange={(value) => { setStartTime(value); setPreview(undefined); }} className="form-control rounded border px-3 py-2" /></label>
    <label className="grid gap-1 font-semibold">{t("myBookings.newDuration")}<input data-testid="move-duration" type="number" min="1" max={maxBookingMinutes} value={duration} onChange={(event) => { setDuration(event.target.value); setPreview(undefined); }} className="form-control rounded border p-2" /></label>
    <fieldset><legend className="font-semibold">{t("booking.courts")}</legend>{courts.map((court) => <label key={court.id} className="flex gap-2"><input type="checkbox" checked={courtIds.includes(court.id)} onChange={(event) => { setCourtIds((ids) => event.target.checked ? [...ids, court.id] : ids.filter((id) => id !== court.id)); setPreview(undefined); }} />{court.name ?? t("court.number", { number: court.number })}</label>)}</fieldset>
    {preview && <div ref={previewPanel} tabIndex={-1} role="group" aria-labelledby={previewCount} data-testid="move-preview" className="focus-ring"><p id={previewCount} className="font-semibold">{t("myBookings.previewCount", { count: preview.moves.length })}</p><ul className="mt-2 grid gap-2">{preview.moves.map((move) => <li key={move.bookingId}><p>{formatBookingPeriod(move.fromStartsAt, move.fromEndsAt, i18n.language, timeZone)} → {formatBookingPeriod(move.toStartsAt, move.toEndsAt, i18n.language, timeZone)}</p><MoveReasons move={move} courtNames={courtNames} t={t} /></li>)}</ul></div>}
    </div></DialogBody>
    {error && <div className="shrink-0 px-6 pt-3"><Alert>{error}</Alert></div>}
    <div className="surface-panel border-structural flex shrink-0 gap-2 border-t px-6 py-4">{preview ? <Button ref={confirmButton} key="confirm-move" variant="primary" data-testid="confirm-move" aria-describedby={preview.executable ? previewCount : undefined} disabled={!preview.executable} onClick={() => void move()}>{t("myBookings.moveConfirm")}</Button> : <Button key="preview-move" variant="secondary" data-testid="preview-move" disabled={courtIds.length === 0 || (!startTime && !duration && courtIds.join() === booking.courtIds.join())} onClick={() => void previewMove()}>{t("myBookings.movePreview")}</Button>}<Button variant="secondary" onClick={closed}>{t("booking.close")}</Button></div>
  </div></Modal>;
}

function AttendanceSection({ detail, recordable, changed, t }: {
  detail: ManagedAppointmentDetail;
  recordable: boolean;
  changed: (outcome?: AttendanceOutcome) => Promise<void>;
  t: Translate;
}) {
  const [pending, setPending] = useState(false);
  async function change(outcome?: AttendanceOutcome) {
    setPending(true);
    try {
      await changed(outcome);
    } finally {
      setPending(false);
    }
  }
  return <section data-testid="managed-attendance" className="grid gap-2"><h3 className="font-semibold">{t("managedAppointments.attendance")}</h3>
    <p data-testid="managed-attendance-state">{detail.attendance ? t(`managedAppointments.attendance.${detail.attendance}`) : t("managedAppointments.attendance.none")}</p>
    {recordable && <div className="flex flex-wrap gap-2">
      <Button variant="secondary" data-testid="attendance-attended" className="px-3 py-2" disabled={pending || detail.attendance === "ATTENDED"}
        onClick={() => void change("ATTENDED")}>{t("managedAppointments.attendance.record.ATTENDED")}</Button>
      <Button variant="secondary" data-testid="attendance-no-show" className="px-3 py-2" disabled={pending || detail.attendance === "NO_SHOW"}
        onClick={() => void change("NO_SHOW")}>{t("managedAppointments.attendance.record.NO_SHOW")}</Button>
      {detail.attendance && <Button variant="secondary" data-testid="attendance-clear" className="px-3 py-2" disabled={pending}
        onClick={() => void change(undefined)}>{t("managedAppointments.attendance.clear")}</Button>}
    </div>}
  </section>;
}

export function ManagedAppointmentDialog({ bookingId, locale, timeZone, administrator = false, closed }: { bookingId: string; locale: string; timeZone: string; administrator?: boolean; closed: () => void }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ManagedAppointmentDetail>();
  const [tracked, setTracked] = useState(false);
  const [begun, setBegun] = useState(false);
  const { message: error, report, clear } = useReportedFailure();

  useEffect(() => {
    let active = true;
    void api.managedAppointment(bookingId)
      .then((appointment) => {
        if (!active) return;
        setDetail(appointment);
        setBegun(Date.parse(appointment.startsAt) <= Date.now());
      })
      .catch((failure) => { if (active) report(failure); });
    if (administrator) {
      void api.attendancePolicy()
        .then((policy) => { if (active) setTracked(policy.enabled); })
        .catch((failure) => { if (active) report(failure); });
    }
    return () => { active = false; };
  }, [administrator, bookingId, report]);

  async function changeAttendance(outcome?: AttendanceOutcome) {
    clear();
    try {
      if (outcome) await api.recordAttendance(bookingId, outcome);
      else await api.clearAttendance(bookingId);
      setDetail(await api.managedAppointment(bookingId));
    } catch (failure) {
      report(failure);
    }
  }

  return <Modal labelledBy="managed-appointment-detail-title" closed={closed} width="lg" composed>
    <DialogBody><div className="grid gap-4">
    <h2 id="managed-appointment-detail-title" className="text-xl font-bold">{t("managedAppointments.detailTitle")}</h2>
    {error && <Alert>{error}</Alert>}
    {!detail && !error && <p aria-live="polite">{t("status.loading")}</p>}
    {detail && <>
      <p data-testid="managed-card-label" className="font-semibold">{detail.cardLabel}</p>
      <span data-testid="managed-period">{formatBookingPeriod(detail.startsAt, detail.endsAt, locale, timeZone)}</span>
      <section data-testid="managed-note"><h3 className="font-semibold">{t("managedAppointments.note")}</h3><p>{detail.note || t("managedAppointments.noNote")}</p></section>
      <section data-testid="managed-participants"><h3 className="font-semibold">{t("managedAppointments.participantDetails")}</h3>
        {detail.participants.length === 0 ? <p>{t("managedAppointments.noParticipants")}</p> : <ul className="list-disc pl-5">{detail.participants.map((participant, index) => <li key={`${participant.kind}-${index}`} data-testid="appointment-participant">{participant.displayName || t("managedAppointments.unnamedGuest")} · {t(`managedAppointments.kind.${participant.kind}`)}</li>)}</ul>}
      </section>
      {(detail.attendance || (tracked && begun)) && <AttendanceSection detail={detail} recordable={tracked && begun}
        changed={changeAttendance} t={t} />}
    </>}
    </div></DialogBody>
    <div className="surface-panel border-structural flex shrink-0 gap-2 border-t px-6 py-4"><Button variant="secondary" data-testid="close-managed-appointment" onClick={closed}>{t("booking.close")}</Button></div>
  </Modal>;
}

function MoveReasons({ move, courtNames, t }: { move: MovePreview["moves"][number]; courtNames: Map<string, string>; t: Translate }) {
  const names = (ids: string[]) => ids.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ");
  return <ul className="list-disc pl-5">
    {move.violations.map((violation) => <li data-code={violation.code} key={`${move.bookingId}-${violation.code}`}>{violationMessage(violation.code, violation.params, t)}</li>)}
    {move.blockedCourtIds.length > 0 && <li data-testid="occupied-courts">{t("myBookings.occupiedCourts", { courts: names(move.blockedCourtIds) })}</li>}
    {move.unbookableCourtIds.length > 0 && <li data-testid="unavailable-courts">{t("myBookings.unavailableCourts", { courts: names(move.unbookableCourtIds) })}</li>}
  </ul>;
}
