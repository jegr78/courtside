import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type GuestFeePeriod, type GuestFeeReport } from "../api/client";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { downloadBlob } from "../downloads/downloadJson";
import { useReportedFailure } from "../failures/useReportedFailure";
import { formatMinor } from "../money";
import { formatCalendarDate } from "../time/clubZone";

const SEPARATORS = [",", ";", "\t"];

export function AdminGuestFeesView() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "de";
  const { message: error, report: reportFailure, clear } = useReportedFailure();
  const [report, setReport] = useState<GuestFeeReport>();
  const [fields, setFields] = useState<GuestFeePeriod>({ from: "", to: "" });
  const [separator, setSeparator] = useState(";");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let active = true;
    void api.guestFees().then((read) => {
      if (!active) return;
      setReport(read);
      setFields({ from: read.from, to: read.to });
    }).catch(reportFailure);
    return () => {
      active = false;
    };
  }, [reportFailure]);

  async function read(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running) return;
    setRunning(true);
    try {
      setReport(await api.guestFees(fields));
      clear();
    } catch (failure) {
      reportFailure(failure);
    } finally {
      setRunning(false);
    }
  }

  async function download() {
    if (running) return;
    setRunning(true);
    try {
      const offered = await api.exportGuestFees({ ...fields, separator });
      downloadBlob(offered.fileName, offered.content);
      clear();
    } catch (failure) {
      reportFailure(failure);
    } finally {
      setRunning(false);
    }
  }

  return <section data-testid="admin-guest-fees-view" className="surface-panel grid min-w-0 gap-8 rounded-2xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:max-w-5xl sm:p-8">
    <div className="grid gap-3">
      <h1 className="text-3xl font-bold">{t("admin.guestFees.title")}</h1>
      <p className="text-muted">{t("admin.guestFees.explain")}</p>
    </div>
    <form noValidate onSubmit={(event) => void read(event)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <TextField data-testid="guest-fees-from" name="from" type="date" required label={t("admin.statistics.from")}
        value={fields.from} onValueChange={(value) => setFields((current) => ({ ...current, from: value }))} />
      <TextField data-testid="guest-fees-to" name="to" type="date" required label={t("admin.statistics.to")}
        value={fields.to} onValueChange={(value) => setFields((current) => ({ ...current, to: value }))} />
      <Button variant="secondary" data-testid="guest-fees-read" type="submit" disabled={running}>{t("admin.statistics.read")}</Button>
    </form>
    {error && <Alert testId="guest-fees-error">{error}</Alert>}
    {report && <div data-testid="guest-fees-report" className="grid min-w-0 gap-4">
      <p data-testid="guest-fees-period" className="text-muted">
        {t("admin.usage.period", { from: formatCalendarDate(report.from, language), to: formatCalendarDate(report.to, language) })}
      </p>
      {report.members.length === 0
        ? <p data-testid="guest-fees-empty">{t("admin.guestFees.empty")}</p>
        : <div className="min-w-0 overflow-x-auto">
          <table data-testid="guest-fees-table" className="w-full text-left">
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4">{t("admin.guestFees.member")}</th>
                <th scope="col" className="py-2 pr-4">{t("admin.guestFees.memberNumbers")}</th>
                <th scope="col" className="py-2 pr-4 text-right">{t("admin.guestFees.guestPlaces")}</th>
                <th scope="col" className="py-2 text-right">{t("admin.guestFees.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {report.members.map((member) => <tr key={`${member.personId}-${member.currency}`} data-testid="guest-fees-row" className="border-b">
                <td className="py-2 pr-4">{`${member.lastName}, ${member.firstName}`}</td>
                <td className="py-2 pr-4">{member.memberNumbers.map((number) => number.externalId).join(", ")}</td>
                <td data-testid="guest-fees-places" className="py-2 pr-4 text-right">{member.guestPlaces}</td>
                <td data-testid="guest-fees-amount" className="py-2 text-right">{formatMinor(member.sumMinor, language, member.currency)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
      {report.unassignedGuestPlaces > 0 && <p data-testid="guest-fees-unassigned" className="text-muted text-sm">
        {t("admin.guestFees.unassigned", { count: report.unassignedGuestPlaces })}
      </p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 gap-2 font-medium">
          {t("admin.export.separator")}
          <select data-testid="guest-fees-separator" className="form-control min-w-0 rounded-lg border px-3 py-3"
            value={separator} onChange={(event) => setSeparator(event.target.value)}>
            {SEPARATORS.map((character) =>
              <option key={character} value={character}>{t(`admin.export.separator.${character}`)}</option>)}
          </select>
        </label>
        <Button variant="secondary" data-testid="guest-fees-download" type="button" disabled={running}
          onClick={() => void download()}>{t("admin.export.download")}</Button>
      </div>
    </div>}
  </section>;
}
