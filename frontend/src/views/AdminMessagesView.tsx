import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { api, type MessageEntry } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { formatDateTime } from "../time/clubZone";
import { Alert } from "../components/Alert";
import { LoadFailure } from "../components/LoadFailure";
import { useRetry } from "../failures/useRetry";
import { Button } from "../components/Button";

function outcomeOf(entry: MessageEntry): string | undefined {
  if (!entry.reason) return undefined;
  return entry.statusCode ? `${entry.reason} (${entry.statusCode})` : entry.reason;
}

export function AdminMessagesView() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { club, error: clubError, load: loadClub } = useClubConfiguration();
  const [entries, setEntries] = useState<MessageEntry[]>();
  const [cursor, setCursor] = useState<string>();
  const [search] = useSearchParams();
  const [unsettled, setUnsettled] = useState(() => search.get("unsettled") === "true");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [loadAttempt, retryLoad] = useRetry();

  const reportError = useCallback((failure: unknown) => setError(problemMessage(failure, t)), [t]);
  const reportErrorRef = useRef(reportError);
  useEffect(() => {
    reportErrorRef.current = reportError;
  }, [reportError]);

  useEffect(() => {
    setEntries(undefined);
    void api.messages(undefined, 50, { unsettled })
      .then((page) => {
        setEntries(page.entries);
        setCursor(page.nextCursor ?? undefined);
        setError(undefined);
      })
      .catch((failure: unknown) => reportErrorRef.current(failure));
  }, [loadAttempt, unsettled]);

  async function readNextPage() {
    if (pending) return;
    setPending(true);
    try {
      const page = await api.messages(cursor, 50, { unsettled });
      setEntries((current) => [...(current ?? []), ...page.entries]);
      setCursor(page.nextCursor ?? undefined);
      setError(undefined);
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  const problem = error ?? clubError;
  const cell = "grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:table-cell sm:border-t sm:p-2";
  const cellLabel = "font-medium sm:hidden";
  return <section data-testid="admin-messages-view" className="surface-panel grid gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-3xl font-bold">{t("messages.title")}</h1>
    <p data-testid="messages-handover-note" className="text-muted max-w-3xl">{t("messages.handoverNote")}</p>
    <label className="flex items-center gap-2 font-medium">
      <input
        type="checkbox"
        data-testid="messages-unsettled-filter"
        checked={unsettled}
        onChange={(event) => setUnsettled(event.target.checked)}
      />
      {t("messages.onlyUnsettled")}
    </label>
    {!entries || !club
      ? (problem ? <LoadFailure message={problem} retry={() => { setError(undefined); loadClub(); retryLoad(); }} /> : <p role="status">{t("status.loading")}</p>)
      : <>
        {problem && <Alert>{problem}</Alert>}
        {entries.some((entry) => entry.state === "REFUSED")
          && <p data-testid="messages-refused-hint" className="text-muted max-w-3xl">{t("messages.refusedHint")}</p>}
        {entries.length === 0
          ? <p data-testid="messages-empty">{t(unsettled ? "messages.noneUnsettled" : "messages.empty")}</p>
          : <table role="table" className="block w-full text-left sm:table">
            <thead role="rowgroup" className="sr-only sm:not-sr-only">
              <tr role="row">
                <th role="columnheader" scope="col" className="p-2">{t("messages.column.queuedAt")}</th>
                <th role="columnheader" scope="col" className="p-2">{t("messages.column.recipient")}</th>
                <th role="columnheader" scope="col" className="p-2">{t("messages.column.kind")}</th>
                <th role="columnheader" scope="col" className="p-2">{t("messages.column.state")}</th>
                <th role="columnheader" scope="col" className="p-2">{t("messages.column.outcome")}</th>
                <th role="columnheader" scope="col" className="p-2">{t("messages.column.messageId")}</th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="grid gap-3 sm:table-row-group">
              {entries.map((entry) => <tr role="row" key={entry.id} data-testid="message-row" data-entry-id={entry.id} data-state={entry.state} data-kind={entry.kind} data-person-id={entry.personId} className="grid gap-2 rounded-xl border p-4 sm:table-row sm:rounded-none sm:border-0 sm:p-0">
                <td role="cell" className={cell}>
                  <span aria-hidden="true" data-testid="message-label-queued-at" className={cellLabel}>{t("messages.column.queuedAt")}</span>
                  <span data-testid="message-queued-at" className="min-w-0 break-words">{formatDateTime(entry.queuedAt, language, club.timeZone)}</span>
                </td>
                <td role="cell" className={cell}>
                  <span aria-hidden="true" data-testid="message-label-recipient" className={cellLabel}>{t("messages.column.recipient")}</span>
                  <Link data-testid="message-person-link" to={`/admin/roster/${entry.personId}`} className="min-w-0 break-words underline">{entry.personName}</Link>
                </td>
                <td role="cell" className={cell}>
                  <span aria-hidden="true" data-testid="message-label-kind" className={cellLabel}>{t("messages.column.kind")}</span>
                  <span data-testid="message-kind" className="min-w-0 break-words">{t(`messages.kind.${entry.kind}`)}</span>
                </td>
                <td role="cell" className={cell}>
                  <span aria-hidden="true" data-testid="message-label-state" className={cellLabel}>{t("messages.column.state")}</span>
                  <span data-testid="message-state" className="min-w-0 break-words">{t(`messages.state.${entry.state}`)}</span>
                </td>
                <td role="cell" className={cell}>
                  <span aria-hidden="true" data-testid="message-label-outcome" className={cellLabel}>{t("messages.column.outcome")}</span>
                  <span data-testid="message-outcome" className="min-w-min [overflow-wrap:normal]">{outcomeOf(entry) ?? t("messages.outcome.none")}</span>
                </td>
                <td role="cell" className={cell}>
                  <span aria-hidden="true" data-testid="message-label-message-id" className={cellLabel}>{t("messages.column.messageId")}</span>
                  <span data-testid="message-id" className="min-w-0 font-mono text-sm [overflow-wrap:anywhere]">{entry.messageId}</span>
                </td>
              </tr>)}
            </tbody>
          </table>}
        {cursor && <Button variant="secondary" data-testid="messages-load-more" disabled={pending} className="justify-self-start" type="button" onClick={() => void readNextPage()}>{t("messages.more")}</Button>}
      </>}
  </section>;
}
