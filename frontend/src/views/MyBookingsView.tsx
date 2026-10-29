import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type AccessGrant, type BookingGrid, type Participation, type PersonalBooking, type PublicCourt } from "../api/client";
import { useReportedFailure } from "../failures/useReportedFailure";
import { Alert } from "../components/Alert";
import { LoadFailure } from "../components/LoadFailure";
import { Button } from "../components/Button";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { formatBookingPeriod, formatClockTime, formatDateTime, formatTime } from "../time/clubZone";
import { CancelDialog, MoveDialog } from "./AppointmentDialogs";
import { OpenPlacesSection } from "./OpenPlacesSection";
import { WaitlistSection } from "./WaitlistSection";

import { warnAbout } from "../api/failureWarning";
function offlineBookingGrid(): BookingGrid {
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", slotMinutes: 30, openingWeeks: [], openingPeriods: [], courtClosures: [], openingHours: []
  };
}

export function MyBookingsView({ now, offline = false }: {
  now?: Date; offline?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [reference] = useState(() => now ?? new Date());
  const [bookings, setBookings] = useState<PersonalBooking[]>([]);
  const [cancelled, setCancelled] = useState<PersonalBooking[]>([]);
  const [cancelledNextCursor, setCancelledNextCursor] = useState<string>();
  const [history, setHistory] = useState<PersonalBooking[]>([]);
  const [historyNextCursor, setHistoryNextCursor] = useState<string>();
  const [participations, setParticipations] = useState<Participation[]>([]);
  const [courts, setCourts] = useState<PublicCourt[]>([]);
  const [grid, setGrid] = useState<BookingGrid | undefined>(() => offline ? offlineBookingGrid() : undefined);
  const [refreshedAt, setRefreshedAt] = useState<string>();
  const [maxBookingMinutes, setMaxBookingMinutes] = useState<number>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [participationsNextCursor, setParticipationsNextCursor] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const { message: error, report, clear } = useReportedFailure();
  const { message: loadError, report: reportLoad, clear: clearLoad } = useReportedFailure();
  const [success, setSuccess] = useState<string>();
  const [action, setAction] = useState<{ kind: "cancel" | "move"; booking: PersonalBooking }>();
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    loadVersion.current += 1;
    setLoading(true);
    setLoadingMore(false);
    setNextCursor(undefined);
    try {
      const page = await api.personalBookings();
      setBookings(page.items);
      setRefreshedAt(page.refreshedAt);
      setNextCursor(page.nextCursor ?? undefined);
      if (page.courts) setCourts(page.courts);
      const cachedTimeZone = page.timeZone;
      if (cachedTimeZone) setGrid((current) => ({ ...(current ?? offlineBookingGrid()), timeZone: cachedTimeZone }));
      if (offline) {
        const cachedParticipations = await api.participations().catch(() => undefined);
        setParticipations(cachedParticipations?.items ?? []);
        clearLoad();
        return;
      }
      const [cancelledPage, historyPage, participationPage, availableCourts, bookingGrid] = await Promise.all([
        api.personalBookings({ view: "CANCELLED" }), api.personalBookings({ view: "HISTORY" }),
        api.participations(), api.courts(), api.bookingGrid()
      ]);
      setCancelled(cancelledPage.items);
      setCancelledNextCursor(cancelledPage.nextCursor ?? undefined);
      setHistory(historyPage.items);
      setHistoryNextCursor(historyPage.nextCursor ?? undefined);
      setParticipations(participationPage.items);
      setParticipationsNextCursor(participationPage.nextCursor ?? undefined);
      setCourts(availableCourts);
      setGrid(bookingGrid);
      clearLoad();
    } catch (failure) {
      reportLoad(failure);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [clearLoad, offline, reportLoad]);

  useEffect(() => { void load(); }, [load]);

  // A link is followed once, so a reload after an action leaves the member where they are.
  const followedFragment = useRef<string>(undefined);
  useEffect(() => {
    const fragment = window.location.hash;
    if (loading || !fragment.startsWith("#booking-") || followedFragment.current === fragment) return;
    const target = document.getElementById(fragment.slice(1));
    if (!target) return;
    followedFragment.current = fragment;
    const folded = target.closest("details");
    if (folded) folded.open = true;
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
  }, [loading]);

  // The bound only fills in a field's maximum, and the server holds the rule either way, so a
  // reading that fails leaves the maximum unset rather than taking the bookings down with it.
  useEffect(() => {
    if (offline) return;
    void api.bookingEligibility()
      .then((eligibility) => setMaxBookingMinutes(eligibility.maxBookingMinutes ?? undefined))
      .catch((failure: unknown) => {
        warnAbout("Booking eligibility unavailable", failure);
        setMaxBookingMinutes(undefined);
      });
  }, [offline]);

  async function loadNextPage<T>(
    read: () => Promise<{ items: T[]; nextCursor?: string | null }>,
    append: (items: T[]) => void,
    advance: (cursor?: string) => void
  ) {
    const version = loadVersion.current;
    setLoadingMore(true);
    try {
      const page = await read();
      if (version !== loadVersion.current) return;
      append(page.items);
      advance(page.nextCursor ?? undefined);
      clear();
    } catch (failure) {
      if (version === loadVersion.current) report(failure);
    } finally {
      if (version === loadVersion.current) setLoadingMore(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    await loadNextPage(() => api.personalBookings({ cursor: nextCursor }),
      (items) => setBookings((current) => [...current, ...items]), setNextCursor);
  }

  async function loadMoreCancelled() {
    if (!cancelledNextCursor) return;
    await loadNextPage(() => api.personalBookings({ view: "CANCELLED", cursor: cancelledNextCursor }),
      (items) => setCancelled((current) => [...current, ...items]), setCancelledNextCursor);
  }

  async function loadMoreHistory() {
    if (!historyNextCursor) return;
    await loadNextPage(() => api.personalBookings({ view: "HISTORY", cursor: historyNextCursor }),
      (items) => setHistory((current) => [...current, ...items]), setHistoryNextCursor);
  }

  async function loadMoreParticipations() {
    if (!participationsNextCursor) return;
    await loadNextPage(() => api.participations(participationsNextCursor),
      (items) => setParticipations((current) => [...current, ...items]), setParticipationsNextCursor);
  }

  const sections = useMemo(() => ({
    upcoming: bookings
      .filter((booking) => new Date(booking.endsAt) >= reference)
      .toSorted((left, right) => left.startsAt.localeCompare(right.startsAt)),
    past: history.toSorted((left, right) => right.startsAt.localeCompare(left.startsAt))
  }), [bookings, history, reference]);

  const courtNames = new Map(courts.map((court) => [court.id, court.name ?? t("court.number", { number: court.number })]));
  const searchPartner = async (booking: PersonalBooking, publish: boolean) => {
    setSuccess(undefined);
    try {
      await (publish ? api.publishOpenPlace(booking.id) : api.withdrawOpenPlace(booking.id));
      clear();
      await load();
      setSuccess(t(publish ? "myBookings.partnerSearchStarted" : "myBookings.partnerSearchStopped"));
    } catch (failure) {
      report(failure);
    }
  };
  const checkIn = async (booking: PersonalBooking) => {
    setSuccess(undefined);
    try {
      await api.checkIn(booking.id);
      clear();
      await load();
      setSuccess(t("myBookings.checkedInSuccess"));
    } catch (failure) {
      report(failure);
    }
  };
  const chooseAction = (chosen: { kind: "cancel" | "move"; booking: PersonalBooking }) => {
    setSuccess(undefined);
    setAction(chosen);
  };
  return <section className="mt-4 sm:mt-8" aria-labelledby="my-bookings-title">
    <h1 id="my-bookings-title" data-testid="my-bookings-title" className="text-2xl font-bold">{t("myBookings.title")}</h1>
    {offline && refreshedAt && grid && <p data-testid="bookings-offline-as-of" role="status"
      className="surface-raised border-structural mt-4 rounded-xl border px-4 py-3">
      {t("myBookings.offlineAsOf", { time: formatDateTime(refreshedAt, i18n.language, grid.timeZone) })}
    </p>}
    {loadError && <LoadFailure message={loadError} retry={() => { clearLoad(); void load(); }} />}
    {error && <Alert>{error}</Alert>}
    {success && <SuccessFeedback>{success}</SuccessFeedback>}
    {loading && !loaded ? <p aria-live="polite">{t("status.loading")}</p> : grid && <div className="mt-4 grid gap-6">
      <BookingSection testId="upcoming-bookings" title={t("myBookings.upcoming")} titleHidden empty={t("myBookings.noUpcoming")} bookings={sections.upcoming} courtNames={courtNames} locale={i18n.language} timeZone={grid.timeZone} actionable={!offline && !loading} busy={loading} action={chooseAction} searchPartner={searchPartner} checkIn={checkIn} reference={reference} t={t} />
      {!offline && nextCursor && <Button variant="secondary" data-testid="load-more-bookings" className="justify-self-start" disabled={loadingMore} onClick={() => void loadMore()}>{t("myBookings.loadMore")}</Button>}
      {cancelled.length > 0 && <details data-testid="cancelled-bookings">
        <summary data-testid="cancelled-bookings-summary" className="cursor-pointer font-semibold">{t(cancelledNextCursor ? "myBookings.cancelledCountMore" : "myBookings.cancelledCount", { count: cancelled.length })}</summary>
        <div className="mt-3"><BookingSection testId="cancelled-booking-list" empty="" bookings={cancelled} courtNames={courtNames} locale={i18n.language} timeZone={grid.timeZone} action={chooseAction} t={t} /></div>
        {cancelledNextCursor && <Button variant="secondary" data-testid="load-more-cancelled-bookings" className="mt-4" disabled={loadingMore} onClick={() => void loadMoreCancelled()}>{t("myBookings.loadMoreCancelled")}</Button>}
      </details>}
      {!offline && (sections.past.length === 0 && !historyNextCursor
        ? <p data-testid="past-bookings" className="text-muted">{t("myBookings.noPast")}</p>
        : <details data-testid="past-bookings">
          <summary data-testid="past-bookings-summary" className="cursor-pointer font-semibold">{t(historyNextCursor ? "myBookings.pastCountMore" : "myBookings.pastCount", { count: sections.past.length })}</summary>
          <div className="mt-3"><BookingSection testId="past-booking-list" empty={t("myBookings.noPast")} bookings={sections.past} courtNames={courtNames} locale={i18n.language} timeZone={grid.timeZone} action={chooseAction} t={t} /></div>
          {historyNextCursor && <Button variant="secondary" data-testid="load-more-past-bookings" className="mt-4" disabled={loadingMore} onClick={() => void loadMoreHistory()}>{t("myBookings.loadMorePast")}</Button>}
        </details>)}
    </div>}
    {!offline && !loading && grid && <WaitlistSection courtNames={courtNames} locale={i18n.language} timeZone={grid.timeZone}
      booked={async () => { await load(); setSuccess(t("myWaitlist.booked")); }}
      left={(declined) => setSuccess(t(declined ? "myWaitlist.declined" : "myWaitlist.left"))} />}
    {!offline && !loading && grid && <OpenPlacesSection courtNames={courtNames} locale={i18n.language} timeZone={grid.timeZone}
      taken={async () => { await load(); setSuccess(t("openPlaces.taken")); }} />}
    {!loading && grid && (!offline || participations.length > 0) && <ParticipationSection participations={participations} courtNames={courtNames} locale={i18n.language} timeZone={grid.timeZone} reference={reference} actionable={!offline} withdrawn={async () => { await load(); setSuccess(t("participations.withdrawn")); }} nextCursor={offline ? undefined : participationsNextCursor} loadingMore={loadingMore} loadMore={loadMoreParticipations} t={t} />}
    {grid && action?.kind === "cancel" && <CancelDialog booking={action.booking} seriesBookings={bookings.filter((booking) => booking.seriesId === action.booking.seriesId && booking.status === "CONFIRMED")} incompleteSeries={nextCursor !== undefined} timeZone={grid.timeZone} closed={() => setAction(undefined)} completed={async () => { setAction(undefined); await load(); setSuccess(t("booking.cancelledSuccess")); }} />}
    {grid && action?.kind === "move" && <MoveDialog booking={action.booking} courts={courts} timeZone={grid.timeZone} maxBookingMinutes={maxBookingMinutes} closed={() => setAction(undefined)} completed={async () => { setAction(undefined); await load(); setSuccess(t("booking.moved")); }} />}
  </section>;
}

function ParticipationSection({ participations, courtNames, locale, timeZone, reference, actionable, withdrawn, nextCursor, loadingMore, loadMore, t }: {
  participations: Participation[]; courtNames: Map<string, string>; locale: string; timeZone: string; reference: Date; actionable: boolean;
  withdrawn: () => Promise<void>; nextCursor?: string; loadingMore: boolean;
  loadMore: () => Promise<void>; t: Translate;
}) {
  const [leaving, setLeaving] = useState<string>();
  const { message: error, report, clear } = useReportedFailure();

  async function withdraw(bookingId: string) {
    setLeaving(bookingId);
    try {
      await api.withdrawParticipation(bookingId);
      clear();
      await withdrawn();
    } catch (failure) {
      report(failure);
    } finally {
      setLeaving(undefined);
    }
  }

  if (participations.length === 0 && !nextCursor) {
    return <p data-testid="participations" className="text-muted mt-8">{t("participations.empty")}</p>;
  }

  return <section className="border-structural mt-10 border-t pt-8" aria-labelledby="participations-title">
    <h2 id="participations-title" data-testid="participations-title" className="text-2xl font-bold">{t("participations.title")}</h2>
    <p className="text-muted mt-2">{t("participations.description")}</p>
    {error && <Alert>{error}</Alert>}
    <div data-testid="participations" className="mt-4">
      {participations.length === 0 ? <p className="text-muted">{t("participations.empty")}</p>
        : <ul className="grid gap-3">{participations.map((participation) =>
          <li key={participation.id} id={`booking-${participation.id}`} tabIndex={-1} data-testid={`participation-${participation.id}`} data-status={participation.status} className="focus-ring border-structural grid gap-1 rounded-xl border p-4">
            <span data-testid="booking-title" className="grid font-semibold">
              <span>{formatBookingPeriod(participation.startsAt, participation.endsAt, locale, timeZone)}</span>
              <span>{participation.courtIds.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ")}</span>
            </span>
            <span data-testid="booking-card-label" className="text-muted text-sm">{participation.cardLabel}</span>
            {participation.access && <AccessCodes access={participation.access} reference={reference} locale={locale} timeZone={timeZone} t={t} />}
            {participation.status === "CANCELLED" ? <span>{t("myBookings.cancelled")}</span>
              : actionable && <div className="pt-1">
                <Button variant="destructive" data-testid="withdraw-participation" data-booking-id={participation.id} className="px-3 py-2" disabled={leaving === participation.id} onClick={() => void withdraw(participation.id)}>{t("participations.withdraw")}</Button>
              </div>}
          </li>)}</ul>}
    </div>
    {nextCursor && <Button variant="secondary" data-testid="load-more-participations" className="mt-6" disabled={loadingMore} onClick={() => void loadMore()}>{t("participations.loadMore")}</Button>}
  </section>;
}

type Translate = ReturnType<typeof useTranslation>["t"];

export function BookingSection({ testId, title, titleHidden = false, empty, bookings, courtNames, locale, timeZone, actionable = false, movable = true, busy = false, action, searchPartner, checkIn, reference, t }: {
  testId: string; title?: string; titleHidden?: boolean; empty: string; bookings: PersonalBooking[]; courtNames: Map<string, string>;
  locale: string; timeZone: string; actionable?: boolean; movable?: boolean; busy?: boolean; action: (value: { kind: "cancel" | "move"; booking: PersonalBooking }) => void;
  searchPartner?: (booking: PersonalBooking, publish: boolean) => Promise<void>; checkIn?: (booking: PersonalBooking) => Promise<void>;
  reference?: Date; t: Translate;
}) {
  const groups = groupBookings(bookings);
  return <section data-testid={testId} aria-busy={busy || undefined}>
    {title && <h2 className={titleHidden ? "sr-only" : "text-xl font-semibold"}>{title}</h2>}
    {groups.length === 0 ? <p className={titleHidden ? "text-muted" : "text-muted mt-3"}>{empty}</p> : <div className={`grid gap-3 sm:gap-4 ${titleHidden ? "" : "mt-3"}`}>{groups.map((group) =>
      <article key={group.key} className="border-structural rounded-xl border p-3 sm:p-4">
        <ul className="grid gap-3">{group.bookings.map((booking) => <li key={booking.id} id={`booking-${booking.id}`} tabIndex={-1} data-testid={`booking-${booking.id}`} data-status={booking.status} className="focus-ring border-structural grid gap-1 border-b pb-3 last:border-0 last:pb-0">
          <span data-testid="booking-title" className="grid font-semibold">
            <span>{formatBookingPeriod(booking.startsAt, booking.endsAt, locale, timeZone)}</span>
            <span>{booking.courtIds.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ")}</span>
          </span>
          <span data-testid="booking-card-label" className="text-muted flex items-center gap-2 text-sm">
            <span aria-hidden="true" className="inline-block size-3 shrink-0 rounded-sm border" style={{ backgroundColor: booking.cardColor }} />
            {booking.cardLabel}
            {group.series && <span data-testid="series-marker" className="rounded-full border px-2 font-semibold">{t("myBookings.series")}</span>}
          </span>
          {booking.status === "CANCELLED" && <span>{t(booking.released ? "myBookings.released" : "myBookings.cancelled")}</span>}
          {booking.partnerSearch === "PUBLISHED" && <span data-testid="partner-search-published">{t("myBookings.partnerSearchPublished")}</span>}
          {booking.checkIn?.checkedIn && <span data-testid="checked-in">{t("myBookings.checkedIn")}</span>}
          {booking.access && <AccessCodes access={booking.access} reference={reference} locale={locale} timeZone={timeZone} t={t} />}
          {booking.checkIn && !booking.checkIn.checkedIn && reference && checkInToday(booking.checkIn, reference)
            && <span data-testid="check-in-from" className="text-muted text-sm">{t("myBookings.checkInFrom", { time: formatClockTime(formatTime(booking.checkIn.opensAt, timeZone), locale) })}</span>}
          {actionable && <div className="flex flex-wrap gap-2 pt-1">
            {booking.status === "CONFIRMED" && <>
              {checkIn && reference && booking.checkIn && !booking.checkIn.checkedIn && checkInOpen(booking.checkIn, reference)
                && <Button variant="primary" aria-label={bookingActionName("myBookings.checkInAccessible", booking, courtNames, locale, timeZone, t)} data-testid="check-in" data-booking-id={booking.id} className="px-3 py-2" onClick={() => void checkIn(booking)}>{t("myBookings.checkIn")}</Button>}
              <Button variant="destructive" aria-label={bookingActionName("myBookings.cancelAccessible", booking, courtNames, locale, timeZone, t)} data-testid="personal-cancel" data-booking-id={booking.id} className="px-3 py-2" onClick={() => action({ kind: "cancel", booking })}>{t("myBookings.cancel")}</Button>
              {movable && booking.seriesId && <Button variant="secondary" aria-label={bookingActionName("myBookings.moveAccessible", booking, courtNames, locale, timeZone, t)} data-testid="move-booking" data-booking-id={booking.id} className="px-3 py-2" onClick={() => action({ kind: "move", booking })}>{t("myBookings.move")}</Button>}
              {searchPartner && booking.partnerSearch && <Button variant="secondary"
                aria-label={bookingActionName(booking.partnerSearch === "AVAILABLE" ? "myBookings.searchPartnerAccessible" : "myBookings.stopPartnerSearchAccessible", booking, courtNames, locale, timeZone, t)}
                data-testid={booking.partnerSearch === "AVAILABLE" ? "publish-open-place" : "withdraw-open-place"} data-booking-id={booking.id}
                className="px-3 py-2" onClick={() => void searchPartner(booking, booking.partnerSearch === "AVAILABLE")}>
                {t(booking.partnerSearch === "AVAILABLE" ? "myBookings.searchPartner" : "myBookings.stopPartnerSearch")}
              </Button>}
            </>}
          </div>}
        </li>)}</ul>
      </article>)}</div>}
  </section>;
}

function AccessCodes({ access, reference, locale, timeZone, t }: {
  access: AccessGrant; reference?: Date; locale: string; timeZone: string; t: Translate;
}) {
  if (reference && reference.getTime() >= Date.parse(access.validUntil)) return null;
  return <div data-testid="access-codes" className="grid gap-1 text-sm">
    <span className="font-semibold">{t("myBookings.access", {
      from: formatClockTime(formatTime(access.validFrom, timeZone), locale),
      until: formatClockTime(formatTime(access.validUntil, timeZone), locale)
    })}</span>
    <ul className="grid gap-1">{access.codes.map((code) => <li key={code.accessPointName} data-testid="access-code">
      {code.accessPointName}: <span className="font-mono text-base font-semibold">{code.code}</span>
    </li>)}</ul>
  </div>;
}

function checkInToday(checkIn: NonNullable<PersonalBooking["checkIn"]>, reference: Date) {
  const opensIn = Date.parse(checkIn.opensAt) - reference.getTime();
  return opensIn > 0 && opensIn < 24 * 60 * 60 * 1000;
}

function checkInOpen(checkIn: NonNullable<PersonalBooking["checkIn"]>, reference: Date) {
  return Date.parse(checkIn.opensAt) <= reference.getTime() && reference.getTime() < Date.parse(checkIn.closesAt);
}

function bookingActionName(key: string, booking: PersonalBooking, courtNames: Map<string, string>, locale: string, timeZone: string, t: Translate) {
  return t(key, {
    label: booking.cardLabel,
    period: formatBookingPeriod(booking.startsAt, booking.endsAt, locale, timeZone),
    courts: booking.courtIds.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ")
  });
}

function groupBookings(bookings: PersonalBooking[]) {
  const groups = new Map<string, PersonalBooking[]>();
  for (const booking of bookings) {
    const key = booking.seriesId ?? booking.id;
    groups.set(key, [...(groups.get(key) ?? []), booking]);
  }
  return [...groups].map(([key, entries]) => ({ key, series: entries[0].seriesId !== null && entries[0].seriesId !== undefined, bookings: entries }));
}
