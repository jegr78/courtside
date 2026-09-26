import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { TextField } from "../components/TextField";
import { BookingSection } from "./statistics/BookingSection";
import { MemberSection } from "./statistics/MemberSection";
import { MessageSection } from "./statistics/MessageSection";
import { useStatisticsRead } from "./statistics/useStatisticsRead";
import { isIsoDate, matchingChoice, type Period, periodFromAddress, type QuickChoice, quickPeriod,
  ROLLING_CHOICES } from "./statistics/period";
import { UtilisationSection } from "./statistics/UtilisationSection";

const CHOICES: QuickChoice[] = [...ROLLING_CHOICES, "all", "previousYear"];
const readRange = () => api.statisticsRange();

export function AdminStatisticsView() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const period = useMemo(() => periodFromAddress(params), [params]);
  const range = useStatisticsRead(readRange);
  const [fields, setFields] = useState<Period>(period ?? { from: "", to: "" });
  const [refusal, setRefusal] = useState<string>();
  const [noBookings, setNoBookings] = useState(false);

  useEffect(() => {
    if (period) setFields(period);
  }, [period]);

  const fill = useCallback((answered: Period) =>
    setFields((current) => current.from || current.to ? current : answered), []);

  function show(next: Period) {
    setRefusal(undefined);
    setNoBookings(false);
    setParams({ from: next.from, to: next.to });
  }

  function choose(choice: QuickChoice) {
    if (!range.value) return;
    const next = quickPeriod(choice, range.value);
    if (next) {
      show(next);
    } else {
      setRefusal(undefined);
      setNoBookings(true);
    }
  }

  function read(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isIsoDate(fields.from) || !isIsoDate(fields.to)) {
      setRefusal(t("admin.statistics.periodMissing"));
    } else if (fields.to < fields.from) {
      setRefusal(t("reporting.statistics.periodOrder"));
    } else {
      show(fields);
    }
  }

  const chosen = noBookings ? "all" : period && matchingChoice(period, range.value);
  const sections = `${period?.from ?? ""}|${period?.to ?? ""}`;

  return <section data-testid="admin-facility-utilisation-view" className="surface-panel grid min-w-0 gap-10 rounded-2xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:max-w-5xl sm:p-8">
    <div className="grid gap-3">
      <h1 className="text-3xl font-bold">{t("admin.statistics.title")}</h1>
      <p className="text-muted">{t("admin.statistics.explain")}</p>
    </div>
    <div className="grid gap-4">
      <div role="group" aria-label={t("admin.statistics.choices")} data-testid="statistics-choices" className="flex flex-wrap gap-2">
        {CHOICES.map((choice) => <Button key={choice} type="button" data-testid={`statistics-choice-${choice}`}
          variant={chosen === choice ? "primary" : "secondary"} aria-pressed={chosen === choice}
          disabled={!range.value} onClick={() => choose(choice)} className="px-3 py-2">
          {t(`admin.statistics.choice.${choice}`)}
        </Button>)}
      </div>
      {range.error && <div data-testid="statistics-range-failure"><LoadFailure message={range.error} retry={range.retry} /></div>}
      <form noValidate onSubmit={read} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <TextField data-testid="utilisation-from" name="from" type="date" required label={t("admin.statistics.from")}
          value={fields.from} onChange={(event) => setFields((current) => ({ ...current, from: event.target.value }))} />
        <TextField data-testid="utilisation-to" name="to" type="date" required label={t("admin.statistics.to")}
          value={fields.to} onChange={(event) => setFields((current) => ({ ...current, to: event.target.value }))} />
        <Button variant="secondary" data-testid="utilisation-read" type="submit">{t("admin.statistics.read")}</Button>
      </form>
      {refusal && <Alert testId="statistics-period-refused">{refusal}</Alert>}
    </div>
    {noBookings
      ? <p data-testid="statistics-no-bookings">{t("admin.statistics.allTimeEmpty")}</p>
      : <div key={sections} className="grid min-w-0 gap-12">
        <UtilisationSection from={period?.from} to={period?.to} onAnswered={fill} />
        <BookingSection from={period?.from} to={period?.to} />
        <MemberSection from={period?.from} to={period?.to} />
        <MessageSection from={period?.from} to={period?.to} />
      </div>}
  </section>;
}
