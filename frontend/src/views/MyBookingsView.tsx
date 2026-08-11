import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type BookingGrid, type CancelScope, type MovePreview, type MoveRequest, type PersonalBooking, type PublicCourt } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";

export function MyBookingsView({ now = new Date() }: { now?: Date }) {
  const { t, i18n } = useTranslation();
  const [bookings, setBookings] = useState<PersonalBooking[]>([]);
  const [courts, setCourts] = useState<PublicCourt[]>([]);
  const [grid, setGrid] = useState<BookingGrid>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [action, setAction] = useState<{ kind: "cancel" | "move"; booking: PersonalBooking }>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [page, availableCourts, bookingGrid] = await Promise.all([
        api.personalBookings(), api.courts(), api.bookingGrid()
      ]);
      setBookings(page.items);
      setNextCursor(page.nextCursor ?? undefined);
      setCourts(availableCourts);
      setGrid(bookingGrid);
      setError(undefined);
    } catch (failure) {
      setError(problemMessage(failure, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

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

  const sections = useMemo(() => ({
    upcoming: bookings
      .filter((booking) => booking.status === "CONFIRMED" && new Date(booking.endsAt) >= now)
      .toSorted((left, right) => left.startsAt.localeCompare(right.startsAt)),
    past: bookings
      .filter((booking) => booking.status === "CANCELLED" || new Date(booking.endsAt) < now)
      .toSorted((left, right) => right.startsAt.localeCompare(left.startsAt))
  }), [bookings, now]);

  const courtNames = new Map(courts.map((court) => [court.id, court.name ?? t("court.number", { number: court.number })]));
  return <section className="mt-8" aria-labelledby="my-bookings-title">
    <h2 id="my-bookings-title" className="text-2xl font-bold">{t("myBookings.title")}</h2>
    {error && <Alert>{error}</Alert>}
    {loading ? <p aria-live="polite">{t("status.loading")}</p> : grid && <div className="mt-4 grid gap-8 lg:grid-cols-2">
      <BookingSection title={t("myBookings.upcoming")} empty={t("myBookings.noUpcoming")} bookings={sections.upcoming} courtNames={courtNames} locale={i18n.language} timeZone={grid.timeZone} actionable action={setAction} t={t} />
      <BookingSection title={t("myBookings.past")} empty={t("myBookings.noPast")} bookings={sections.past} courtNames={courtNames} locale={i18n.language} timeZone={grid.timeZone} action={setAction} t={t} />
    </div>}
    {nextCursor && <Button className="mt-6" disabled={loadingMore} onClick={() => void loadMore()}>{t("myBookings.loadMore")}</Button>}
    {grid && action?.kind === "cancel" && <CancelDialog booking={action.booking} seriesBookings={bookings.filter((booking) => booking.seriesId === action.booking.seriesId && booking.status === "CONFIRMED")} hasMoreBookings={nextCursor !== undefined} timeZone={grid.timeZone} closed={() => setAction(undefined)} completed={async () => { setAction(undefined); await load(); }} />}
    {grid && action?.kind === "move" && <MoveDialog booking={action.booking} courts={courts} timeZone={grid.timeZone} closed={() => setAction(undefined)} completed={async () => { setAction(undefined); await load(); }} />}
  </section>;
}

type Translate = ReturnType<typeof useTranslation>["t"];

function BookingSection({ title, empty, bookings, courtNames, locale, timeZone, actionable = false, action, t }: {
  title: string; empty: string; bookings: PersonalBooking[]; courtNames: Map<string, string>;
  locale: string; timeZone: string; actionable?: boolean; action: (value: { kind: "cancel" | "move"; booking: PersonalBooking }) => void; t: Translate;
}) {
  const groups = groupBookings(bookings);
  return <section>
    <h3 className="text-xl font-semibold">{title}</h3>
    {groups.length === 0 ? <p className="text-muted mt-3">{empty}</p> : <div className="mt-3 grid gap-4">{groups.map((group) =>
      <article key={group.key} className="border-structural rounded-xl border p-4">
        {group.series && <p className="mb-2 font-semibold text-(--club-primary)">{t("myBookings.series")}</p>}
        <ul className="grid gap-3">{group.bookings.map((booking) => <li key={booking.id} className="border-structural grid gap-1 border-b pb-3 last:border-0 last:pb-0">
          <span className="font-semibold">{booking.cardLabel}</span>
          <time dateTime={booking.startsAt}>{formatDateTime(booking.startsAt, locale, timeZone)}</time>
          <span>{booking.courtIds.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ")}</span>
          {booking.status === "CANCELLED" && <span>{t("myBookings.cancelled")}</span>}
          {actionable && booking.status === "CONFIRMED" && <div className="flex flex-wrap gap-2 pt-1">
            <Button data-testid="personal-cancel" data-booking-id={booking.id} className="px-3 py-2" onClick={() => action({ kind: "cancel", booking })}>{t("myBookings.cancel", { label: booking.cardLabel })}</Button>
            {booking.seriesId && <Button className="px-3 py-2" onClick={() => action({ kind: "move", booking })}>{t("myBookings.move", { label: booking.cardLabel })}</Button>}
          </div>}
        </li>)}</ul>
      </article>)}</div>}
  </section>;
}

function groupBookings(bookings: PersonalBooking[]) {
  const groups = new Map<string, PersonalBooking[]>();
  for (const booking of bookings) {
    const key = booking.seriesId ?? booking.id;
    groups.set(key, [...(groups.get(key) ?? []), booking]);
  }
  return [...groups].map(([key, entries]) => ({ key, series: entries[0].seriesId !== null && entries[0].seriesId !== undefined, bookings: entries }));
}

function ScopeFields({ scope, changed, t }: { scope: CancelScope; changed: (scope: CancelScope) => void; t: Translate }) {
  return <fieldset className="grid gap-2"><legend className="font-semibold">{t("myBookings.scope")}</legend>
    {(["THIS", "THIS_AND_FOLLOWING", "WHOLE_SERIES"] as CancelScope[]).map((value) => <label key={value} className="flex gap-2">
      <input type="radio" name="scope" checked={scope === value} onChange={() => changed(value)} />{t(`myBookings.scope.${value}`)}
    </label>)}
  </fieldset>;
}

function CancelDialog({ booking, seriesBookings, hasMoreBookings, timeZone, closed, completed }: { booking: PersonalBooking; seriesBookings: PersonalBooking[]; hasMoreBookings: boolean; timeZone: string; closed: () => void; completed: () => Promise<void> }) {
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
    <ul className="list-disc pl-5">{affected.map((candidate) => <li key={candidate.id}>{formatDateTime(candidate.startsAt, i18n.language, timeZone)}</li>)}</ul>
    {hasMoreBookings && scope !== "THIS" && <p>{t("myBookings.affectedIncomplete")}</p>}
    {error && <Alert>{error}</Alert>}
    <div className="flex gap-2"><Button data-testid="confirm-cancellation" onClick={() => void submit()}>{t("booking.cancelConfirm")}</Button><Button className="button-secondary" onClick={closed}>{t("booking.close")}</Button></div>
  </div></Modal>;
}

function MoveDialog({ booking, courts, timeZone, closed, completed }: { booking: PersonalBooking; courts: PublicCourt[]; timeZone: string; closed: () => void; completed: () => Promise<void> }) {
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
  return <Modal labelledBy="move-personal-title" closed={closed}><div className="surface-panel grid w-full max-w-lg gap-4 rounded-2xl border p-6">
    <h2 id="move-personal-title" className="text-xl font-bold">{t("myBookings.moveTitle")}</h2>
    <ScopeFields scope={scope} changed={(value) => { setScope(value); setPreview(undefined); }} t={t} />
    <label className="grid gap-1 font-semibold">{t("myBookings.newStartTime")}<input type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); setPreview(undefined); }} className="form-control rounded border p-2" /></label>
    <label className="grid gap-1 font-semibold">{t("myBookings.newDuration")}<input type="number" min="1" value={duration} onChange={(event) => { setDuration(event.target.value); setPreview(undefined); }} className="form-control rounded border p-2" /></label>
    <fieldset><legend className="font-semibold">{t("booking.courts")}</legend>{courts.map((court) => <label key={court.id} className="flex gap-2"><input type="checkbox" checked={courtIds.includes(court.id)} onChange={(event) => { setCourtIds((ids) => event.target.checked ? [...ids, court.id] : ids.filter((id) => id !== court.id)); setPreview(undefined); }} />{court.name ?? t("court.number", { number: court.number })}</label>)}</fieldset>
    {error && <Alert>{error}</Alert>}
    {preview && <div><p className="font-semibold">{t("myBookings.previewCount", { count: preview.moves.length })}</p><ul className="mt-2 grid gap-2">{preview.moves.map((move) => <li key={move.bookingId}><p>{formatDateTime(move.fromStartsAt, i18n.language, timeZone)} → {formatDateTime(move.toStartsAt, i18n.language, timeZone)}</p><MoveReasons move={move} courtNames={courtNames} t={t} /></li>)}</ul></div>}
    <div className="flex gap-2">{preview ? <Button disabled={!preview.executable} onClick={() => void move()}>{t("myBookings.moveConfirm")}</Button> : <Button disabled={courtIds.length === 0 || (!startTime && !duration && courtIds.join() === booking.courtIds.join())} onClick={() => void previewMove()}>{t("myBookings.movePreview")}</Button>}<Button className="button-secondary" onClick={closed}>{t("booking.close")}</Button></div>
  </div></Modal>;
}

function MoveReasons({ move, courtNames, t }: { move: MovePreview["moves"][number]; courtNames: Map<string, string>; t: Translate }) {
  const names = (ids: string[]) => ids.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ");
  return <ul className="list-disc pl-5">
    {move.violations.map((violation) => <li key={`${move.bookingId}-${violation.code}`}>{t(violation.code, { ...violation.params, defaultValue: t("error.generic") })}</li>)}
    {move.blockedCourtIds.length > 0 && <li>{t("myBookings.occupiedCourts", { courts: names(move.blockedCourtIds) })}</li>}
    {move.unbookableCourtIds.length > 0 && <li>{t("myBookings.unavailableCourts", { courts: names(move.unbookableCourtIds) })}</li>}
  </ul>;
}

function formatDateTime(timestamp: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone })
    .format(new Date(timestamp));
}
