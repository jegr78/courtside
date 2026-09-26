import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { useStatisticsFormat } from "./format";
import { BarList, KeyFigure, KeyFigures, Section } from "./parts";
import { useStatisticsRead } from "./useStatisticsRead";

export function BookingSection({ from, to }: { from?: string; to?: string }) {
  const { t } = useTranslation();
  const format = useStatisticsFormat();
  const read = useStatisticsRead(api.bookingStatistics, from, to);

  return <Section testId="statistics-bookings" heading={t("admin.statistics.bookings.heading")} read={read}>
    {(report) => {
      const { figures } = report;
      const previous = report.previous?.figures;
      const confirmed = figures.series + figures.single;
      const mostUses = Math.max(0, ...report.participantCards.map((card) => card.uses));
      return <>
        <KeyFigures>
          <KeyFigure testId="statistics-confirmed" label={t("admin.statistics.bookings.confirmed")} format={format}
            value={format.count(figures.confirmed)} kind="count" current={figures.confirmed} previous={previous?.confirmed} />
          <KeyFigure testId="statistics-cancelled" label={t("admin.statistics.bookings.cancelled")} format={format}
            value={format.count(figures.cancelled)} kind="count" current={figures.cancelled} previous={previous?.cancelled} />
          <KeyFigure testId="statistics-cancellation-rate" label={t("admin.statistics.bookings.cancellationRate")} format={format}
            value={figures.cancellationRate === null ? "-" : format.percent(figures.cancellationRate)}
            kind="ratio" current={figures.cancellationRate} previous={previous?.cancellationRate} />
          <KeyFigure testId="statistics-with-guests" label={t("admin.statistics.bookings.withGuests")} format={format}
            value={format.count(figures.withGuests)} kind="count" current={figures.withGuests} previous={previous?.withGuests} />
          <KeyFigure testId="statistics-guest-entries" label={t("admin.statistics.bookings.guestEntries")} format={format}
            value={format.count(figures.guestEntries)} kind="count" current={figures.guestEntries} previous={previous?.guestEntries} />
        </KeyFigures>
        <BarList testId="statistics-kinds" heading={t("admin.statistics.bookings.origin")} bars={[
          { key: "series", testId: "statistics-series", label: t("admin.statistics.bookings.series"),
            ratio: confirmed > 0 ? figures.series / confirmed : 0, value: format.count(figures.series) },
          { key: "single", testId: "statistics-single", label: t("admin.statistics.bookings.single"),
            ratio: confirmed > 0 ? figures.single / confirmed : 0, value: format.count(figures.single) }
        ]} />
        {report.participantCards.length > 0 && <BarList testId="statistics-participant-cards"
          heading={t("admin.statistics.bookings.participantCards")}
          bars={report.participantCards.map((card) => ({
            key: card.cardId,
            testId: `statistics-participant-card-${card.cardId}`,
            label: card.label,
            ratio: mostUses > 0 ? card.uses / mostUses : 0,
            value: format.count(card.uses)
          }))} />}
      </>;
    }}
  </Section>;
}
