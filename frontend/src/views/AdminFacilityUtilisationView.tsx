import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type FacilityUtilisation } from "../api/client";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { useReportedFailure } from "../failures/useReportedFailure";
import { formString } from "../forms/formString";

function hoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

// A court that held nothing is the answer to the question as much as a busy one is, so the share
// is measured against the busiest court rather than against a total nobody asked for.
function share(minutes: number, busiest: number): number {
  return busiest === 0 ? 0 : Math.round((minutes / busiest) * 100);
}

export function AdminFacilityUtilisationView() {
  const { t } = useTranslation();
  const { message: error, report: reportError, clear } = useReportedFailure();
  const [report, setReport] = useState<FacilityUtilisation>();
  const [pending, setPending] = useState(false);

  async function read(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      setReport(await api.facilityUtilisation(formString(form, "from"), formString(form, "to")));
      clear();
    } catch (failure) {
      setReport(undefined);
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  const busiest = Math.max(0, ...(report?.courts ?? []).map((court) => court.occupiedMinutes));

  return <section data-testid="admin-facility-utilisation-view" className="surface-panel grid gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:max-w-5xl sm:p-8">
    <h1 className="text-3xl font-bold">{t("admin.utilisation.title")}</h1>
    <p className="text-muted">{t("admin.utilisation.explain")}</p>
    <form noValidate onSubmit={(event) => void read(event)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <TextField data-testid="utilisation-from" name="from" type="date" required label={t("admin.utilisation.from")} />
      <TextField data-testid="utilisation-to" name="to" type="date" required label={t("admin.utilisation.to")} />
      <Button variant="secondary" data-testid="utilisation-read" disabled={pending} type="submit">
        {t("admin.utilisation.read")}
      </Button>
    </form>
    {error && <Alert>{error}</Alert>}
    {report && <section className="grid gap-4">
      <h2 className="text-2xl font-bold">{t("admin.utilisation.courts")}</h2>
      <p className="text-muted text-sm" data-testid="utilisation-period">
        {t("admin.utilisation.period", { from: report.from, to: report.to, timeZone: report.timeZone })}
      </p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b">
            <th scope="col" className="py-2 pr-4 font-semibold">{t("admin.utilisation.court")}</th>
            <th scope="col" className="py-2 pr-4 font-semibold">{t("admin.utilisation.bookings")}</th>
            <th scope="col" className="py-2 pr-4 font-semibold">{t("admin.utilisation.occupied")}</th>
            <th scope="col" className="py-2 font-semibold">{t("admin.utilisation.share")}</th>
          </tr>
        </thead>
        <tbody>
          {report.courts.map((court) => <tr key={court.courtId} data-testid={`utilisation-row-${court.courtNumber}`} className="border-b">
            <td className="py-2 pr-4">{court.courtNumber}{court.courtName ? ` · ${court.courtName}` : ""}</td>
            <td data-testid={`utilisation-bookings-${court.courtNumber}`} className="py-2 pr-4 tabular-nums">{court.bookingCount}</td>
            <td data-testid={`utilisation-occupied-${court.courtNumber}`} className="py-2 pr-4 tabular-nums">{hoursAndMinutes(court.occupiedMinutes)}</td>
            <td data-testid={`utilisation-share-${court.courtNumber}`} className="py-2 tabular-nums">{share(court.occupiedMinutes, busiest)}&nbsp;%</td>
          </tr>)}
        </tbody>
      </table>
    </section>}
  </section>;
}
