import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type MessageEntry } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { formatDateTime } from "../time/clubZone";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";

function outcomeOf(entry: MessageEntry): string | undefined {
  if (!entry.reason) return undefined;
  return entry.statusCode ? `${entry.reason} (${entry.statusCode})` : entry.reason;
}

export function AdminMessagesView() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { club, error: clubError } = useClubConfiguration();
  const [entries, setEntries] = useState<MessageEntry[]>();
  const [cursor, setCursor] = useState<string>();
  const [unsettled, setUnsettled] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

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
  }, [unsettled]);

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
      ? (problem ? <Alert>{problem}</Alert> : <p role="status">{t("status.loading")}</p>)
      : <>
        {problem && <Alert>{problem}</Alert>}
        {entries.some((entry) => entry.state === "REFUSED")
          && <p data-testid="messages-refused-hint" className="text-muted max-w-3xl">{t("messages.refusedHint")}</p>}
        {entries.length === 0
          ? <p data-testid="messages-empty">{t(unsettled ? "messages.noneUnsettled" : "messages.empty")}</p>
          : <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th scope="col" className="p-2">{t("messages.column.queuedAt")}</th>
                  <th scope="col" className="p-2">{t("messages.column.recipient")}</th>
                  <th scope="col" className="p-2">{t("messages.column.kind")}</th>
                  <th scope="col" className="p-2">{t("messages.column.state")}</th>
                  <th scope="col" className="p-2">{t("messages.column.outcome")}</th>
                  <th scope="col" className="p-2">{t("messages.column.messageId")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => <tr key={entry.id} data-testid="message-row" data-entry-id={entry.id} data-state={entry.state} data-kind={entry.kind} data-person-id={entry.personId} className="border-t">
                  <td data-testid="message-queued-at" className="p-2">{formatDateTime(entry.queuedAt, language, club.timeZone)}</td>
                  <td className="p-2">
                    <Link data-testid="message-person-link" to={`/admin/roster/${entry.personId}`} className="underline">{entry.personName}</Link>
                  </td>
                  <td data-testid="message-kind" className="p-2">{t(`messages.kind.${entry.kind}`)}</td>
                  <td data-testid="message-state" className="p-2">{t(`messages.state.${entry.state}`)}</td>
                  <td data-testid="message-outcome" className="p-2">{outcomeOf(entry) ?? t("messages.outcome.none")}</td>
                  <td data-testid="message-id" className="p-2 font-mono text-sm">{entry.messageId}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
        {cursor && <Button variant="secondary" data-testid="messages-load-more" disabled={pending} className="justify-self-start" type="button" onClick={() => void readNextPage()}>{t("messages.more")}</Button>}
      </>}
  </section>;
}
