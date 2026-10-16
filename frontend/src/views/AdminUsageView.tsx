import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { api, type UsageReport } from "../api/client";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import i18n from "../i18n";
import { useStatisticsFormat } from "./statistics/format";
import { BarList, KeyFigure, KeyFigures, Note, Section } from "./statistics/parts";
import { isIsoDate, type Period, periodFromAddress } from "./statistics/period";
import { useStatisticsRead } from "./statistics/useStatisticsRead";

const readUsage = (period?: Period) => api.usageReport(period);

// A violation code names its rule in camel case; the rule's label is the clearest thing to show a board.
export function ruleLabel(code: string, t: (key: string) => string): string {
  const rule = /^booking\.rule\.([a-zA-Z]+)/.exec(code)?.[1];
  const type = rule?.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
  if (type && i18n.exists(`admin.rules.type.${type}`)) return t(`admin.rules.type.${type}`);
  return i18n.exists(code) ? t(code) : code;
}

export function AdminUsageView() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const period = useMemo(() => periodFromAddress(params), [params]);
  const [fields, setFields] = useState<Period>(period ?? { from: "", to: "" });
  const [refusal, setRefusal] = useState<string>();
  const report = useStatisticsRead(readUsage, period?.from, period?.to);

  useEffect(() => {
    if (period) setFields(period);
    else if (report.value) setFields({ from: report.value.from, to: report.value.to });
  }, [period, report.value]);

  function read(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isIsoDate(fields.from) || !isIsoDate(fields.to)) {
      setRefusal(t("admin.statistics.periodMissing"));
    } else if (fields.to < fields.from) {
      setRefusal(t("reporting.statistics.periodOrder"));
    } else {
      setRefusal(undefined);
      setParams({ from: fields.from, to: fields.to });
    }
  }

  return <section data-testid="admin-usage-view" className="surface-panel grid min-w-0 gap-10 rounded-2xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:max-w-5xl sm:p-8">
    <div className="grid gap-3">
      <h1 className="text-3xl font-bold">{t("admin.usage.title")}</h1>
      <p className="text-muted">{t("admin.usage.explain")}</p>
    </div>
    <div className="grid gap-4">
      <form noValidate onSubmit={read} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <TextField data-testid="usage-from" name="from" type="date" required label={t("admin.statistics.from")}
          value={fields.from} onChange={(event) => setFields((current) => ({ ...current, from: event.target.value }))} />
        <TextField data-testid="usage-to" name="to" type="date" required label={t("admin.statistics.to")}
          value={fields.to} onChange={(event) => setFields((current) => ({ ...current, to: event.target.value }))} />
        <Button variant="secondary" data-testid="usage-read" type="submit">{t("admin.statistics.read")}</Button>
      </form>
      {refusal && <Alert testId="usage-period-refused">{refusal}</Alert>}
    </div>
    <Section testId="usage-report" heading={t("admin.usage.heading")} read={report}>
      {(usage) => <UsageParts usage={usage} />}
    </Section>
  </section>;
}

function UsageParts({ usage }: { usage: UsageReport }) {
  const { t } = useTranslation();
  const format = useStatisticsFormat();
  const { capacity, cancellations, attendance, ruleRejections } = usage;
  const mostCancelled = Math.max(0, ...cancellations.cards.map((card) => card.cancelled));
  const mostRefused = Math.max(0, ...ruleRejections.rules.map((rule) => rule.attempts));
  const other = t("admin.usage.other");
  return <div className="grid min-w-0 gap-10">
    <div data-testid="usage-period" className="text-muted">
      {t("admin.usage.period", { from: usage.from, to: usage.to })}
    </div>
    <div className="grid gap-4">
      <h3 className="text-xl font-semibold">{t("admin.usage.capacity.heading")}</h3>
      <BarList testId="usage-capacity" heading={t("admin.usage.capacity.share")}
        bars={capacity.uses.map((use, index) => ({
          key: use.other ? "other" : `${use.cardId}-${use.membershipTypeId ?? "none"}-${index}`,
          testId: use.other ? "usage-capacity-other" : "usage-capacity-row",
          label: use.other ? other
            : `${use.cardLabel ?? ""} · ${use.membershipTypeName ?? t("admin.usage.capacity.noType")}`,
          ratio: use.share,
          value: format.percent(use.share ?? 0),
          detail: t("admin.usage.capacity.detail", { bookings: format.count(use.bookings),
            minutes: format.duration(use.bookedMinutes) })
        }))} />
      {capacity.uses.length === 0 && <Note testId="usage-capacity-empty">{t("admin.usage.empty")}</Note>}
    </div>
    <div className="grid gap-4">
      <h3 className="text-xl font-semibold">{t("admin.usage.cancellations.heading")}</h3>
      <KeyFigures>
        <KeyFigure testId="usage-cancelled" label={t("admin.usage.cancellations.cancelled")} format={format}
          value={format.count(cancellations.cancelled)} />
        <KeyFigure testId="usage-by-holder" label={t("admin.usage.cancellations.byHolder")} format={format}
          value={format.count(cancellations.byHolder)} />
        <KeyFigure testId="usage-by-club" label={t("admin.usage.cancellations.byClub")} format={format}
          value={format.count(cancellations.byClub)} />
        <KeyFigure testId="usage-released" label={t("admin.usage.cancellations.released")} format={format}
          value={format.count(cancellations.released)} />
      </KeyFigures>
      {cancellations.reasons.length > 0 && <BarList testId="usage-reasons" heading={t("admin.usage.cancellations.reasons")}
        bars={cancellations.reasons.map((reason) => ({
          key: reason.reason ?? "none",
          testId: `usage-reason-${reason.reason ?? "none"}`,
          label: reason.reason ? t(`cancellationReason.${reason.reason}`) : t("admin.usage.cancellations.noReason"),
          ratio: cancellations.byClub > 0 ? reason.cancelled / cancellations.byClub : 0,
          value: format.count(reason.cancelled)
        }))} />}
      {cancellations.cards.length > 0 && <BarList testId="usage-cancelled-cards" heading={t("admin.usage.cancellations.cards")}
        bars={cancellations.cards.map((card) => ({
          key: card.other ? "other" : card.cardId ?? "",
          testId: card.other ? "usage-cancelled-other" : "usage-cancelled-card",
          label: card.other ? other : card.cardLabel ?? "",
          ratio: mostCancelled > 0 ? card.cancelled / mostCancelled : 0,
          value: format.count(card.cancelled)
        }))} />}
    </div>
    <div className="grid gap-4">
      <h3 className="text-xl font-semibold">{t("admin.usage.attendance.heading")}</h3>
      {!attendance.tracked && <Note testId="usage-attendance-off">{t("admin.usage.attendance.off")}</Note>}
      <KeyFigures>
        <KeyFigure testId="usage-attended" label={t("admin.usage.attendance.attended")} format={format}
          value={format.count(attendance.attended)} />
        <KeyFigure testId="usage-no-shows" label={t("admin.usage.attendance.noShows")} format={format}
          value={format.count(attendance.noShows)} />
        <KeyFigure testId="usage-lifted" label={t("admin.usage.attendance.lifted")} format={format}
          value={format.count(attendance.liftedNoShows)} />
      </KeyFigures>
    </div>
    <div className="grid gap-4">
      <h3 className="text-xl font-semibold">{t("admin.usage.rejections.heading")}</h3>
      <KeyFigures>
        <KeyFigure testId="usage-refused-attempts" label={t("admin.usage.rejections.attempts")} format={format}
          value={format.count(ruleRejections.attempts)} />
      </KeyFigures>
      {ruleRejections.rules.length > 0 && <BarList testId="usage-rules" heading={t("admin.usage.rejections.rules")}
        bars={ruleRejections.rules.map((rule) => ({
          key: rule.code,
          testId: "usage-rule",
          label: ruleLabel(rule.code, t),
          ratio: mostRefused > 0 ? rule.attempts / mostRefused : 0,
          value: format.count(rule.attempts)
        }))} />}
    </div>
  </div>;
}
