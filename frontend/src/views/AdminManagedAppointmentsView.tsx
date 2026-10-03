import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api, type BookingGrid, type ManagedAppointment, type ManagedAppointmentView,
  type PublicBookingCard, type PublicCourt
} from "../api/client";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { useReportedFailure } from "../failures/useReportedFailure";
import { formatBookingPeriod } from "../time/clubZone";
import { CancelDialog, ManagedAppointmentDialog, MoveDialog } from "./AppointmentDialogs";
import { SeriesForm } from "./SeriesForm";

const PAGE_SIZE = 20;

export function AdminManagedAppointmentsView() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<ManagedAppointmentView>("UPCOMING");
  const [courtId, setCourtId] = useState("");
  const [cardId, setCardId] = useState("");
  const [appointments, setAppointments] = useState<ManagedAppointment[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [courts, setCourts] = useState<PublicCourt[]>([]);
  const [cards, setCards] = useState<PublicBookingCard[]>([]);
  const [grid, setGrid] = useState<BookingGrid>();
  const [courtsReady, setCourtsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState<ManagedAppointment>();
  const [cancelling, setCancelling] = useState<ManagedAppointment>();
  const [moving, setMoving] = useState<ManagedAppointment>();
  const [maxBookingMinutes, setMaxBookingMinutes] = useState<number>();
  const [success, setSuccess] = useState<string>();
  const [openActionsId, setOpenActionsId] = useState<string>();
  const loadVersion = useRef(0);
  const { message: error, report, clear } = useReportedFailure();
  const { message: referenceError, report: reportReference, clear: clearReference } = useReportedFailure();

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadingMore(false);
    setNextCursor(undefined);
    try {
      const page = await api.managedAppointments({
        view, courtId: courtId || undefined, cardId: cardId || undefined, limit: PAGE_SIZE
      });
      if (version !== loadVersion.current) return;
      setAppointments(page.items);
      setNextCursor(page.nextCursor ?? undefined);
      clear();
    } catch (failure) {
      if (version === loadVersion.current) report(failure);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [cardId, clear, courtId, report, view]);

  const loadReferenceData = useCallback(async () => {
    const [courtResult, cardResult, gridResult] = await Promise.allSettled([
      api.courts(), api.bookingCards(), api.bookingGrid()
    ]);
    if (courtResult.status === "fulfilled") {
      setCourts(courtResult.value);
      setCourtsReady(true);
    }
    if (cardResult.status === "fulfilled") setCards(cardResult.value);
    if (gridResult.status === "fulfilled") setGrid(gridResult.value);
    const failure = [courtResult, cardResult, gridResult]
      .find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) reportReference(failure.reason);
    else {
      clearReference();
    }
  }, [clearReference, reportReference]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadReferenceData(); }, [loadReferenceData]);
  useEffect(() => {
    void api.bookingEligibility()
      .then((eligibility) => setMaxBookingMinutes(eligibility.maxBookingMinutes ?? undefined))
      .catch(() => setMaxBookingMinutes(undefined));
  }, []);

  async function loadMore() {
    if (!nextCursor) return;
    const version = loadVersion.current;
    setLoadingMore(true);
    try {
      const page = await api.managedAppointments({
        view, courtId: courtId || undefined, cardId: cardId || undefined, cursor: nextCursor, limit: PAGE_SIZE
      });
      if (version !== loadVersion.current) return;
      setAppointments((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor ?? undefined);
      clear();
    } catch (failure) {
      if (version === loadVersion.current) report(failure);
    } finally {
      if (version === loadVersion.current) setLoadingMore(false);
    }
  }

  const courtNames = useMemo(() => new Map(courts.map((court) => [
    court.id, court.name ?? t("court.number", { number: court.number })
  ])), [courts, t]);
  const groups = useMemo(() => groupAppointments(appointments), [appointments]);
  const timeZone = grid?.timeZone;

  return <section data-testid="managed-appointments-page" aria-labelledby="managed-appointments-title" className="min-w-0">
    <div>
      <h1 id="managed-appointments-title" data-testid="managed-appointments-title" className="text-2xl font-bold">{t("managedAppointments.title")}</h1>
      <p className="text-muted mt-2">{t("managedAppointments.description")}</p>
    </div>
    {grid && courtsReady && <SeriesForm timeZone={grid.timeZone} courts={courts}
      created={async () => { await load(); setSuccess(t("series.createdSuccess")); }}
      reportError={(failure) => { setSuccess(undefined); report(failure); }} />}

    <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label={t("managedAppointments.viewLabel")}>
      {(["UPCOMING", "HISTORY"] as ManagedAppointmentView[]).map((candidate) => <Button
        key={candidate} variant={view === candidate ? "primary" : "secondary"}
        data-testid={`managed-view-${candidate}`} aria-pressed={view === candidate}
        onClick={() => {
          if (candidate === view) return;
          loadVersion.current += 1;
          setView(candidate);
        }}
      >{t(`managedAppointments.view.${candidate}`)}</Button>)}
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 font-semibold">{t("managedAppointments.filterCourt")}
        <select data-testid="managed-court-filter" className="form-control rounded-lg border p-2" value={courtId} onChange={(event) => { loadVersion.current += 1; setCourtId(event.target.value); }}>
          <option value="">{t("managedAppointments.allCourts")}</option>
          {courts.map((court) => <option key={court.id} value={court.id}>{courtNames.get(court.id)}</option>)}
        </select>
      </label>
      <label className="grid gap-1 font-semibold">{t("managedAppointments.filterCard")}
        <select data-testid="managed-card-filter" className="form-control rounded-lg border p-2" value={cardId} onChange={(event) => { loadVersion.current += 1; setCardId(event.target.value); }}>
          <option value="">{t("managedAppointments.allCards")}</option>
          {cards.map((card) => <option key={card.id} value={card.id}>{card.label}</option>)}
        </select>
      </label>
    </div>

    {error && <div className="mt-4"><LoadFailure message={error} retry={() => { clear(); void load(); }} /></div>}
    {referenceError && <div className="mt-4"><LoadFailure message={referenceError} retry={() => { clearReference(); void loadReferenceData(); }} /></div>}
    {success && <div className="mt-4"><SuccessFeedback>{success}</SuccessFeedback></div>}
    {loading ? <p className="mt-6" role="status">{t("status.loading")}</p>
      : groups.length === 0 ? <p className="text-muted mt-6">{t("managedAppointments.empty")}</p>
      : <div data-testid="managed-bookings" className="mt-6 divide-y border-y">
        {groups.map((group) => group.series
          ? <details key={group.key} data-testid={`managed-series-${group.key}`}>
            <summary data-testid="managed-series-summary" className="focus-ring cursor-pointer px-2 py-4 font-semibold">
              {t("managedAppointments.seriesSummary", { label: group.items[0].cardLabel, count: group.items.length })}
            </summary>
            <ul className="divide-y border-t pl-4 sm:pl-8">{group.items.map((appointment) => <AppointmentRow key={appointment.id}
              appointment={appointment} courtNames={courtNames} locale={i18n.language} timeZone={timeZone}
              actionsOpen={openActionsId === appointment.id} toggleActions={setOpenActionsId} moveAvailable={courtsReady}
              showDetail={setDetail} cancel={setCancelling} move={setMoving} t={t} />)}</ul>
          </details>
          : <ul key={group.key}><AppointmentRow appointment={group.items[0]} courtNames={courtNames}
            locale={i18n.language} timeZone={timeZone} actionsOpen={openActionsId === group.items[0].id}
            toggleActions={setOpenActionsId} moveAvailable={courtsReady} showDetail={setDetail} cancel={setCancelling} move={setMoving} t={t} /></ul>)}
      </div>}

    {nextCursor && <Button data-testid="managed-load-more" variant="secondary" className="mt-5" disabled={loadingMore}
      onClick={() => void loadMore()}>{t("managedAppointments.loadMore")}</Button>}
    {grid && detail && <ManagedAppointmentDialog bookingId={detail.id} locale={i18n.language} timeZone={grid.timeZone} closed={() => setDetail(undefined)} />}
    {grid && cancelling && <CancelDialog booking={cancelling}
      seriesBookings={appointments.filter((appointment) => appointment.seriesId === cancelling.seriesId && appointment.status === "CONFIRMED")}
      hasMoreBookings={nextCursor !== undefined} timeZone={grid.timeZone} closed={() => setCancelling(undefined)}
      completed={async () => { setCancelling(undefined); await load(); setSuccess(t("booking.cancelledSuccess")); }} />}
    {grid && courtsReady && moving && <MoveDialog booking={moving} courts={courts} timeZone={grid.timeZone}
      maxBookingMinutes={maxBookingMinutes} closed={() => setMoving(undefined)}
      completed={async () => { setMoving(undefined); await load(); setSuccess(t("booking.moved")); }} />}
  </section>;
}

type Translate = ReturnType<typeof useTranslation>["t"];

function AppointmentRow({ appointment, courtNames, locale, timeZone, actionsOpen, toggleActions, moveAvailable, showDetail, cancel, move, t }: {
  appointment: ManagedAppointment; courtNames: Map<string, string>; locale: string; timeZone?: string;
  actionsOpen: boolean; toggleActions: (bookingId?: string) => void; moveAvailable: boolean;
  showDetail: (appointment: ManagedAppointment) => void; cancel: (appointment: ManagedAppointment) => void;
  move: (appointment: ManagedAppointment) => void; t: Translate;
}) {
  const actions = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!actionsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!actions.current?.contains(event.target as Node)) toggleActions();
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      toggleActions();
      actions.current?.querySelector<HTMLElement>("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [actionsOpen, toggleActions]);

  return <li data-testid={`booking-${appointment.id}`} data-managed-appointment={appointment.id} data-status={appointment.status} className="grid gap-2 px-2 py-3 md:grid-cols-[minmax(13rem,1.5fr)_minmax(9rem,1fr)_auto] md:items-center">
    <div className="grid">
      <span className="font-semibold">{timeZone
        ? formatBookingPeriod(appointment.startsAt, appointment.endsAt, locale, timeZone)
        : `${appointment.startsAt} – ${appointment.endsAt}`}</span>
      <span className="text-muted text-sm">{appointment.courtIds.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ")}</span>
    </div>
    <div className="grid text-sm">
      <span className="flex items-center gap-2"><span aria-hidden="true" className="inline-block size-3 rounded-sm border" style={{ backgroundColor: appointment.cardColor }} />{appointment.cardLabel}
        {appointment.seriesId && <span data-testid="series-marker" className="rounded-full border px-2 font-semibold">{t("myBookings.series")}</span>}
      </span>
      <span className="text-muted">{t("managedAppointments.participants", { count: appointment.participantCount })}</span>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" data-testid="managed-details" className="px-3 py-2" disabled={!timeZone}
        onClick={() => showDetail(appointment)}>{t("managedAppointments.details")}</Button>
      {appointment.status === "CONFIRMED" && timeZone && <details ref={actions} open={actionsOpen} className="relative">
        <summary data-testid="managed-actions" aria-expanded={actionsOpen} className="focus-ring cursor-pointer rounded-lg px-2 py-2 font-semibold"
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            toggleActions(actionsOpen ? undefined : appointment.id);
          }}
          onClick={(event) => { event.preventDefault(); toggleActions(actionsOpen ? undefined : appointment.id); }}>{t("managedAppointments.actions")}</summary>
        <div className="surface-raised absolute right-0 z-10 mt-1 rounded-lg border p-2 shadow-lg">
          <div className="grid gap-2">
            <Button variant="destructive" data-testid="managed-cancel" data-booking-id={appointment.id} className="whitespace-nowrap px-3 py-2" onClick={() => { toggleActions(); cancel(appointment); }}>{t("myBookings.cancel")}</Button>
            {appointment.seriesId && moveAvailable && <Button variant="secondary" data-testid="move-booking" data-booking-id={appointment.id} className="whitespace-nowrap px-3 py-2" onClick={() => { toggleActions(); move(appointment); }}>{t("myBookings.move")}</Button>}
          </div>
        </div>
      </details>}
    </div>
  </li>;
}

function groupAppointments(appointments: ManagedAppointment[]) {
  const groups = new Map<string, ManagedAppointment[]>();
  for (const appointment of appointments) {
    const key = appointment.seriesId ?? appointment.id;
    groups.set(key, [...(groups.get(key) ?? []), appointment]);
  }
  return [...groups].map(([key, items]) => ({ key, series: Boolean(items[0].seriesId), items }));
}
