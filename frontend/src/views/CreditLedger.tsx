import { LoadingStatus } from "../components/LoadingGroup";
import { useTranslation } from "react-i18next";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { formatMinor, formatSignedMinor } from "../money";
import { formatDateTime } from "../time/clubZone";
import type { CreditEntry, PayPalRefundOption } from "../api/client";
import type { CreditLedgerState } from "./useCreditLedger";

export interface PayPalRefunds {
  options: ReadonlyMap<string, PayPalRefundOption>;
  busy: boolean;
  request: (entry: CreditEntry) => void;
}

const REFUND_KINDS = ["PAYPAL_REFUND", "PAYPAL_REFUND_REVERSED"];

function RefundCell({ entry, refunds }: { entry: CreditEntry; refunds: PayPalRefunds }) {
  const { t } = useTranslation();
  const option = entry.paypalOrderId ? refunds.options.get(entry.paypalOrderId) : undefined;
  if (!option) return null;
  if (REFUND_KINDS.includes(entry.kind) || option.status) {
    return option.status && <span data-testid="paypal-refund-state" data-status={option.status}>
      {t(`paypalRefund.state.${option.status}`, { reason: option.failureReason ?? "" })}
    </span>;
  }
  if (option.refundable) {
    return <Button variant="secondary" data-testid="paypal-refund" type="button" disabled={refunds.busy}
      onClick={() => refunds.request(entry)}>{t("paypalRefund.action")}</Button>;
  }
  return option.blockedBy && <span data-testid="paypal-refund-blocked" className="text-muted text-sm">{t(option.blockedBy)}</span>;
}

export function CreditLedger({ ledger, refunds }: { ledger: CreditLedgerState; refunds?: PayPalRefunds }) {
  const { t, i18n } = useTranslation();
  const { club } = useClubConfiguration();
  const language = i18n.resolvedLanguage ?? "de";
  const timeZone = club?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { page, failure } = ledger;
  return <div className="grid min-w-0 gap-4">
    {failure !== undefined && <Alert testId="credit-error">{problemMessage(failure, t)}</Alert>}
    {!page && failure === undefined && <LoadingStatus />}
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
                {refunds && <th scope="col" className="py-2 pl-4">{t("paypalRefund.column")}</th>}
              </tr>
            </thead>
            <tbody>
              {page.items.map((entry) => <tr key={entry.id} data-testid="credit-entry" data-kind={entry.kind} className="border-b align-top">
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
                {refunds && <td className="py-2 pl-4"><RefundCell entry={entry} refunds={refunds} /></td>}
              </tr>)}
            </tbody>
          </table>
        </div>}
      {page.nextCursor && <Button variant="secondary" data-testid="credit-more" type="button" disabled={ledger.loadingMore}
        className="justify-self-start" onClick={ledger.more}>{t("creditLedger.more")}</Button>}
    </>}
  </div>;
}
