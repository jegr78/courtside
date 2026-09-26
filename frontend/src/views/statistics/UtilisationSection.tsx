import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api, type UtilisationStatistics } from "../../api/client";
import { formatDateRange } from "../../time/clubZone";
import { type StatisticsFormat, useStatisticsFormat } from "./format";
import { BarList, KeyFigure, KeyFigures, Note, Section } from "./parts";
import { useStatisticsRead } from "./useStatisticsRead";
import type { Period } from "./period";

type Hour = UtilisationStatistics["hours"][number];

function heatLevel(occupancy: number): number {
  return occupancy === 0 ? 0 : Math.min(5, Math.ceil(occupancy * 5));
}

function HourTable({ hours, format }: { hours: Hour[]; format: StatisticsFormat }) {
  const { t } = useTranslation();
  const open = [...new Set(hours.filter((hour) => hour.openMinutes > 0).map((hour) => hour.hour))].sort((a, b) => a - b);
  if (open.length === 0) return null;
  const weekday = new Intl.DateTimeFormat(format.language, { weekday: "short" });
  const byCell = new Map(hours.map((hour) => [`${hour.isoWeekday}-${hour.hour}`, hour]));
  return <section data-testid="statistics-hours" aria-labelledby="statistics-hours-heading" className="grid min-w-0 gap-3">
    <h3 id="statistics-hours-heading" className="text-lg font-bold">{t("admin.statistics.hours.heading")}</h3>
    <p className="text-muted text-sm">{t("admin.statistics.hours.explain")}</p>
    <div data-testid="statistics-hours-scroll" className="max-w-full overflow-x-auto rounded-lg border">
      <table className="stat-heat-table border-collapse text-center text-xs">
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left font-semibold">{t("admin.statistics.hours.weekday")}</th>
            {open.map((hour) => <th key={hour} scope="col" aria-label={t("admin.statistics.hours.hour", { hour })}
              className="font-value px-1 py-1 font-semibold">{String(hour).padStart(2, "0")}</th>)}
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 7].map((day) => <tr key={day}>
            <th scope="row" className="px-2 py-1 text-left font-semibold">
              {/* 1 January 2024 is a Monday, so day n of that month is ISO weekday n. */}
              {weekday.format(new Date(2024, 0, day))}
            </th>
            {open.map((hour) => {
              const cell = byCell.get(`${day}-${hour}`);
              const occupancy = cell && cell.openMinutes > 0 ? cell.occupancy : null;
              return occupancy === null
                ? <td key={hour} data-testid={`statistics-hour-${day}-${hour}`} className="px-1 py-1">
                  <span className="sr-only">{t("admin.statistics.closedHour")}</span>
                </td>
                : <td key={hour} data-testid={`statistics-hour-${day}-${hour}`} data-level={heatLevel(occupancy)}
                  className={`stat-heat-${heatLevel(occupancy)} font-value min-w-10 px-1 py-1`}>
                  {format.percent(occupancy)}
                </td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

export function UtilisationSection({ from, to, onAnswered }: {
  from?: string;
  to?: string;
  onAnswered: (period: Period) => void;
}) {
  const { t } = useTranslation();
  const format = useStatisticsFormat();
  const read = useStatisticsRead(api.utilisationStatistics, from, to);
  const answered = read.value?.period;

  useEffect(() => {
    if (answered) onAnswered({ from: answered.from, to: answered.to });
  }, [answered, onAnswered]);

  return <Section testId="statistics-utilisation" heading={t("admin.statistics.utilisation.heading")} read={read}>
    {(report) => {
      const { totals } = report;
      const previous = report.previous?.totals;
      const cardMinutes = report.cards.reduce((sum, card) => sum + card.minutes, 0);
      return <>
        <p className="text-muted text-sm" data-testid="utilisation-period">
          {t("admin.statistics.period", {
            period: formatDateRange(report.period.from, report.period.to, format.language), timeZone: report.period.timeZone
          })}
        </p>
        <KeyFigures>
          <KeyFigure testId="statistics-occupancy" label={t("admin.statistics.utilisation.occupancy")} format={format}
            value={totals.occupancy === null ? "-" : format.percent(totals.occupancy)}
            kind="ratio" current={totals.occupancy} previous={previous?.occupancy} />
          <KeyFigure testId="statistics-booked" label={t("admin.statistics.utilisation.booked")} format={format}
            value={format.duration(totals.bookedMinutes)}
            kind="duration" current={totals.bookedMinutes} previous={previous?.bookedMinutes} />
          <KeyFigure testId="statistics-closed" label={t("admin.statistics.utilisation.closed")} format={format}
            value={format.duration(totals.closedMinutes)}
            kind="duration" current={totals.closedMinutes} previous={previous?.closedMinutes} />
          <KeyFigure testId="statistics-allocations" label={t("admin.statistics.utilisation.bookings")} format={format}
            value={format.count(report.cards.filter((card) => !card.closure).reduce((sum, card) => sum + card.bookings, 0))} />
        </KeyFigures>
        {totals.occupancy === null && <p data-testid="statistics-no-open-time">{t("admin.statistics.utilisation.noOpenTime")}</p>}
        <Note testId="statistics-open-note">{t("admin.statistics.utilisation.openNote")}</Note>
        <BarList testId="statistics-progression" heading={t(`admin.statistics.progression.${report.progression.granularity}`)}
          bars={report.progression.buckets.map((bucket) => ({
            key: bucket.startsOn,
            testId: `statistics-bucket-${bucket.startsOn}`,
            label: formatDateRange(bucket.startsOn, bucket.endsOn, format.language),
            ratio: bucket.totals.occupancy,
            value: bucket.totals.occupancy === null ? "-" : format.percent(bucket.totals.occupancy),
            detail: t("admin.statistics.utilisation.booked") + " " + format.duration(bucket.totals.bookedMinutes)
          }))} />
        <HourTable hours={report.hours} format={format} />
        <BarList testId="statistics-courts" heading={t("admin.statistics.courts.heading")}
          bars={report.courts.map((court) => ({
            key: court.courtId,
            testId: `utilisation-row-${court.courtNumber}`,
            label: <>
              {court.courtName ? `${court.courtNumber} · ${court.courtName}` : t("court.number", { number: court.courtNumber })}
              {!court.active && <span className="text-muted"> ({t("admin.statistics.courts.inactive")})</span>}
            </>,
            ratio: court.occupancy,
            value: court.occupancy === null ? "-" : format.percent(court.occupancy),
            detail: t("admin.statistics.courts.detail", { booked: format.duration(court.bookedMinutes), count: court.bookings })
          }))} />
        <BarList testId="statistics-cards" heading={t("admin.statistics.cards.heading")}
          bars={report.cards.map((card) => ({
            key: card.cardId,
            testId: `statistics-card-${card.cardId}`,
            label: <>
              {card.label}
              {card.closure && <span className="text-muted"> ({t("admin.statistics.cards.closure")})</span>}
            </>,
            ratio: cardMinutes > 0 ? card.minutes / cardMinutes : 0,
            value: format.percent(cardMinutes > 0 ? card.minutes / cardMinutes : 0),
            detail: t("admin.statistics.cards.detail", { minutes: format.duration(card.minutes), count: card.bookings })
          }))} />
      </>;
    }}
  </Section>;
}
