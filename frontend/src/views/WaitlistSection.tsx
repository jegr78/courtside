import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type WaitlistEntry } from "../api/client";
import { useReportedFailure } from "../failures/useReportedFailure";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { formatBookingPeriod, formatDateTime } from "../time/clubZone";

export function WaitlistSection({ courtNames, locale, timeZone, booked, left }: {
  courtNames: Map<string, string>; locale: string; timeZone: string;
  booked: () => Promise<void>; left: (declined: boolean) => void;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<WaitlistEntry[]>();
  const [acting, setActing] = useState<string>();
  const { message: error, report, clear } = useReportedFailure();
  const { message: loadError, report: reportLoad, clear: clearLoad } = useReportedFailure();
  const followedFragment = useRef<string>(undefined);

  const load = useCallback(async () => {
    try {
      setEntries(await api.waitlistEntries());
      clearLoad();
    } catch (failure) {
      reportLoad(failure);
    }
  }, [clearLoad, reportLoad]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const fragment = window.location.hash;
    if (!entries || !fragment.startsWith("#waitlist") || followedFragment.current === fragment) return;
    const target = document.getElementById(fragment.slice(1)) ?? document.getElementById("waitlist");
    if (!target) return;
    followedFragment.current = fragment;
    if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
  }, [entries]);

  async function act(entry: WaitlistEntry, action: "accept" | "leave") {
    setActing(entry.id);
    try {
      if (action === "accept") {
        await api.acceptWaitlistOffer(entry.id);
        clear();
        await load();
        await booked();
      } else {
        await api.leaveWaitlist(entry.id);
        clear();
        await load();
        left(entry.state === "OFFERED");
      }
    } catch (failure) {
      report(failure);
      await load();
    } finally {
      setActing(undefined);
    }
  }

  if (loadError) return <LoadFailure message={loadError} retry={() => { clearLoad(); void load(); }} />;
  if (!entries || entries.length === 0) return null;

  return <section id="waitlist" tabIndex={-1} className="focus-ring border-structural mt-10 border-t pt-8" aria-labelledby="waitlist-title">
    <h2 id="waitlist-title" data-testid="waitlist-title" className="text-2xl font-bold">{t("myWaitlist.title")}</h2>
    <p className="text-muted mt-2">{t("myWaitlist.description")}</p>
    {error && <Alert>{error}</Alert>}
    <ul data-testid="waitlist-entries" className="mt-4 grid gap-3">{entries.map((entry) => {
      const period = formatBookingPeriod(entry.startsAt, entry.endsAt, locale, timeZone);
      const court = courtNames.get(entry.courtId) ?? t("myBookings.unknownCourt");
      const label = t("myWaitlist.entryLabel", { period, court });
      const open = entry.state === "WAITING" || entry.state === "OFFERED";
      return <li key={entry.id} id={`waitlist-${entry.id}`} tabIndex={-1} data-testid={`waitlist-entry-${entry.id}`}
        data-state={entry.state} className="focus-ring border-structural grid gap-1 rounded-xl border p-4">
        <span data-testid="waitlist-entry-title" className="grid font-semibold">
          <span>{period}</span>
          <span>{court}</span>
        </span>
        <span className="text-muted text-sm">{entry.cardLabel}</span>
        <p data-testid="waitlist-entry-state" className={entry.state === "OFFERED" ? "font-semibold" : undefined}>
          {entry.state === "OFFERED" && entry.offerExpiresAt
            ? t("myWaitlist.offeredUntil", { time: formatDateTime(entry.offerExpiresAt, locale, timeZone) })
            : t(`myWaitlist.state.${entry.state}`)}
        </p>
        {open && <div className="flex flex-wrap gap-2 pt-1">
          {entry.state === "OFFERED" && <Button variant="primary" data-testid="waitlist-accept" data-entry-id={entry.id}
            aria-label={t("myWaitlist.acceptAccessible", { label })} className="px-3 py-2"
            disabled={acting === entry.id} onClick={() => void act(entry, "accept")}>{t("myWaitlist.accept")}</Button>}
          <Button variant={entry.state === "OFFERED" ? "secondary" : "destructive"} data-testid="waitlist-leave" data-entry-id={entry.id}
            aria-label={t(entry.state === "OFFERED" ? "myWaitlist.declineAccessible" : "myWaitlist.leaveAccessible", { label })}
            className="px-3 py-2" disabled={acting === entry.id} onClick={() => void act(entry, "leave")}>
            {t(entry.state === "OFFERED" ? "myWaitlist.decline" : "myWaitlist.leave")}
          </Button>
        </div>}
      </li>;
    })}</ul>
  </section>;
}
