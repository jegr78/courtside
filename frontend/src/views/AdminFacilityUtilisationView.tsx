import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type CourtUtilisation, type FacilityUtilisation } from "../api/client";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { TextField } from "../components/TextField";
import { useReportedFailure } from "../failures/useReportedFailure";
import { useRetry } from "../failures/useRetry";
import { formatDateRange } from "../time/clubZone";

function hoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function OccupancyCell({ court }: { court: CourtUtilisation }) {
  if (court.occupancy === null) {
    return <td data-testid={`utilisation-occupancy-${court.courtNumber}`} className="py-2 tabular-nums">–</td>;
  }
  const percent = Math.min(100, Math.round(court.occupancy * 100));
  return <td className="py-2">
    <div className="flex items-center gap-3">
      <div aria-hidden="true" className="occupancy-bar h-2 w-24 shrink-0 overflow-hidden rounded-full border">
        <div data-testid={`utilisation-bar-${court.courtNumber}`} className="occupancy-bar-fill h-full" style={{ width: `${percent}%` }} />
      </div>
      <span data-testid={`utilisation-occupancy-${court.courtNumber}`} className="tabular-nums">{percent}&nbsp;%</span>
    </div>
  </td>;
}

export function AdminFacilityUtilisationView() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { message: error, report: reportError, clear } = useReportedFailure();
  const [report, setReport] = useState<FacilityUtilisation>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [asked, setAsked] = useState(false);
  const askedRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [loadAttempt, retryLoad] = useRetry();

  const show = useCallback((result: FacilityUtilisation) => {
    setReport(result);
    setFrom((current) => current || result.from);
    setTo((current) => current || result.to);
    clear();
  }, [clear]);

  useEffect(() => {
    let current = true;
    void api.facilityUtilisation()
      .then((result) => { if (current && !askedRef.current) show(result); })
      .catch((failure: unknown) => { if (current && !askedRef.current) reportError(failure); });
    return () => { current = false; };
  }, [loadAttempt, reportError, show]);

  async function read(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setAsked(true);
    askedRef.current = true;
    try {
      show(await api.facilityUtilisation({ from, to }));
    } catch (failure) {
      setReport(undefined);
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  return <section data-testid="admin-facility-utilisation-view" className="surface-panel grid gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:max-w-5xl sm:p-8">
    <h1 className="text-3xl font-bold">{t("admin.utilisation.title")}</h1>
    <p className="text-muted">{t("admin.utilisation.explain")}</p>
    <form noValidate onSubmit={(event) => void read(event)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <TextField data-testid="utilisation-from" name="from" type="date" required label={t("admin.utilisation.from")}
        value={from} onChange={(event) => setFrom(event.target.value)} />
      <TextField data-testid="utilisation-to" name="to" type="date" required label={t("admin.utilisation.to")}
        value={to} onChange={(event) => setTo(event.target.value)} />
      <Button variant="secondary" data-testid="utilisation-read" disabled={pending} type="submit">
        {t("admin.utilisation.read")}
      </Button>
    </form>
    {error && (asked
      ? <Alert>{error}</Alert>
      : <LoadFailure message={error} retry={() => { clear(); retryLoad(); }} />)}
    {!report && !error && <p role="status">{t("status.loading")}</p>}
    {report && <section className="grid gap-4">
      <h2 className="text-2xl font-bold">{t("admin.utilisation.courts")}</h2>
      <p className="text-muted text-sm" data-testid="utilisation-period">
        {t("admin.utilisation.period", { period: formatDateRange(report.from, report.to, language), timeZone: report.timeZone })}
      </p>
      {report.openMinutes === 0
        ? <p data-testid="utilisation-closed">{t("admin.utilisation.closed")}</p>
        : <p data-testid="utilisation-open">{t("admin.utilisation.open", { hours: hoursAndMinutes(report.openMinutes) })}</p>}
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b">
            <th scope="col" className="py-2 pr-4 font-semibold">{t("admin.utilisation.court")}</th>
            <th scope="col" className="py-2 pr-4 font-semibold">{t("admin.utilisation.bookings")}</th>
            <th scope="col" className="py-2 pr-4 font-semibold">{t("admin.utilisation.occupied")}</th>
            <th scope="col" className="py-2 font-semibold">{t("admin.utilisation.occupancy")}</th>
          </tr>
        </thead>
        <tbody>
          {report.courts.map((court) => <tr key={court.courtId} data-testid={`utilisation-row-${court.courtNumber}`} className="border-b">
            <td className="py-2 pr-4">{court.courtNumber}{court.courtName ? ` · ${court.courtName}` : ""}</td>
            <td data-testid={`utilisation-bookings-${court.courtNumber}`} className="py-2 pr-4 tabular-nums">{court.bookingCount}</td>
            <td data-testid={`utilisation-occupied-${court.courtNumber}`} className="py-2 pr-4 tabular-nums">{hoursAndMinutes(court.occupiedMinutes)}</td>
            <OccupancyCell court={court} />
          </tr>)}
        </tbody>
      </table>
    </section>}
  </section>;
}
