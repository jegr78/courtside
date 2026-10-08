import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { useStatisticsFormat } from "./format";
import { Section } from "./parts";
import { useStatisticsRead } from "./useStatisticsRead";

const STATES = [
  ["queued", "QUEUED"],
  ["handedOver", "HANDED_OVER"],
  ["refused", "REFUSED"],
  ["failed", "FAILED"]
] as const;

export function MessageSection({ from, to }: { from?: string; to?: string }) {
  const { t } = useTranslation();
  const format = useStatisticsFormat();
  const read = useStatisticsRead(api.messageStatistics, from, to);

  return <Section testId="statistics-messages" heading={t("admin.statistics.messages.heading")} read={read}>
    {(report) => {
      const kinds = report.kinds.filter((kind) => STATES.some(([field]) => kind[field] > 0));
      if (kinds.length === 0) return <p data-testid="statistics-messages-empty">{t("admin.statistics.messages.empty")}</p>;
      return <div className="max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4 font-semibold">{t("messages.column.kind")}</th>
              {STATES.map(([field, state]) => <th key={field} scope="col" className="py-2 pr-4 text-right font-semibold">
                {t(`messages.state.${state}`)}
              </th>)}
              <th scope="col" className="py-2 pr-4 text-right font-semibold">{t("admin.statistics.messages.retried")}</th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((kind) => <tr key={kind.kind} data-testid={`statistics-message-${kind.kind}`} className="border-b">
              <th scope="row" className="py-2 pr-4 font-normal">{t(`messages.kind.${kind.kind}`)}</th>
              {STATES.map(([field]) => <td key={field} data-testid={`statistics-message-${kind.kind}-${field}`}
                className="font-value py-2 pr-4 text-right">{format.count(kind[field])}</td>)}
              <td data-testid={`statistics-message-${kind.kind}-retried`}
                className="font-value py-2 pr-4 text-right">{format.count(kind.retried)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>;
    }}
  </Section>;
}
