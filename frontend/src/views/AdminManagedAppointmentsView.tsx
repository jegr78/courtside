import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api, type BookingGrid, type ManagedAppointment, type ManagedAppointmentView, type ManagedSeriesFacts,
  type PublicBookingCard, type PublicCourt
} from "../api/client";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { useReportedFailure } from "../failures/useReportedFailure";
import { dateInTimeZone, formatBookingPeriod, formatBookingTimeRange } from "../time/clubZone";
import { dateTimeFormatter } from "../time/dateTimeFormatter";
import { CancelDialog, ManagedAppointmentDialog, MoveDialog } from "./AppointmentDialogs";
import { SeriesForm } from "./SeriesForm";

const PAGE_SIZE = 20;

export function AdminManagedAppointmentsView({ managesAppointments, createsSeries, administrator = false }: {
  managesAppointments: boolean;
  createsSeries: boolean;
  administrator?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<ManagedAppointmentView>("UPCOMING");
  const [courtId, setCourtId] = useState("");
  const [cardId, setCardId] = useState("");
  const [appointments, setAppointments] = useState<ManagedAppointment[]>([]);
  const [seriesFacts, setSeriesFacts] = useState<Map<string, ManagedSeriesFacts>>(new Map());
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
    if (!managesAppointments) return;
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
      setSeriesFacts(new Map(page.series.map((facts) => [facts.seriesId, facts])));
      setNextCursor(page.nextCursor ?? undefined);
      clear();
    } catch (failure) {
      if (version === loadVersion.current) report(failure);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [cardId, clear, courtId, managesAppointments, report, view]);

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
      setSeriesFacts((current) => new Map([...current, ...page.series.map((facts) => [facts.seriesId, facts] as const)]));
      setNextCursor(page.nextCursor ?? undefined);
      clear();
    } catch (failure) {
      if (version === loadVersion.current) report(failure);
    } finally {
      if (version === loadVersion.current) setLoadingMore(false);
    }
  }

  const startCancelling = (appointment: ManagedAppointment) => {
    setSuccess(undefined);
    setCancelling(appointment);
  };
  const startMoving = (appointment: ManagedAppointment) => {
    setSuccess(undefined);
    setMoving(appointment);
  };

  const courtNames = useMemo(() => new Map(courts.map((court) => [
    court.id, court.name ?? t("court.number", { number: court.number })
  ])), [courts, t]);
  const groups = useMemo(() => groupAppointments(appointments), [appointments]);
  const timeZone = grid?.timeZone;

  return <section data-testid="managed-appointments-page" aria-labelledby="managed-appointments-title" className="min-w-0">
    <div>
      <h1 id="managed-appointments-title" data-testid="managed-appointments-title" className="text-2xl font-bold">{t(managesAppointments ? "managedAppointments.title" : "managedAppointments.seriesOnlyTitle")}</h1>
      <p data-testid="managed-appointments-description" className="text-muted mt-2">
        {t(managesAppointments ? "managedAppointments.description" : "managedAppointments.seriesOnlyDescription")}</p>
    </div>
    {createsSeries && grid && courtsReady && <SeriesForm timeZone={grid.timeZone} courts={courts}
      created={async () => { setSuccess(undefined); await load(); setSuccess(t("series.createdSuccess")); }}
      reportError={(failure) => { setSuccess(undefined); report(failure); }} />}

    {managesAppointments && <>
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
        <select data-testid="managed-court-filter" className="form-control w-full min-w-0 rounded-lg border p-2" value={courtId} onChange={(event) => { loadVersion.current += 1; setCourtId(event.target.value); }}>
          <option value="">{t("managedAppointments.allCourts")}</option>
          {courts.map((court) => <option key={court.id} value={court.id}>{courtNames.get(court.id)}</option>)}
        </select>
      </label>
      <label className="grid gap-1 font-semibold">{t("managedAppointments.filterCard")}
        <select data-testid="managed-card-filter" className="form-control w-full min-w-0 rounded-lg border p-2" value={cardId} onChange={(event) => { loadVersion.current += 1; setCardId(event.target.value); }}>
          <option value="">{t("managedAppointments.allCards")}</option>
          {cards.map((card) => <option key={card.id} value={card.id}>{card.label}</option>)}
        </select>
      </label>
    </div>
    </>}

    {error && <div className="mt-4"><LoadFailure message={error} retry={() => { clear(); void load(); }} /></div>}
    {referenceError && <div className="mt-4"><LoadFailure message={referenceError} retry={() => { clearReference(); void loadReferenceData(); }} /></div>}
    {success && <div className="mt-4"><SuccessFeedback testId="managed-success">{success}</SuccessFeedback></div>}
    {managesAppointments && (loading ? <p className="mt-6" role="status">{t("status.loading")}</p>
      : groups.length === 0 ? <p data-testid="managed-empty" className="text-muted mt-6">
        {t(createsSeries ? "managedAppointments.empty" : "managedAppointments.emptyWithoutSeries")}</p>
      : <div data-testid="managed-bookings" className="mt-6 grid gap-4">
        {groups.map((group) => group.series
          ? <details key={group.key} data-testid={`managed-series-${group.key}`} className="surface-raised rounded-lg border">
            <summary data-testid="managed-series-summary" className="focus-ring cursor-pointer px-3 py-4 font-semibold">
              {seriesHeading(group.items, seriesFacts.get(group.key), courtNames, i18n.language, timeZone, t)}
            </summary>
            <ul className="divide-y border-t pl-4 sm:pl-8">{group.items.map((appointment) => <AppointmentRow key={appointment.id}
              appointment={appointment} courtNames={courtNames} locale={i18n.language} timeZone={timeZone}
              actionsOpen={openActionsId === appointment.id} toggleActions={setOpenActionsId} moveAvailable={courtsReady}
              showDetail={setDetail} cancel={startCancelling} move={startMoving} t={t} />)}</ul>
          </details>
          : <ul key={group.key} data-testid="managed-single-appointments" className="divide-y border-y">{group.items.map((appointment) => <AppointmentRow
            key={appointment.id} appointment={appointment} courtNames={courtNames} locale={i18n.language} timeZone={timeZone}
            actionsOpen={openActionsId === appointment.id} toggleActions={setOpenActionsId} moveAvailable={courtsReady}
            showDetail={setDetail} cancel={startCancelling} move={startMoving} t={t} />)}</ul>)}
      </div>)}

    {managesAppointments && nextCursor && <Button data-testid="managed-load-more" variant="secondary" className="mt-5" disabled={loadingMore}
      onClick={() => void loadMore()}>{t("managedAppointments.loadMore")}</Button>}
    {grid && detail && <ManagedAppointmentDialog bookingId={detail.id} locale={i18n.language} timeZone={grid.timeZone}
      administrator={administrator} closed={() => setDetail(undefined)} />}
    {grid && cancelling && <CancelDialog booking={cancelling}
      seriesBookings={appointments.filter((appointment) => appointment.seriesId === cancelling.seriesId && appointment.status === "CONFIRMED")}
      incompleteSeries={hasUnloadedOccurrences(cancelling, appointments, seriesFacts, nextCursor !== undefined)} timeZone={grid.timeZone} closed={() => setCancelling(undefined)}
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
  const series = new Map<string, ManagedAppointment[]>();
  const groups: { key: string; series: boolean; items: ManagedAppointment[] }[] = [];
  for (const appointment of appointments) {
    const known = appointment.seriesId ? series.get(appointment.seriesId) : undefined;
    const last = groups.at(-1);
    if (known) known.push(appointment);
    else if (appointment.seriesId) {
      const items = [appointment];
      series.set(appointment.seriesId, items);
      groups.push({ key: appointment.seriesId, series: true, items });
    } else if (last && !last.series) last.items.push(appointment);
    else groups.push({ key: appointment.id, series: false, items: [appointment] });
  }
  return groups;
}

function seriesHeading(items: ManagedAppointment[], facts: ManagedSeriesFacts | undefined, courtNames: Map<string, string>,
  locale: string, timeZone: string | undefined, t: Translate) {
  const [first] = items;
  const courts = first.courtIds.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ");
  const counts = facts && seriesCounts(facts, t);
  if (!timeZone) return [first.cardLabel, courts, counts].filter(Boolean).join(" · ");
  const weekday = dateTimeFormatter(locale, { weekday: "short", timeZone });
  const weekdays = [...new Set(sortedByWeekday(items, timeZone).map((item) => weekday.format(new Date(item.startsAt))))].join(", ");
  const date = dateTimeFormatter(locale, { dateStyle: "medium", timeZone });
  const dates = facts && date.formatRange(new Date(facts.firstStartsAt), new Date(facts.lastStartsAt));
  return [first.cardLabel, `${weekdays} ${formatBookingTimeRange(first.startsAt, first.endsAt, locale, timeZone)}`,
    courts, dates, counts].filter(Boolean).join(" · ");
}

function hasUnloadedOccurrences(appointment: ManagedAppointment, appointments: ManagedAppointment[],
  seriesFacts: Map<string, ManagedSeriesFacts>, morePages: boolean) {
  const facts = appointment.seriesId ? seriesFacts.get(appointment.seriesId) : undefined;
  if (!facts) return morePages;
  const now = Date.now();
  const loaded = appointments.filter((candidate) => candidate.seriesId === facts.seriesId && candidate.status === "CONFIRMED"
    && new Date(candidate.startsAt).getTime() > now).length;
  return loaded < facts.occurrences - facts.cancelled - facts.past;
}

function seriesCounts(facts: ManagedSeriesFacts, t: Translate) {
  return [
    t("managedAppointments.seriesOccurrences", { count: facts.occurrences }),
    facts.past > 0 && t("managedAppointments.seriesPast", { count: facts.past }),
    facts.cancelled > 0 && t("managedAppointments.seriesCancelled", { count: facts.cancelled })
  ].filter(Boolean).join(", ");
}

function sortedByWeekday(items: ManagedAppointment[], timeZone: string) {
  const isoWeekday = (item: ManagedAppointment) => (dateInTimeZone(new Date(item.startsAt), timeZone).getDay() + 6) % 7;
  return [...items].sort((left, right) => isoWeekday(left) - isoWeekday(right));
}
