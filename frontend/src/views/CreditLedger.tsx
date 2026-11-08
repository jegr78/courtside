import { useTranslation } from "react-i18next";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { formatMinor, formatSignedMinor } from "../money";
import { formatDateTime } from "../time/clubZone";
import type { CreditLedgerState } from "./useCreditLedger";

export function CreditLedger({ ledger }: { ledger: CreditLedgerState }) {
  const { t, i18n } = useTranslation();
  const { club } = useClubConfiguration();
  const language = i18n.resolvedLanguage ?? "de";
  const timeZone = club?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { page, failure } = ledger;
  return <div className="grid min-w-0 gap-4">
    {failure !== undefined && <Alert testId="credit-error">{problemMessage(failure, t)}</Alert>}
    {!page && failure === undefined && <p role="status">{t("status.loading")}</p>}
    {page && <>
      <p className="grid gap-1">
        <span className="text-muted text-sm">{t("creditLedger.balance")}</span>
        <span data-testid="credit-balance" data-balance-minor={page.balanceMinor} className="text-2xl font-bold">{formatMinor(page.balanceMinor, language, page.currency)}</span>
      </p>
      {page.items.length === 0
        ? <p data-testid="credit-empty" className="text-muted">{t("creditLedger.empty")}</p>
        : <div className="min-w-0 overflow-x-auto">
          <table data-testid="credit-entries" className="w-full text-left">
            <caption className="sr-only">{t("creditLedger.entries")}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4">{t("creditLedger.date")}</th>
                <th scope="col" className="py-2 pr-4">{t("creditLedger.kindLabel")}</th>
                <th scope="col" className="py-2 pr-4">{t("creditLedger.note")}</th>
                <th scope="col" className="py-2 pr-4 text-right">{t("creditLedger.amount")}</th>
                <th scope="col" className="py-2 text-right">{t("creditLedger.balanceAfter")}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((entry) => <tr key={entry.id} data-testid="credit-entry" className="border-b align-top">
                <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(entry.recordedAt, language, timeZone)}</td>
                <td data-testid="credit-entry-kind" className="py-2 pr-4">{t(`creditLedger.kind.${entry.kind}`)}</td>
                <td data-testid="credit-entry-note" className="py-2 pr-4 [overflow-wrap:anywhere]">
                  {entry.note ?? <span className="text-muted">{t("creditLedger.noNote")}</span>}
                </td>
                <td data-testid="credit-entry-amount" className="py-2 pr-4 text-right whitespace-nowrap">
                  {formatSignedMinor(entry.amountMinor, language, entry.currency)}
                </td>
                <td data-testid="credit-entry-balance-after" className="py-2 text-right whitespace-nowrap">
                  {formatMinor(entry.balanceAfterMinor, language, entry.currency)}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>}
      {page.nextCursor && <Button variant="secondary" data-testid="credit-more" type="button" disabled={ledger.loadingMore}
        className="justify-self-start" onClick={ledger.more}>{t("creditLedger.more")}</Button>}
    </>}
  </div>;
}
